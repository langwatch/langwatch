---
name: server-cli
description: "The `npx @langwatch/server` CLI in apps/server: what it starts, its commands (start, doctor, install, reset), where it keeps state (~/.langwatch), the port slots, how to run it from source and how it is built and published. Use when someone says 'npx @langwatch/server', 'langwatch-server', 'the server CLI', 'apps/server', 'run LangWatch locally with one command', 'doctor', 'port-base', 'LANGWATCH_HOME', 'reset the local install', or 'pack-npm'. It is a packaged self-host tool, not the dev stack: for the dev stack use haven."
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

`src/predeps/` installs what the machine lacks (Postgres, Redis, ClickHouse, uv, pnpm,
goose, the AI gateway binary, opencode for langyagent); `src/services/` starts and supervises them
in two tiers (`runtime.ts`): the infrastructure tier (Postgres, Redis, ClickHouse) concurrently,
then the application tier concurrently (the LangWatch backend, NLP, langevals, AI gateway,
langyagent). The backend is one Node process, `apps/backend`, running the api and the worker
(`services/langwatch.ts`, ADR-168). There is no migration phase: the worker half runs the upgrade
in-process when the installation is behind while the api serves every route and reports not ready
until the ledger is current (see `upgrade`); `pnpm task upgrade` stays the deliberate run-once
command. `src/port-conflict/` shifts both port tiers by +10 when a slot is taken.

- Ports (`src/shared/ports.ts`): app tier `base` (app), `+1` nlp, `+2` langevals, `+3`
  gateway, `+4` langyagent, `+5` the worker half's health door; infra tier `base+1000` (Postgres), `+1001` Redis, `+1002` and
  `+1003` ClickHouse.
- State (`src/shared/paths.ts`): everything under `LANGWATCH_HOME`, default `~/.langwatch`
  (`bin/`, `data/`, `logs/`, `app/`, `.env`, `install-manifest.json`, `run/`).
- It ships the production build: the api and worker share one supervised process; the api
  holds the app port and the worker half opens its own health door.

## Run, test, build

```bash
pnpm dev:cli                                   # from source: pnpm --filter @langwatch/server dev
pnpm --filter @langwatch/server test           # unit tests in apps/server/test
pnpm --filter @langwatch/server test:invariants  # workspace + pack-npm filter invariants
pnpm build:cli                                 # nx run @langwatch/server:build
```

Always set `LANGWATCH_HOME` to a scratch directory before running it from source, so a
test does not touch the real `~/.langwatch`. Never run `reset` without it.

## Also exported

`@langwatch/server/task` (`src/task/task.executable.ts`) is the task executable other
packages import; `distribution-files.json` and `embeds.versions.json` pin what the
package ships.

## Process shape

The question whether the CLI runs api and worker in one process is answered: it does, through the
shared backend host (`@langwatch/process/backend-host`, ADR-168 Accepted, record §4). `dev-runtime`
reuses the same host. Do not change the CLI's process shape without a ruling.
