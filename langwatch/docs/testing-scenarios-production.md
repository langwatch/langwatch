# Testing Scenarios in Production-Like Environments

This guide covers how to test the scenario execution system before deploying to production.

## Quick Start

### Option 1: Docker Dev Environment (Recommended)

The fastest way to test scenarios with the full stack:

```bash
# From langwatch/ directory
make dev-scenarios
```

This starts:
- PostgreSQL + Redis
- Next.js app (port 5560)
- Workers (includes scenario processor)
- Bull Board (port 3000) - queue visualization
- AI Server (port 3456)

Then:
1. Open http://localhost:5560
2. Create/select a project
3. Go to Scenarios
4. Run a scenario against a prompt or HTTP agent

### Option 2: Production Docker Build

To test the exact Docker image that will be deployed:

```bash
# From langwatch-saas/ directory
docker build -t langwatch-test .

# Run with required env vars
docker run -it --rm \
  -e DATABASE_URL="postgresql://..." \
  -e REDIS_URL="redis://..." \
  -e NEXTAUTH_SECRET="test-secret" \
  -e NEXTAUTH_URL="http://localhost:5560" \
  -p 5560:5560 \
  langwatch-test
```

## Architecture Overview

Scenario execution flow:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   API Router    │────▶│  BullMQ Queue   │────▶│ Scenario Worker │
│ (schedules job) │     │ (scenarios/exec)│     │ (processes job) │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                         │
                                                         ▼
                                               ┌─────────────────┐
                                               │  Child Process  │
                                               │ (isolated OTEL) │
                                               └─────────────────┘
```

Key components:
- `simulation-runner.router.ts` - API endpoint that schedules scenario jobs
- `scenario.queue.ts` - BullMQ queue for scenario execution
- `scenario.processor.ts` - Worker that processes jobs and spawns child processes
- `scenario-child-process.ts` - Isolated process with its own OTEL context

## Debugging

### View Queue Status

Bull Board UI: http://localhost:3000

Shows:
- Pending jobs
- Active jobs
- Completed/failed jobs
- Job logs

### Check Worker Logs

```bash
# Docker dev environment
docker logs -f langwatch-workers-1

# Or filter for scenario logs
docker logs langwatch-workers-1 2>&1 | grep -i scenario
```

### Common Issues

#### ERR_MODULE_NOT_FOUND when spawning child process

**Symptom:** Jobs fail with module resolution errors

**Cause:** Path resolution issue in Docker where `process.cwd()` differs from source location

**Fix:** PR #1306 - uses `__dirname` for reliable path resolution

#### Jobs stuck in "waiting" state

**Check:**
1. Workers are running: `docker ps | grep workers`
2. Redis connection: Worker logs should show "connected to Redis"
3. Queue name matches: Should be `simulations/scenarios/executions`

#### Child process crashes silently

**Check job logs in Bull Board** - the worker captures child stderr

**Common causes:**
- Missing environment variables (check `buildChildProcessEnv` whitelist)
- Dependencies not resolved (check `cwd` is set to package root)

## Environment Variables

Required for scenario execution:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection for BullMQ |
| `BASE_HOST` | LangWatch endpoint for trace collection |

Optional:

| Variable | Description |
|----------|-------------|
| `PINO_LOG_LEVEL` | Log verbosity (debug, info, warn, error) |
| `WORKER_METRICS_PORT` | Prometheus metrics port (default: 9090) |

## Verifying Scenario Execution

### 1. Create a Test Scenario

```typescript
// Via API or UI
const scenario = {
  name: "Test Greeting",
  situation: "User asks for a greeting",
  criteria: "Agent responds with a friendly greeting"
};
```

### 2. Run Against a Target

Targets can be:
- **Prompt config**: Tests a prompt template with LLM
- **HTTP agent**: Tests an external API endpoint

### 3. Check Results

1. **UI**: Scenario results page shows pass/fail with reasoning
2. **Traces**: LangWatch captures full execution trace
3. **Bull Board**: Job status and logs

## Rollback Plan

If scenarios fail in production after deploy:

### Option A: Quick Fix - Bypass Queue

PR #1310 provides a fallback that runs scenarios directly without the queue/worker infrastructure:

```bash
git checkout fix/scenarios-bypass-queue
# Deploy this branch
```

### Option B: Revert OTEL Changes

PR #1309 fully reverts the OTEL isolation feature:

```bash
git checkout revert/otel-trace-isolation
# Deploy this branch
```

## Related Documentation

- [ADR-004: Docker Dev Environment](./adr/004-docker-dev-environment.md)
- [Testing Philosophy](./TESTING_PHILOSOPHY.md)
