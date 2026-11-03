---
name: server-cli
description: "The `npx @langwatch/server` CLI in apps/server: what it starts, its commands (start, doctor, install, reset), where it keeps state (~/.langwatch), the port slots, how to run it from source and how it is built and published. Use when someone says 'npx @langwatch/server', 'langwatch-server', 'the server CLI', 'apps/server', 'run LangWatch locally with one command', 'doctor', 'port-base', 'LANGWATCH_HOME', 'reset the local install', 'pack-npm', 'app archive' or 'LANGWATCH_APP_ARCHIVE'. It is a packaged self-host tool, not the dev stack: for the dev stack use haven."
user-invocable: true
argument-hint: "[start | doctor | install | reset]"
---

# apps/server, the npx CLI

`apps/server` is `@langwatch/server`: `npx @langwatch/server` runs the whole LangWatch
stack on one machine for a user, not a contributor. It is a process app in the record's
sense (main entry plus config, no product code), but it supervises other processes rather
than composing modules. The dev stack is `haven` or `pnpm dev`; do not confuse them.

Entry: `apps/server/src/cli.ts` (commander). The published bin is `langwatch-server`
(`dist/cli.cjs`, built by `scripts/build.ts`).

## Commands

| Command                                 | Does                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `langwatch-server` or `start` (default) | installs missing predeps, scaffolds `.env`, starts every service, opens the browser      |
| `doctor`                                | reports which predeps and services are installed and the resolved ports; changes nothing |
| `install`                               | installs predeps and services without starting anything                                  |
| `reset`                                 | deletes `~/.langwatch` (binaries, data, env) so the next run is a clean install          |

`start` flags: `--port-base <n>` (first port slot, default 5560), `-y/--yes`,
`--no-open`, `--dry-run` (print ports and paths, do nothing). Confirm any other flag with
`pnpm --filter @langwatch/server dev --help`.

## What it manages

`src/predeps/` installs what the machine lacks (the prebuilt app, Postgres, Redis, ClickHouse, uv,
pnpm, goose, the AI gateway binary, opencode for langyagent); `src/services/` starts and supervises them
(`runtime.ts`). Each service starts once what it needs is there (`RuntimeContext.predepsReady`):
the stores on their own binaries while the app still downloads, the Go services and langyagent
after the stores, the backend once the app and the stores are in place, and langevals once its
uv environment is ready; nothing waits on langevals, but a service failing its first boot still
takes the stack down. The backend is one Node process, `pnpm run start` in `apps/backend`
(`resolvePnpm`: the bundled pnpm first), running the api and the worker
(`services/langwatch.ts`, ADR-168); doctor's upgrade status is `pnpm run task upgrade status`. There is no migration phase: the worker half runs the upgrade
in-process when the installation is behind while the api serves every route and reports not ready
until the ledger is current (see `upgrade`); that upgrade still runs pnpm, so the pnpm predep stays.
`src/port-conflict/` shifts both port tiers by +10 when a slot is taken (one `lsof` run).

