# Roadmap — Codex Remote Runner

_Status: active · updated 2026-05-30_

A full-stack monorepo for running OpenAI's Codex CLI remotely behind a secure web
UI — NestJS gateway, Next.js client, an experimental Expo mobile app, and a shared
TypeScript SDK. See `docs/plan.md` for the detailed implementation plan. (The
sibling `LLM-Remote-Runner` generalizes this to multiple LLM backends.)

## Shipped

- [x] NestJS gateway API (create / stream / cancel / list tasks)
- [x] JWT auth (bcrypt hashing, Bearer tokens, rate limiting, sessions)
- [x] Real-time SSE streaming (status, log, heartbeat, done events)
- [x] Task management (spawn Codex subprocess, capture stdout/stderr, exit codes, custom `cwd`)
- [x] Task cancellation (SIGTERM → SIGKILL timeout)
- [x] Next.js web client (login, task composer, live stream with auto-scroll, history)
- [x] Shared TypeScript SDK (`@codex/sdk`)
- [x] Expo mobile scaffold + SDK wrapper
- [x] Docker Compose dev infra (gateway, postgres, redis, minio, nginx)
- [x] Jest unit tests (TasksService with mocked Codex process)
- [x] Docs (README, RUNNING, AUTHENTICATION, SETUP, SECURITY, spec, plan)

## Next

- [ ] Mobile streaming (EventSource polyfill, feature parity)
- [ ] Reintroduce Postgres persistence (task metadata, logs, audit trail)
- [ ] Rate-limiting tuning before public exposure
- [ ] `cwd` allow-list sandboxing

## Backlog

- [ ] BullMQ queue (background execution, retries, load distribution)
- [ ] Headless Codex login / secure server-side token storage
- [ ] Observability (OpenTelemetry traces, Prometheus metrics, structured logs)
- [ ] Hardening (CORS restriction, env allow-list, orphaned-child cleanup)
- [ ] CI/CD pipeline (lint/test gating, container push, staging deploy)
- [ ] Backups & secret rotation
- [ ] Enhancements (per-repo tool profiles, diff/artifact capture, webhooks, WebSocket option, MCP)
