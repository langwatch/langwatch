# `npx @langwatch/server` — Shared Contract

**Status:** Draft v0.1 (drafted 2026-04-26)
**Owners:** @langwatch_npx_smith (CLI/predeps/UX) · @langwatch_npx_julia (services/.env/QA/CI)
**Purpose:** Single source of truth for `npx @langwatch/server`. Every BDD spec in `specs/npx-installer/` agrees with this file. Disagreements get resolved here first, code changes second.

---

## 1. Goal

A user with **only Node.js installed** runs:

```bash
npx @langwatch/server
```

…and ~3 minutes later has the **full LangWatch stack** running locally — control-plane, NLP, evaluators, AI gateway, workers — with a fresh project, generated credentials, and a browser open at `http://localhost:5560`.

This is parity with `make dev-full` from the dev tree, but for an end-user, **without a checkout, without Docker**, and without manual env editing.

---

## 2. Repo & package layout

| Component                      | Path                                        |
| ------------------------------ | ------------------------------------------- |
| Monorepo root                  | `/`                                         |
| Root pnpm workspace            | `/package.json`, `/pnpm-workspace.yaml`     |
| `@langwatch/server` package    | `/packages/server/`                         |
| CLI entry                      | `/packages/server/bin/langwatch-server.mjs` |
| Predep installer               | `/packages/server/src/predeps/`             |
| Service orchestration (julia)  | `/packages/server/src/services/`            |
| Shared types/paths/env (smith) | `/packages/server/src/shared/`              |
| BDD specs                      | `/specs/npx-installer/`                     |
| CI workflows                   | `/.github/workflows/npx-server-*.yml`       |

Existing `langwatch` (next.js app) becomes a workspace dep of `@langwatch/server`.

---

## 3. Pre-deps (forced multi-select)

The CLI shows a multi-select that **lists every pre-dep but does not allow de-selection**. User confirms with Enter.

