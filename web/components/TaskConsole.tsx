'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  cancelTask,
  createTask,
  streamTask,
  TaskState,
  TaskStatusEvent,
  TaskStreamEvent,
} from '../lib/sdk';
import Header from './Header';

type DisplayableTaskEvent = Extract<
  TaskStreamEvent,
  { type: 'status' | 'log' | 'done' }
>;
type ConsoleEntry = DisplayableTaskEvent | { type: 'info'; message: string };

export default function TaskConsole() {
  const [prompt, setPrompt] = useState('');
  const [cwd, setCwd] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [latestStatus, setLatestStatus] = useState<TaskStatusEvent | null>(null);
  const [heartbeatTs, setHeartbeatTs] = useState<string | null>(null);
  const streamCleanup = useRef<() => void>();
  const streamPanelRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const appendEntry = useCallback((entry: ConsoleEntry) => {
    setEntries((prev) => [...prev, entry]);
    // Auto-scroll to bottom if user hasn't scrolled up
    if (autoScrollRef.current && streamPanelRef.current) {
      setTimeout(() => {
        streamPanelRef.current?.scrollTo({
          top: streamPanelRef.current.scrollHeight,
          behavior: 'smooth',
        });
      }, 10);
    }
  }, []);

  const startNewTask = () => {
    // Add separator if there are existing entries
    if (entries.length > 0) {
      setEntries((prev) => [
        ...prev,
        { type: 'info', message: '\n--- New Task ---\n' },
      ]);
    }
    setLatestStatus(null);
    setHeartbeatTs(null);
    setIsCancelling(false);
  };

  useEffect(() => {
    return () => {
      streamCleanup.current?.();
    };
  }, []);

  useEffect(() => {
    if (!taskId) {
      return;
    }

    streamCleanup.current?.();

    streamCleanup.current = streamTask(
      taskId,
      {
        onStatus: (event) => {
          appendEntry({ type: 'status', data: event });
          setLatestStatus(event);
        },
        onLog: (event) => {
          appendEntry({ type: 'log', data: event });
        },
        onDone: (event) => {
          appendEntry({ type: 'done', data: event });
          if (event.state) {
            setLatestStatus((prev) => ({
              state: event.state as TaskState,
              ts: prev?.ts,
              error: undefined,
            }));
          }
          setIsCancelling(false);
          // Close the stream when task is done
          streamCleanup.current?.();
          streamCleanup.current = undefined;
        },
        onHeartbeat: (event) => {
          setHeartbeatTs(event.ts);
        },
        onError: (err) => {
          const message =
            err instanceof Error ? err.message : 'Unknown streaming error';
          setEntries((prev) => [
            ...prev,
            { type: 'info', message: `Stream error: ${message}` },
          ]);
        },
      },
      {},
    );

    return () => {
      streamCleanup.current?.();
    };
  }, [appendEntry, taskId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt.trim()) {
      setError('Prompt is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    startNewTask();

    const currentPrompt = prompt.trim();
    const currentCwd = cwd.trim();

    try {
      // Show the prompt in the output
      appendEntry({ 
        type: 'info', 
        message: `📝 Prompt: ${currentPrompt}${currentCwd ? `\n📁 Workspace: ${currentCwd}` : ''}` 
      });

      const task = await createTask({ 
        prompt: currentPrompt,
        cwd: currentCwd || undefined,
      });
      setTaskId(task.task_id);
      appendEntry({ type: 'info', message: `🔄 Task ${task.task_id} started` });
      if (task.task) {
        setLatestStatus({ state: task.task.state, ts: task.task.updatedAt, error: task.task.errorMessage ?? undefined });
      }
      // Don't clear the prompt - let user edit and resubmit
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!taskId || !canCancel(latestStatus)) {
      return;
    }

    setIsCancelling(true);
    appendEntry({ type: 'info', message: 'Cancellation requested…' });

    try {
      await cancelTask(taskId);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to cancel task';
      setError(message);
      setIsCancelling(false);
    }
  };

  const handleClearHistory = () => {
    setEntries([]);
    setTaskId(null);
    setLatestStatus(null);
    setHeartbeatTs(null);
  };

  return (
    <>
      <Header />
      <div className="task-console">
        <form onSubmit={handleSubmit} className="task-form">
        <label className="form-field">
          <span className="form-label">Workspace Directory (optional)</span>
          <input
            type="text"
            value={cwd}
            onChange={(event) => setCwd(event.target.value)}
            className="form-input"
            placeholder="Leave empty to use default workspace"
            disabled={isSubmitting}
          />
        </label>
        <label className="form-field">
          <span className="form-label">Prompt</span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="form-textarea"
            placeholder="Describe the task for Codex"
            disabled={isSubmitting}
          />
        </label>
        <button type="submit" className="primary-button" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : 'Run Task'}
        </button>
      </form>

      {error ? <p className="error-banner">{error}</p> : null}

      <div className="action-buttons">
        {taskId && canCancel(latestStatus) ? (
          <button
            type="button"
            className="secondary-button"
            onClick={handleCancel}
            disabled={isCancelling}
          >
            {isCancelling ? 'Cancelling…' : 'Cancel Task'}
          </button>
        ) : null}
        {entries.length > 0 ? (
          <button
            type="button"
            className="secondary-button"
            onClick={handleClearHistory}
          >
            Clear History
          </button>
        ) : null}
      </div>

      <div className="stream-meta">
        {latestStatus ? (
          <p className="stream-current">
            Current status: {latestStatus.state}
            {latestStatus.error ? ` – ${latestStatus.error}` : ''}
          </p>
        ) : null}
        {heartbeatTs ? (
          <p className="stream-heartbeat">
            Last heartbeat: {new Date(heartbeatTs).toLocaleTimeString()}
          </p>
        ) : null}
      </div>

      <div className="stream-section">
        <h2 className="section-title">Stream</h2>
        <div 
          className="stream-panel"
          ref={streamPanelRef}
          onScroll={(e) => {
            const target = e.currentTarget;
            const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 50;
            autoScrollRef.current = isAtBottom;
          }}
        >
          {entries.length === 0 ? (
            <p className="stream-empty">No output yet.</p>
          ) : (
            <ul className="stream-list">
              {entries.map((entry, index) => (
                <li key={`${index}-${entry.type}`}>{renderEntry(entry)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

function renderEntry(entry: ConsoleEntry) {
  if (entry.type === 'info') {
    return <span className="stream-info">{entry.message}</span>;
  }

  if (entry.type === 'log') {
    return (
      <span className={entry.data.stream === 'stderr' ? 'stream-log-error' : 'stream-log'}>
        {entry.data.line}
      </span>
    );
  }

  if (entry.type === 'status') {
    return (
      <span className="stream-status">
        Status: {entry.data.state}
        {entry.data.error ? ` – ${entry.data.error}` : ''}
      </span>
    );
  }

  if (entry.type === 'done') {
    if (entry.data.state === 'canceled') {
      return <span className="stream-status">Task canceled</span>;
    }
    return (
      <span className="stream-done">
        Exit code: {entry.data.exit_code}
        {entry.data.state ? ` (${entry.data.state})` : ''}
      </span>
    );
  }

  return null;
}

function canCancel(status: TaskStatusEvent | null): boolean {
  if (!status) {
    return false;
  }
  return status.state === 'queued' || status.state === 'running';
}
