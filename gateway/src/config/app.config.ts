import { registerAs } from '@nestjs/config';
import { homedir } from 'os';
import { resolve } from 'path';

export interface AppConfig {
  port: number;
  codexBinPath: string;
  redisUrl: string;
  jwtSecret: string;
  jwtIssuer: string;
  rateLimitPoints: number;
  rateLimitDuration: number;
  taskHeartbeatMs: number;
  defaultWorkspace: string;
  adminPasswordHash: string;
}

/**
 * Expands ~ to home directory in paths
 */
function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    return resolve(homedir(), path.slice(2));
  }
  return path;
}

export default registerAs<AppConfig>('app', () => ({
  port: Number(process.env.PORT ?? 3000),
  codexBinPath: expandPath(process.env.CODEX_BIN_PATH ?? 'codex'),
  redisUrl: process.env.REDIS_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtIssuer: process.env.JWT_ISSUER ?? 'codex-remote-runner',
  rateLimitPoints: Number(process.env.RATE_LIMIT_POINTS ?? 60),
  rateLimitDuration: Number(process.env.RATE_LIMIT_DURATION ?? 60),
  taskHeartbeatMs: Number(process.env.TASK_HEARTBEAT_MS ?? 15000),
  defaultWorkspace: expandPath(
    process.env.DEFAULT_WORKSPACE ?? '~/codex-workspace',
  ),
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? '',
}));
