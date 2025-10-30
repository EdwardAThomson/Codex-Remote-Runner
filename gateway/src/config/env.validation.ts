import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().default(3000),
  REDIS_URL: Joi.string().uri().allow('').default(''),
  CODEX_BIN_PATH: Joi.string().default('codex'),
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_ISSUER: Joi.string().default('codex-remote-runner'),
  RATE_LIMIT_POINTS: Joi.number().integer().positive().default(60),
  RATE_LIMIT_DURATION: Joi.number().integer().positive().default(60),
  TASK_HEARTBEAT_MS: Joi.number().integer().positive().default(15000),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'log', 'debug', 'verbose')
    .default('log'),
});
