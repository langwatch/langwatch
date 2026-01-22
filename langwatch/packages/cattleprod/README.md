# Cattleprod 🐄⚡

CLI tool for viewing, monitoring, and managing BullMQ queues.

## Quick Start

```bash
# From langwatch directory
pnpm run tool:cattleprod
```

You'll see an environment selector:
- **Local** - connects to `localhost:6379`
- **Development** - connects to AWS dev Redis (via Secrets Manager)
- **Staging** - connects via `kubectl port-forward`
- **Production** - connects via `kubectl port-forward`

Or skip the prompt with `--env`:

```bash
pnpm run tool:cattleprod -- --env local   # localhost:6379
pnpm run tool:cattleprod -- --env dev     # AWS dev
pnpm run tool:cattleprod -- --env prod    # kubectl port-forward
```

## Prerequisites

**Local:**
- Redis running on `localhost:6379`

**Development (AWS):**
- AWS CLI configured with `lw-dev` profile
- Access to AWS Secrets Manager

**Production/Staging:**
- `kubectl` installed and in your PATH
- Access to the Kubernetes cluster (`kubectl get pods` to verify)
- The tool will automatically run `kubectl port-forward svc/db-tunnel 6378:6379`

## Interactive Mode

The default mode is an interactive TUI with:
- Arrow key navigation
- Real-time queue monitoring with live updates
- Job inspection with scrollable data view
- One-click requeue with automatic attempt reset

**Keyboard shortcuts:**
- `↑↓` - Navigate lists
- `Enter` - Select/confirm
- `Escape` - Go back
- `q` - Quit
- `r` - Refresh / Requeue (context-dependent)
- `Space` - Pause/resume (in watch mode)

## CLI Commands

For scripting, use non-interactive commands (requires `--env`):

```bash
# List all queues
pnpm run tool:cattleprod -- --env prod list

# Inspect a job
pnpm run tool:cattleprod -- --env prod inspect <jobId>

# View failed jobs
pnpm run tool:cattleprod -- --env prod failed
pnpm run tool:cattleprod -- --env prod failed --queue {evaluations}
pnpm run tool:cattleprod -- --env prod failed --project-id proj_abc123

# Requeue failed jobs
pnpm run tool:cattleprod -- --env prod requeue --job-id <jobId>
pnpm run tool:cattleprod -- --env prod requeue --all --queue {evaluations}
pnpm run tool:cattleprod -- --env prod requeue --all -y  # Skip confirmation

# Watch queues (non-interactive)
pnpm run tool:cattleprod -- --env prod watch
```

## How Requeue Works

When you requeue a job, cattleprod:

1. Reads the job data from the failed queue
2. **Creates a new job first** (atomic safety - we never lose messages)
3. Removes the old job only after the new one is successfully created
4. The new job has a **reset attempt counter**

This is different from BullMQ's built-in retry, which keeps the attempt count. By resetting attempts, the job gets a fresh start and won't immediately fail due to hitting the max attempts limit.

**Atomic Safety:** The add-then-remove order ensures that even if the process crashes mid-operation, you'll never lose a job. Worst case, you might have a temporary duplicate (which is better than data loss).