The CLI holds the public app port itself (`services/boot-door.ts`): within a second of start it
answers a "Starting LangWatch" page (the api's console look, `renderConsolePage`) that streams
each service's state, through the same liveness door the api uses (`@langwatch/process/liveness-thread`).
Once the backend's `/api/health` answers, the door forwards to the backend's internal port and the
page reloads into the app; a failed first boot shows its reason and the logs directory. Once the app is
unpacked the door also serves its hashed `/assets/*` (cached for good) and the page prefetches
the entry scripts and styles from `index.html`; the index itself stays the api's.

Databases (`services/database-choice.ts`, spec 10): the first interactive run asks one question
(bundled, the default, or my own), then per database; `--databases` asks again; `--yes`, CI or
no terminal means bundled. A brought database is connected before it is saved (Postgres connect
and `select 1`, Redis AUTH + PING over a plain socket, ClickHouse `/ping`). The answer is the
.env's three URLs: one naming localhost, 127.0.0.1 or ::1 on the bundled port is bundled; any
other is brought, never downloaded or started, and doctor checks it instead of the bundled one.

The terminal (spec 11-terminal-output): services start at LOG_LEVEL, else info with `--verbose`,
else warn (`src/shared/log-level.ts` maps it to each service's own knob). Every line still goes to
`~/.langwatch/logs/<service>.log`; by default the terminal shows only progress, the CLI's notices,
a service's JSON error records as one line, and a crash with the last 20 lines of that log
(`terminalRenderer` in `animation/log-tee.ts`). `--verbose` or LOG_LEVEL shows every line.

- Ports (`src/shared/ports.ts`): app tier `base` (the public door), `+1` nlp, `+2` langevals, `+3`
  gateway, `+4` langyagent, `+5` the worker half's health door, `+6` the backend's internal port;
  infra tier `base+1000` (Postgres), `+1001` Redis, `+1002` and `+1003` ClickHouse. User-facing URLs
  (`BASE_HOST`) keep the public port; the Go services dial the internal port directly.
- State (`src/shared/paths.ts`): everything under `LANGWATCH_HOME`, default `~/.langwatch`
  (`bin/`, `data/`, `logs/`, `app/<version>/`, `.env`, `install-manifest.json`, `run/`).
- It runs the production build: the api and worker share one supervised process; the api
  listens on the internal port behind the CLI's door and the worker half opens its own health door.

## The prebuilt app (ADR-180)

The npm package is the CLI alone (`dist/cli.cjs`, `package.json`, `README.md`, `LICENSE.md`).
The app ships as one archive per platform, `langwatch-app-<slug>.tar.gz` plus `.sha256` on
the GitHub release `v<version>` beside the AI gateway binaries (slugs `linux-amd64`,
`linux-arm64`, `darwin-amd64`, `darwin-arm64`). The `app` predep (`src/predeps/app.ts`)
downloads it, verifies the checksum, extracts beside `~/.langwatch/app/<version>/`, renames
it into place, then removes other versions and an older CLI's flat tree; `data/` is never
touched. A tree without `.langwatch-app-complete` is downloaded again. No pnpm install and
no build runs on the user's machine; `uv` still prepares the langevals environment. The archive
carries the tokenizer files (`tiktoken/`, `tiktoken-python/`), so a first start downloads none.

- `LANGWATCH_APP_ARCHIVE` (a path or URL, with its `.sha256` beside it) installs a local
  archive instead of the release download. The smoke workflow boots through it.
- From a checkout (`pnpm dev:cli`) the CLI runs the checkout in place and downloads nothing.
  The checkout needs your own `pnpm install` and `pnpm run build:server`; the CLI says so.
- The CLI refuses Node older than 24 and Linux on musl (it points at the Docker image).
- The archive is the production image's tree: `infra/docker/prune-runtime-tree.sh` is the one
  prune recipe both run (`deps` installs production dependencies, `built` drops what no
  process runs). `dev/scripts/build-app-archive.sh` builds it, `dev/scripts/check-app-archive.sh`
  checks it before it ships.

## Run, test, build

```bash
pnpm dev:cli                                   # from source: pnpm --filter @langwatch/server dev
pnpm --filter @langwatch/server test           # unit tests in apps/server/test
pnpm --filter @langwatch/server test:invariants  # workspace, npm pack and app archive invariants
pnpm build:cli                                 # nx run @langwatch/server:build
pnpm run build:server && pnpm pack:app         # this machine's app archive into _pack/, checked
pnpm pack:npm                                  # the CLI-only npm package
```

Always set `LANGWATCH_HOME` to a scratch directory before running it from source, so a
test does not touch the real `~/.langwatch`. Never run `reset` without it. To boot an archive
the way a user would, run the built `dist/cli.cjs` from outside the checkout (a copy under a
`node_modules/@langwatch/server` directory) with `LANGWATCH_APP_ARCHIVE` set; run in place it
is a checkout run and ignores the archive.

## Also exported

`src/task/task.executable.ts` is the workspace member's `./task` export; the published package
does not carry it (nothing outside the repo imports it). `embeds.versions.json` pins the
Postgres and Redis builds the predeps download.

## Process shape

The question whether the CLI runs api and worker in one process is answered: it does, through the
shared backend host (`@langwatch/process/backend-host`, ADR-168 Accepted, record §4). `dev-runtime`
reuses the same host. Do not change the CLI's process shape without a ruling.
