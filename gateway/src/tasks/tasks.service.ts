import {
  BadRequestException,
  Injectable,
  Logger,
  MessageEvent,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { ReplaySubject } from 'rxjs';
import { CreateTaskDto } from './dto/create-task.dto';

export type TaskState = 'queued' | 'running' | 'completed' | 'error' | 'canceled';

export interface TaskLogEvent {
  line: string;
  stream: 'stdout' | 'stderr';
  ts: string;
}

export interface TaskSummary {
  id: string;
  prompt: string;
  cwd?: string | null;
  state: TaskState;
  createdAt: string;
  updatedAt: string;
  exitCode: number | null;
  errorMessage: string | null;
}

export interface TaskDetail extends TaskSummary {
  logs: TaskLogEvent[];
}

interface TaskRecord extends TaskDetail {
  process?: ChildProcessWithoutNullStreams;
  stream: ReplaySubject<MessageEvent>;
  buffers: {
    stdout: string;
    stderr: string;
  };
  finalized: boolean;
  heartbeat?: NodeJS.Timeout;
  finalizeOptions?: {
    stateOverride?: TaskState;
    messageOverride?: string | null;
  };
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private readonly tasks = new Map<string, TaskRecord>();
  private readonly heartbeatIntervalMs: number;

  constructor(private readonly configService: ConfigService) {
    const interval =
      this.configService.get<number>('app.taskHeartbeatMs', 15000) ?? 15000;
    this.heartbeatIntervalMs = Math.max(0, interval);
  }

  async create(dto: CreateTaskDto): Promise<TaskSummary> {
    const id = randomUUID();
    const now = new Date().toISOString();
    
    // Use default workspace if no cwd provided
    const defaultWorkspace = this.configService.get<string>('app.defaultWorkspace');
    const cwd = dto.cwd ?? defaultWorkspace ?? null;
    
    const record: TaskRecord = {
      id,
      prompt: dto.prompt,
      cwd,
      state: 'queued',
      exitCode: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      logs: [],
      stream: new ReplaySubject<MessageEvent>(),
      buffers: { stdout: '', stderr: '' },
      finalized: false,
    };
    this.tasks.set(id, record);

    this.pushStatus(record, 'queued');
    this.runTask(record);

    return this.toSummary(record);
  }

  async findAll(): Promise<TaskSummary[]> {
    return Array.from(this.tasks.values()).map((task) => this.toSummary(task));
  }

  async findDetailOrFail(id: string): Promise<TaskDetail> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }
    return this.toDetail(task);
  }

  async streamTask(id: string): Promise<ReplaySubject<MessageEvent>> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }

    if (!task.finalized && task.stream.observers.length > 0) {
      return task.stream;
    }

    return this.replayTaskStream(task);
  }

  async cancelTask(
    id: string,
    reason = 'Task canceled by user',
  ): Promise<TaskDetail> {
    const task = this.tasks.get(id);
    if (!task) {
      throw new NotFoundException(`Task ${id} not found`);
    }

    if (task.finalized) {
      return this.toDetail(task);
    }

    if (task.state !== 'queued' && task.state !== 'running') {
      throw new BadRequestException(`Task ${id} is not active`);
    }

    this.logger.log(`Canceling task ${id}`);
    task.finalizeOptions = {
      stateOverride: 'canceled',
      messageOverride: reason,
    };
    this.stopHeartbeat(task);

    if (task.process && !task.process.killed) {
      try {
        task.process.kill('SIGTERM');
      } catch (error) {
        this.logger.warn(`Failed to terminate task ${id}: ${String(error)}`);
      }
    }

    if (!task.finalized) {
      this.finalizeTask(task, null, task.finalizeOptions);
    }

    return this.toDetail(task);
  }

  private runTask(task: TaskRecord) {
    const codexBinPath = this.configService.get<string>(
      'app.codexBinPath',
      'codex',
    );
    const cwd = task.cwd ?? process.cwd();
    const args = [
      'exec',
      '--full-auto',
      '--skip-git-repo-check',
      '-C',
      cwd,
      task.prompt,
    ];

    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(codexBinPath, args, {
        env: { ...process.env },
        stdio: 'pipe',
      });
    } catch (error) {
      this.logger.error(
        `Failed to spawn Codex process for task ${task.id}: ${String(error)}`,
      );
      const options = task.finalizeOptions
        ? { ...task.finalizeOptions }
        : { error: error as Error };
      this.finalizeTask(task, null, options);
      return;
    }

    task.process = child;
    this.pushStatus(task, 'running');
    this.startHeartbeat(task);

    child.stdout.on('data', (chunk: Buffer) => {
      this.handleOutput(task, chunk, 'stdout');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      this.handleOutput(task, chunk, 'stderr');
    });

    child.once('error', (error) => {
      this.flushBuffers(task);
      this.logger.error(
        `Codex process error for task ${task.id}: ${String(error)}`,
      );
      const options = task.finalizeOptions
        ? { ...task.finalizeOptions }
        : { error };
      this.finalizeTask(task, null, options);
    });

    child.once('close', (code) => {
      this.flushBuffers(task);
      const options = task.finalizeOptions
        ? { ...task.finalizeOptions }
        : { error: code === 0 ? null : undefined };
      this.finalizeTask(task, code ?? null, options);
    });
  }

  private handleOutput(
    task: TaskRecord,
    chunk: Buffer,
    stream: 'stdout' | 'stderr',
  ) {
    const text = chunk.toString('utf8');
    const combined = task.buffers[stream] + text;
    const lines = combined.split(/\r?\n/);
    task.buffers[stream] = lines.pop() ?? '';

    for (const line of lines) {
      this.appendLog(task, line, stream);
    }
  }

  private flushBuffers(task: TaskRecord) {
    const stdoutRemainder = task.buffers.stdout;
    const stderrRemainder = task.buffers.stderr;

    if (stdoutRemainder.length > 0) {
      this.appendLog(task, stdoutRemainder, 'stdout');
      task.buffers.stdout = '';
    }

    if (stderrRemainder.length > 0) {
      this.appendLog(task, stderrRemainder, 'stderr');
      task.buffers.stderr = '';
    }
  }

  private appendLog(
    task: TaskRecord,
    line: string,
    stream: 'stdout' | 'stderr',
  ) {
    const timestamp = new Date().toISOString();
    const entry: TaskLogEvent = { line, stream, ts: timestamp };
    task.logs.push(entry);
    task.stream.next({
      type: 'log',
      data: entry,
    });
  }

  private pushStatus(task: TaskRecord, state: TaskState, error?: string | null) {
    task.state = state;
    task.errorMessage = error ?? null;
    const now = new Date();
    task.updatedAt = now.toISOString();

    const event = this.toStatusEvent(state, task.errorMessage ?? undefined, now);
    task.stream.next({
      type: 'status',
      data: event,
    });
  }

  private finalizeTask(
    task: TaskRecord,
    exitCode: number | null,
    options: {
      error?: Error | null;
      stateOverride?: TaskState;
      messageOverride?: string | null;
    } = {},
  ) {
    if (task.finalized) {
      return;
    }

    task.finalized = true;
    task.exitCode = exitCode;
    this.stopHeartbeat(task);
    const { error, stateOverride, messageOverride } = options;

    let targetState: TaskState;
    if (stateOverride) {
      targetState = stateOverride;
    } else {
      const hasError = exitCode === null || exitCode !== 0 || error;
      targetState = hasError ? 'error' : 'completed';
    }

    let message = messageOverride ?? undefined;
    if (!message) {
      message =
        error?.message ??
        (targetState === 'error' ? 'Codex execution failed' : undefined);
    }

    this.pushStatus(task, targetState, message);
    task.finalizeOptions = undefined;

    task.stream.next({
      type: 'done',
      data: {
        exit_code: exitCode ?? -1,
        state: targetState,
      },
    });
    task.stream.complete();
  }

  private replayTaskStream(task: TaskRecord): ReplaySubject<MessageEvent> {
    const stream = new ReplaySubject<MessageEvent>();
    const statusEvent = this.toStatusEvent(
      task.state,
      task.errorMessage ?? undefined,
      new Date(task.updatedAt),
    );
    stream.next({ type: 'status', data: statusEvent });

    for (const log of task.logs) {
      stream.next({ type: 'log', data: log });
    }

    if (task.finalized) {
      stream.next({
        type: 'done',
        data: {
          exit_code: task.exitCode ?? -1,
          state: task.state,
        },
      });
      stream.complete();
    }

    task.stream = stream;
    return stream;
  }

  private toStatusEvent(state: TaskState, error?: string, timestamp = new Date()) {
    return {
      state,
      ts: timestamp.toISOString(),
      ...(error ? { error } : {}),
    };
  }

  private toSummary(task: TaskRecord): TaskSummary {
    return {
      id: task.id,
      prompt: task.prompt,
      cwd: task.cwd,
      state: task.state,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      exitCode: task.exitCode,
      errorMessage: task.errorMessage,
    };
  }

  private toDetail(task: TaskRecord): TaskDetail {
    return {
      ...this.toSummary(task),
      logs: task.logs,
    };
  }

  private startHeartbeat(task: TaskRecord) {
    if (this.heartbeatIntervalMs <= 0) {
      return;
    }

    this.stopHeartbeat(task);

    task.heartbeat = setInterval(() => {
      const now = new Date().toISOString();
      task.stream.next({
        type: 'heartbeat',
        data: { ts: now },
      });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(task: TaskRecord) {
    if (task.heartbeat) {
      clearInterval(task.heartbeat);
      task.heartbeat = undefined;
    }
  }
}