| Pre-dep    | Why                                  | Install method                                 | Where                                                     |
| ---------- | ------------------------------------ | ---------------------------------------------- | --------------------------------------------------------- |
| uv         | drives langwatch_nlp + langevals     | `curl -LsSf https://astral.sh/uv/install.sh`   | `~/.cargo/bin/uv` (uv's default)                          |
| postgres   | Prisma data store                    | `embedded-postgres` npm package (binary embed) | `~/.langwatch/postgres/` (data + binary)                  |
| redis      | queues, caches                       | official binary build via `redis-server.zip`   | `~/.langwatch/redis/`                                     |
| clickhouse | analytics + traces                   | langwatch/clickhouse-serverless tarball (~100MB) | `~/.langwatch/clickhouse/`                                |
| go-gateway | AI Gateway (data plane)              | prebuilt monobinary from GH Releases           | `~/.langwatch/bin/aigateway-{os}-{arch}` |

**Skipped:** Go toolchain (we ship monobinaries built per platform — same matrix the helm/release pipeline already builds). Pnpm (npm/pnpm workspace install handles it transitively when `npx` resolves the package).

**Platform matrix** the CLI must handle:

| OS    | arch  | uv | postgres | redis | clickhouse | go-gateway |
| ----- | ----- | -- | -------- | ----- | ---------- | ---------- |
| macOS | arm64 | ✓  | ✓        | ✓     | ✓          | ✓          |
| macOS | x86   | ✓  | ✓        | ✓     | ✓          | ✓          |
| linux | arm64 | ✓  | ✓        | ✓     | ✓          | ✓          |
| linux | x86   | ✓  | ✓        | ✓     | ✓          | ✓          |
| win   | —     | —  | —        | —     | —          | —          |

Windows: out of scope for v1. Tracked separately.

**Idempotence:** every download checks `~/.langwatch/<dep>/.version` against the expected version and skips if matching. SHA256 verified on every download.

---

## 4. Local data layout (`~/.langwatch/`)

Authoritative in code: `packages/server/src/shared/paths.ts`.

```
~/.langwatch/
  .env                             # generated env (§6)
  install-manifest.json            # versions + checksums of every installed predep + last-run timestamp
  bin/                             # all predep binaries
    uv
    redis-server
    clickhouse
    aigateway
    postgres/
      bin/                         # postgres binaries (initdb, pg_ctl, postgres, psql)
      lib/
      share/
  data/
    postgres/                      # PGDATA (initdb target)
    redis/                         # appendonly + dump.rdb
    clickhouse/                    # user_files, store, metadata
  venvs/
    langwatch_nlp/                 # uv-managed .venv (julia)
    langevals/                     # uv-managed .venv (julia)
  logs/                            # per-service log files: <service>.log
  run/
    langwatch.pid                  # supervisor pidfile
    langwatch.lock                 # advisory lock — prevents two concurrent runs
    <service>.pid                  # per-service pidfile for clean shutdown
```

`~/.langwatch` is the **only** place the CLI writes outside its tarball. No global mutations. `LANGWATCH_HOME` env var overrides the location.

`npx @langwatch/server reset` = `rm -rf ~/.langwatch` after confirmation.

---

## 5. Port allocation

The CLI picks a **port-base** (default `5560`). Authoritative in code: `packages/server/src/shared/ports.ts`.

Two **blocks** with a fixed +1000 offset, leaving room for future services without colliding with infra:

| Service             | Offset      | Default | Block      |
| ------------------- | ----------- | ------- | ---------- |
| langwatch (Hono prod) | base + 0  | 5560    | services   |
| langwatch_nlp       | base + 1    | 5561    | services   |
| langevals           | base + 2    | 5562    | services   |
| ai-gateway (Go)     | base + 3    | 5563    | services   |
| _reserved_          | base + 4..7 |         | services   |
| bullboard           | base + 8    | 5568    | services (off by default — `--bullboard`) |
| _reserved_          | base + 9    |         | services   |
| postgres            | base + 1000 | 6560    | infra      |
| redis               | base + 1001 | 6561    | infra      |
| clickhouse HTTP     | base + 1002 | 6562    | infra      |
| clickhouse native   | base + 1003 | 6563    | infra      |
| _reserved_          | base + 1004..1009 |   | infra      |

**Conflict handling:** before binding, the CLI calls `lsof -i :<port>` (or net.Listen probe) for every allocated port. If any port is occupied, it shifts the entire allocation by `PORT_SLOT_INCREMENT = 10` and re-probes (services 5570 + infra 6570, then 5580 + 6580…), up to `MAX_PORT_SLOT_ATTEMPTS = 30`. The CLI prints:

> Port 5560 is already in use (held by `node` PID 12345). Falling back to 5570. To force a specific base, run `npx @langwatch/server --port 5580`. To free 5560, run `lsof -i :5560` and kill the process.

The resolved port-base is persisted to `install-manifest.json.lastPortBase`. `BASE_HOST`/`NEXTAUTH_URL` track the resolved langwatch port. Explicit `--port` flag wins — no auto-shift if user-specified port is busy (errors loudly).

---

## 6. Generated secrets and `.env` (`~/.langwatch/.env`)

Authoritative in code: `packages/server/src/shared/env.ts` (function `buildEnv`). Generated on **first run**, persisted, never overwritten on subsequent runs unless explicitly forced.

Mirrors the helm chart's `app/secrets.yaml` for the four secrets we have parity for, plus three additional secrets that are AI-Gateway-specific.

| Env var                       | Generation                                                | Helm chart equivalent              |
| ----------------------------- | --------------------------------------------------------- | ---------------------------------- |
| `NEXTAUTH_SECRET`             | `crypto.randomBytes(32).toString('base64')`               | `randAlphaNum 32` → b64            |
| `CREDENTIALS_SECRET`          | `crypto.randomBytes(32).toString('hex')` (64 hex chars)   | `randAlphaNum 64 \| sha256sum`     |
| `API_TOKEN_JWT_SECRET`        | `crypto.randomBytes(32).toString('hex')`                  | (no helm equiv — same pattern)     |
| `LW_VIRTUAL_KEY_PEPPER`       | `crypto.randomBytes(32).toString('hex')`                  | `randAlphaNum 64 \| sha256sum`     |
| `LW_GATEWAY_INTERNAL_SECRET`  | `crypto.randomBytes(32).toString('hex')`                  | `openssl rand -hex 32` (.env.example) |
| `LW_GATEWAY_JWT_SECRET`       | `crypto.randomBytes(32).toString('hex')`                  | `openssl rand -hex 32` (.env.example) |

Static (computed from port-base — code in `buildEnv`):

| Env var                  | Value                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `NODE_ENV`               | `production`                                                                                   |
| `BASE_HOST`              | `http://localhost:${ports.langwatch}`                                                          |
| `NEXTAUTH_URL`           | `http://localhost:${ports.langwatch}`                                                          |
| `PORT`                   | `${ports.langwatch}`                                                                           |
| `NEXTAUTH_PROVIDER`      | `email`                                                                                        |
| `DATABASE_URL`           | `postgresql://langwatch@localhost:${ports.postgres}/langwatch_db?schema=langwatch_db&connection_limit=5` |
| `REDIS_URL`              | `redis://localhost:${ports.redis}/0`                                                           |
| `CLICKHOUSE_URL`         | `http://localhost:${ports.clickhouseHttp}/langwatch`                                           |
| `LANGWATCH_NLP_SERVICE`  | `http://localhost:${ports.nlp}`                                                                |
| `LANGEVALS_ENDPOINT`     | `http://localhost:${ports.langevals}`                                                          |
| `LW_GATEWAY_BASE_URL`    | `http://localhost:${ports.langwatch}`                                                          |
| `DISABLE_PII_REDACTION`  | `true`                                                                                         |
| `ENVIRONMENT`            | `local`                                                                                        |

Provider keys (left blank in `.env`, propagated from process env if user has them set):

`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`, `GROQ_API_KEY`.

The CLI never writes user-provided provider keys to disk; they're injected into child env at start time only.

---

## 7. Service supervision

Authoritative in code: `packages/server/src/shared/runtime-contract.ts` (`RuntimeApi` interface) and `packages/server/src/services/runtime.ts` (julia, implementation).

The CLI flow (smith) is:

```ts
const runtime = await loadRuntime(); // dynamic import of services/runtime.ts, falls back to placeholder
const ctx: RuntimeContext = { ports, paths, predeps, envFile, version };

await runtime.scaffoldEnv(ctx);            // (1) write ~/.langwatch/.env if missing
await runtime.installServices(ctx);        // (2) uv sync for langwatch_nlp + langevals (parallel)
const handles = await runtime.startAll(ctx); // (3) spawn every service, return handles
await runtime.waitForHealth(ctx, { timeoutMs: 60_000 }); // (4) block until every health check passes
// CLI listens on runtime.events(ctx) throughout, renders listr2 + tees logs

process.on("SIGINT", async () => {
  await runtime.stopAll(handles);          // (5) graceful SIGTERM → SIGKILL fallback
});
```

Inside `startAll(ctx)`:

| Phase | Services started concurrently                  | Wait for                                      |
| ----- | ---------------------------------------------- | --------------------------------------------- |
| 1     | postgres, redis, clickhouse                    | `pg_isready`, `redis-cli ping`, `curl /ping` |
| 2     | (run prisma migrate + clickhouse goose)        | exits 0                                       |
| 3     | langwatch_nlp, langevals, ai-gateway, langwatch | `curl /health` (or `/healthz` for gateway), `/api/health` for langwatch |

Each child writes stdout+stderr to `~/.langwatch/logs/<service>.log`. The runtime emits `RuntimeEvent`s via `events(ctx)`:

```ts
type RuntimeEvent =
  | { type: "starting"; service: string }
  | { type: "healthy"; service: string; durationMs: number }
  | { type: "log"; service: string; stream: "stdout" | "stderr"; line: string }
  | { type: "crashed"; service: string; code: number };
```

The CLI consumes events to render the listr2 status grid and tee log lines to TTY (prefixed + colored). No synchronous coupling between runtime and CLI animation.

`Ctrl+C` triggers `stopAll(handles)`: SIGTERM each handle in reverse start order, 10s grace, then SIGKILL. `~/.langwatch/run/<service>.pid` files are removed on clean exit. The supervisor pidfile (`~/.langwatch/run/langwatch.pid`) doubles as a re-entry guard — second concurrent `npx @langwatch/server` invocations refuse to start with a clear "already running" error.

Crash policy: any non-langwatch service crash emits `{ type: "crashed", code }` and the CLI calls `stopAll(handles)` followed by exit 1. The langwatch app (in-proc workers) is allowed up to 3 restarts in 60s before the same fate.

---

## 8. First-run UX

```
$ npx @langwatch/server

▌ LangWatch v3.1.0

  Pre-dependencies (all required):
  > [x] uv          (Python package manager)
    [x] postgres    (data store)
    [x] redis       (queues)
    [x] clickhouse  (analytics)
    [x] go-gateway  (AI Gateway)
  ↵ confirm

  ↓ Downloading pre-dependencies
    ✔ uv          12.4 MB · 0.8s
    ✔ postgres    61.2 MB · 4.1s
    ✔ redis        2.1 MB · 0.3s
    ✔ clickhouse  98.7 MB · 6.2s
    ✔ go-gateway  18.3 MB · 1.4s
  ✔ Pre-dependencies ready · 12.8s

  ↓ Installing service dependencies (parallel)
    ✔ langwatch_nlp  uv sync · 124 packages · 41s
    ✔ langevals      uv sync · 38 packages  · 9s
  ✔ Service dependencies ready · 41s

  ↓ Generating secrets and .env
  ✔ ~/.langwatch/langwatch.env

  ↓ Starting services
    ✔ postgres       127.0.0.1:6032 · 1.2s
    ✔ redis          127.0.0.1:6379 · 0.4s
    ✔ clickhouse     127.0.0.1:8123 · 3.1s
    ✔ langwatch_nlp  127.0.0.1:5561 · 2.4s
    ✔ langevals      127.0.0.1:5562 · 1.8s
    ✔ ai-gateway     127.0.0.1:5563 · 0.3s
    ✔ langwatch      127.0.0.1:5560 · 8.2s
  ✔ All services healthy · 8.2s

  → Opening http://localhost:5560

  [langwatch    ] Listening on :5560
  [nlp          ] Uvicorn running on :5561
  [langevals    ] Uvicorn running on :5562
  [gateway      ] Listening on :5563
  ...
```

Animation: **listr2** with `default` renderer for the headers; child task output is the running tally. Once supervision phase begins, control hands off to **concurrently**-style log multiplexing (one prefixed line per service stdout chunk).

Auto-open browser on macOS (`open`) and Linux (`xdg-open`). Skip if `--no-open` or `$CI` set.

---

## 9. CI matrix (julia)

`.github/workflows/npx-server-smoke.yml`

Triggers:
- `workflow_dispatch` (manual)
- `schedule: '0 4 * * *'` (nightly 04:00 UTC)
- `push` paths: `package.json`, `pnpm-workspace.yaml`, `packages/server/**`, `langwatch_nlp/pyproject.toml`, `langevals/**/pyproject.toml`, `services/aigateway/**`, `langwatch/package.json`, `langwatch/scripts/**`

Matrix:
- `macos-latest` (arm64)
- `ubuntu-22.04` (x86_64)
- `ubuntu-22.04-arm` (arm64) — github-hosted arm runners

Each job:
1. checkout
2. set up node 24
3. `pnpm install --frozen-lockfile`
4. `pnpm --filter @langwatch/server build`
5. `npm pack` the workspace into a tarball
6. **fresh sandbox dir** (`mktemp -d`) to simulate a clean user
7. `npx /path/to/tarball.tgz --no-open --port 5560` in the sandbox with `CI=1`
8. wait up to 5 minutes for `curl localhost:5560/api/health` → 200
9. POST a workflow execution → assert 200 and trace recorded
10. POST an evaluator (langevals path) → assert 200
11. tear down (`SIGTERM` → wait → SIGKILL)

A failure on any step uploads `~/.langwatch/logs/` as a workflow artifact.

---

## 10. Publish (julia)

`.github/workflows/npx-server-publish.yml`

Triggers:
- on `release.published` where the tag is **the main langwatch release** (currently `v3.1.0`-style — same as `release-langwatch-chart.yml`).
- `workflow_dispatch` (manual override)

Steps:
1. checkout
2. setup node 24 + pnpm
3. `pnpm --filter @langwatch/server build` (which builds langwatch app + monobinary references)
4. `pnpm --filter @langwatch/server publish --access public --no-git-checks`

Version is read from `langwatch/package.json`. The `@langwatch/server` package version is **always equal** to the langwatch app version. A pre-publish step asserts both versions match the GH release tag, fails fast if not.

---

## 11. Rip-out list

| Path                                                  | Reason                                              |
| ----------------------------------------------------- | --------------------------------------------------- |
| `/pyproject.toml`                                     | uvx publish path replaced by npm                    |
| `/build_hooks.py`                                     | hatchling build hook — gone                         |
| `/bin/cli.py`, `/bin/__init__.py`                     | python CLI replaced by `packages/server/bin/...`    |
| `/uv.lock`                                            | only uv root lock; per-service uv locks stay        |
| `/.github/workflows/langwatch-server-publish.yml`     | replaced by `npx-server-publish.yml`                |
| `Makefile` targets `python-build`, `python-install`, `start` | uv/pip flow gone; `start` redundant with new CLI |

**Keep** `.python-version` (used by langwatch_nlp + langevals).

---

## 12. Open questions

- [x] Postgres in or out of pre-deps? **In** — Prisma needs it, helm chart has it, compose.dev.yml has it.
- [ ] Quickwit/Elasticsearch? Currently not in compose.dev.yml — test if app boots without it. If yes, skip; if no, add as a fifth predep or shim with a no-op.
- [ ] Should we ship the langwatch next.js app **prebuilt** in the npm tarball, or build on first run? Prebuilt = faster first-run, larger tarball. **Recommend prebuilt** (build at publish, not at install).
- [ ] When the user has an `OPENAI_API_KEY` in env, should the CLI propagate it into `~/.langwatch/langwatch.env`? **Yes**, but read-only — don't persist user secrets to disk.

---

## 13. Definition of done

A CI job on every supported OS+arch:
1. runs `npx @langwatch/server` from a fresh tarball
2. waits for all services to be healthy
3. logs into the UI, creates a project (`POST /api/auth/...`)
4. submits a workflow execution that hits langwatch_nlp
5. submits an evaluator that hits langevals
6. submits a chat completion through the AI Gateway

…and the human-driven QA (julia, browser-qa skill) does the same flow plus visual checks, with screenshots embedded in the PR.
