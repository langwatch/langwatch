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

```
~/.langwatch/
  langwatch.env                    # generated env (3.5 below)
  state.json                       # version + port-base + last-run timestamp
  bin/
    aigateway-{os}-{arch}          # gateway monobinary
  postgres/
    bin/                           # postgres binaries
    data/                          # PGDATA
  redis/
    redis-server                   # binary
    redis.conf
    dump.rdb
  clickhouse/
    clickhouse                     # binary
    data/                          # ClickHouse data dir
    config.xml
  venvs/
    langwatch_nlp/                 # uv-managed .venv
    langevals/                     # uv-managed .venv
  logs/
    YYYY-MM-DD/<service>.log
  pids/
    <service>.pid                  # for clean shutdown
```

`~/.langwatch` is the **only** place the CLI writes outside its tarball. No global mutations.

---

## 5. Port allocation

The CLI picks a **port-base** (default `5560`). Every service derives its port from the base:

| Service             | Offset    | Default | Env var                    |
| ------------------- | --------- | ------- | -------------------------- |
| langwatch (control) | base + 0  | 5560    | `APP_PORT`                 |
| langwatch_nlp       | base + 1  | 5561    | `LANGWATCH_NLP_PORT`       |
| langevals           | base + 2  | 5562    | `LANGEVALS_PORT`           |
| ai-gateway (Go)     | base + 3  | 5563    | `LW_GATEWAY_PORT`          |
| postgres            | base + 472 (= 6032 default) | 6032 | `POSTGRES_PORT`     |
| redis               | base + 819 (= 6379 default) | 6379 | `REDIS_PORT`        |
| clickhouse (HTTP)   | base + 2563 (= 8123 default) | 8123 | `CLICKHOUSE_PORT`  |
| bullboard           | base + 820  | 6380    | `BULLBOARD_PORT`           |

**Conflict handling:** if any port in the set is in use, the CLI shifts the **app-tier** ports (5560/61/62/63) by +10 and re-checks. Up to 10 retries (5560 → 6560). Infra-tier ports (postgres/redis/clickhouse) are bound to localhost-only and use a per-install random offset on first run, persisted to `state.json` to avoid re-binding conflicts. The CLI prints both:

> Port 5560 is already in use. Falling back to 5570. To force a specific base, run `npx @langwatch/server --port 5580`. To free 5560, run `lsof -i :5560` and kill the process.

`BASE_HOST`/`NEXTAUTH_URL` track the resolved app port.

---

## 6. Generated secrets (`~/.langwatch/langwatch.env`)

Mirrors the helm chart's `app/secrets.yaml`. Generated on **first run**. Persisted. Re-runs read existing values.

| Env var                       | Generation                                                | Source of truth (helm)             |
| ----------------------------- | --------------------------------------------------------- | ---------------------------------- |
| `NEXTAUTH_SECRET`             | `crypto.randomBytes(32).toString('base64')`               | `randAlphaNum 32` → b64            |
| `CREDENTIALS_SECRET`          | `crypto.randomBytes(32).toString('hex')` (64 hex chars)   | `randAlphaNum 64 \| sha256sum`     |
| `API_TOKEN_JWT_SECRET`        | `crypto.randomBytes(32).toString('hex')`                  | (no helm equiv — same pattern)     |
| `LW_VIRTUAL_KEY_PEPPER`       | `crypto.randomBytes(32).toString('hex')`                  | `randAlphaNum 64 \| sha256sum`     |
| `LW_GATEWAY_INTERNAL_SECRET`  | `crypto.randomBytes(32).toString('hex')`                  | `openssl rand -hex 32` (.env.example) |
| `LW_GATEWAY_JWT_SECRET`       | `crypto.randomBytes(32).toString('hex')`                  | `openssl rand -hex 32` (.env.example) |
| `CRON_API_KEY`                | `crypto.randomBytes(16).toString('hex')`                  | `randAlphaNum 32`                  |

Static (from port-base):

| Env var                  | Value                                                        |
| ------------------------ | ------------------------------------------------------------ |
| `NODE_ENV`               | `production`                                                 |
| `BASE_HOST`              | `http://localhost:${APP_PORT}`                               |
| `NEXTAUTH_URL`           | `http://localhost:${APP_PORT}`                               |
| `NEXTAUTH_PROVIDER`      | `email`                                                      |
| `DATABASE_URL`           | `postgresql://langwatch:langwatch@localhost:${POSTGRES_PORT}/langwatch?schema=langwatch_db` |
| `REDIS_URL`              | `redis://localhost:${REDIS_PORT}`                            |
| `CLICKHOUSE_URL`         | `http://default:langwatch@localhost:${CLICKHOUSE_PORT}/langwatch` |
| `LANGWATCH_NLP_SERVICE`  | `http://localhost:${LANGWATCH_NLP_PORT}`                     |
| `LANGEVALS_ENDPOINT`     | `http://localhost:${LANGEVALS_PORT}`                         |
| `LW_GATEWAY_BASE_URL`    | `http://localhost:${APP_PORT}`                               |
| `DISABLE_PII_REDACTION`  | `true`                                                       |
| `DISABLE_USAGE_STATS`    | unset (let user opt-out via flag)                            |
| `RELEASE_UI_*`           | unset (default release rules apply)                          |

The langevals/postgres/redis/clickhouse passwords are **fixed** at install time (we own the binaries — no risk surface). Cookie/JWT/encryption secrets are **freshly random** on first install.

---

## 7. Service supervision

After predeps + .env scaffold, the CLI starts services as long-lived child processes:

| Order | Service        | Started by                               | Health check                                               |
| ----- | -------------- | ---------------------------------------- | ---------------------------------------------------------- |
| 1     | postgres       | `pg_ctl start` from embedded-postgres    | `pg_isready` returns 0                                     |
| 2     | redis          | `redis-server redis.conf --daemonize no` | `redis-cli ping` returns `PONG`                            |
| 3     | clickhouse     | `clickhouse server -C config.xml`        | `curl /ping` returns `Ok.`                                 |
| 4     | langwatch_nlp  | `uv run uvicorn ...` from venv           | `curl /health`                                             |
| 5     | langevals      | `uv run uvicorn ...` from venv           | `curl /health`                                             |
| 6     | ai-gateway     | exec the monobinary                      | `curl /healthz`                                            |
| 7     | langwatch app  | `node` running pre-built bundle          | `curl /api/health` returns 200                             |
| 8     | langwatch workers (in-proc) | `START_WORKERS=true` on the app | included in app health                                     |

Order 1–6 start in parallel where deps allow (1/2/3 are leaves; 4/5 depend on 1+2+3; 6 depends on 1+2; 7 depends on 1+2+3+4+5+6). Logs interleave under one TTY with service-name prefix and color (mimics `pnpm dev`).

`Ctrl+C` triggers a fan-out SIGTERM with a 10s grace then SIGKILL. PIDs in `~/.langwatch/pids/`.

Crash policy: any service crash kills the whole process group. The user gets a clear error and a hint (e.g. `redis exited with code 137 — out of memory? See ~/.langwatch/logs/<date>/redis.log`).

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
