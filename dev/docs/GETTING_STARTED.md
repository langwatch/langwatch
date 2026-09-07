# Getting started

LangWatch is an LLM ops platform: evaluation, observability and optimisation for
AI agents and pipelines. This page is the shortest path from a fresh clone to a
running stack, plus the handful of rules that save you a bad afternoon.

## What is actually in here

Four Node applications, two Go services and a Python evaluator suite, all in one
pnpm workspace with one lockfile at the root.

```
langwatch/
├── apps/
│   ├── ui/         browser application, Vite SPA          :5560
│   ├── api/        tRPC + REST + SSE                      :6560
│   ├── worker/     queues, schedulers, projections
│   ├── tasks/      one-shot migrations and backfills
│   └── server/     the `npx @langwatch/server` CLI
├── services/
│   ├── aigateway/  Go, virtual-key traffic to providers   :5563
│   ├── nlpgo/      Go, optimisation studio + evaluators   :5561
│   └── langevals/  Python evaluators
├── packages/
│   ├── features/<name>/{contract,server,web}   one feature each
│   └── ...         shared workspace packages
├── sdks/           python, typescript, go
├── specs/          the requirements, in Gherkin
└── dev/            these docs, the scripts, the compose files
```

Three of the Node applications run all the time: `ui`, `api` and `worker`. There
is no in-process worker mode and no process-role switch, on purpose. A stack
missing the worker serves pages and quietly processes no jobs, which looks
exactly like a healthy one right up to the moment you expected a job to have
run.

A feature is up to three workspace packages under one name. `contract` holds the
schemas, errors and the abstract service other features call. `server` holds
services, repositories, adapters and transport. `web` holds models, hooks and
screens. Most features have two of the three, and none of them need all three to
be a real feature.

`specs/` holds the Gherkin, and those feature files are the requirements rather
than a description written afterwards.

## What you need installed

Node 24, pnpm 10 through corepack, and Go 1.26 for the two Go services. That is
the floor.

```bash
corepack enable
pnpm install
pnpm start:prepare:files
```

The last one writes the generated files: the Prisma client, the evaluator types,
the Langy skills. A fresh clone or a fresh worktree needs it before anything
type-checks, and "Cannot find module `.prisma/client`" is almost always this and
nothing else. Install from the root, always: pnpm walks up anyway, and a
subdirectory install resolves the whole workspace regardless.

You also need Postgres, Redis and ClickHouse from somewhere. Run them natively
(brew, or a LaunchAgent), point `.env` at them, set `LANGWATCH_HAVEN_CH=0` and
`LANGWATCH_HAVEN_OBS=0`, and the entire day-to-day loop runs with no container
runtime installed at all. Unit tests never needed one either. What still wants a
container is the Grafana observability stack and the sandboxed Langy tiers, and
both are opt-in.

## One `.env`, at the workspace root

There is exactly one and it lives at the root. `apps/ui`'s Vite config loads
`../../.env`, the api and worker start scripts pass the same path to
`--env-file-if-exists`, and there is no per-application dotenv any more. Start
from `.env.example`.

`packages/secrets/keys.json` classifies the 40 variables that carry a
credential: 29 `secret`, 10 `composite` (a connection string, so shape and
password in one value) and 1 `pointer` (it names a credential on disk).
Everything else is `config` and stays as free to print, log and paste into an
issue as it is today. One file, parsed by TypeScript with Zod and read by haven
in Go, so a key added once is masked in both languages.

Each application resolves the classified keys through an ordered chain before
its Zod parse: shell environment and `.env` first, then 1Password if you opted
in, then a refusal naming exactly what is missing. Do nothing and nothing
changes. To keep credentials off your disk, set `LANGWATCH_SECRETS_VAULT` to a
vault name and write `op://vault/item/field` where the value used to be.
Resolution is never attempted when `NODE_ENV=production`, so a pod reads the
environment Kubernetes gave it and holds no vault client.

One rule, and it is not negotiable: never read `.env` to find a value, and never
print one. `haven env` masks every classified key, `haven env --reveal` is the
one you do not paste anywhere, and the `langwatch/secrets-through-source` lint
rule refuses `process.env.<SECRET_KEY>` outside the secrets package. See
[ADR-132](adr/132-secrets-are-not-config.md).

## Starting the stack

Plain `pnpm dev` is the default for TypeScript work.

```bash
pnpm dev            # ui + api + workers, plus the Go services
pnpm dev:ui         # the browser application alone
pnpm dev:api        # the API alone
pnpm dev:worker     # the background worker alone
```

Every port derives from `PORT` (default 5560): the ui lane binds it, the api
lane `PORT + 1000`, the worker's metrics listener `PORT - 2561`, the gateway
`PORT + 3`. A second stack is `PORT=5570 pnpm dev`. If the ports are already
held, `dev/scripts/check-ports.sh` refuses to start and prints two pasteable
options, one of which kills only the node processes on those exact ports. Do not
go hunting processes by hand.

Hostname routing is the alternative, and it is opt-in.

```bash
make haven up          # start this worktree's stack
make haven status      # every stack, service health, shared servers
haven logs api -t      # tail one lane from any terminal
```

haven gives every worktree's services a stable hostname through the portless
proxy: `app|gateway|nlp.<slug>.langwatch.localhost`, where the slug is the
worktree's own directory name. The UI and its API share one origin, so the UI is
`app.<slug>...` and the API is `app.<slug>.../api`. `.localhost` resolves to
loopback natively, which means no `/etc/hosts`, no DNS and no sudo, and two
worktrees can never collide. Details in `tools/thuishaven/README.md`.

For containers, `make quickstart` is the single entry point. It asks what you
are working on, starts only those services, and writes `.env.dev-up` listing
only the URLs whose services are local. Your `.env` stays the source of truth
for everything else.

```bash
make quickstart              # interactive preset picker
make quickstart all-local    # local CH + PG + Redis + app + workers
make quickstart-help         # non-interactive preset reference
make down                    # stop all services
```

## The everyday commands

```bash
pnpm typecheck                              # apps/api, apps/worker, apps/ui
pnpm typecheck:one @langwatch/trace-server  # one package, seconds not minutes
pnpm typecheck:all                          # every package. What CI runs
pnpm lint                                   # oxlint + architecture-lint
pnpm format                                 # oxfmt
pnpm --filter @langwatch/platform-api test  # one package's suite
```

`pnpm typecheck` is a fanout over three applications and it does include their
tests. It does not reach the other ~180 workspace packages, so iterate with
`typecheck:one` on what you touched and run `typecheck:all` once before you
push. Tests are per package: each application and each feature package owns its
own `vitest.config.ts` and its own `test` script.

All of those go through a machine-wide queue, and it is worth knowing why. One
typecheck holds a 2.3 to 3.5 GiB working set and uses every core, which is fine
once and ruinous four times over. `dev/scripts/check-queue.mjs` counts the runs
live across every worktree, terminal and agent on the machine against a single
counter, and a run past the limit waits its turn instead of piling on. With a
slot free it prints nothing. Queued, it says so on stderr, which is the thing
that tells you a slow run was waiting rather than hung. `node
dev/scripts/check-queue.mjs --explain` shows the limit and who holds a slot.
Never set `CHECK_SLOTS` yourself.

## How work starts here

Check `specs/` before you implement anything.

```bash
ls specs/
cat specs/foo/bar.feature
```

If no feature file covers your task, write one first. Error paths belong in it
alongside the golden path: name the expected failures, give each a stable code
and customer-safe copy, and remember that a scenario enforces nothing until it
carries a binding tag (`@unit`, `@integration`, `@e2e` or `@regression`) and a
`@scenario "<title>"` annotation on the test that covers it. An untagged feature
file reports "all bound" while binding nothing at all.

## Where to read next

- [CODING_STANDARDS.md](CODING_STANDARDS.md) - clean code, SOLID and CUPID
- [TESTING_PHILOSOPHY.md](TESTING_PHILOSOPHY.md) - test hierarchy, BDD workflow
- [best_practices/](best_practices/) - language and framework conventions, including error handling
- [adr/](adr/) - the accepted architecture decisions, which stay authoritative
- [WORKTREES.md](WORKTREES.md) - working on several branches at once
- `CLAUDE.md` and `AGENTS.md` at the root - the operating contract, and the mistakes worth not repeating

If something here disagrees with an ADR, the ADR wins and this page is stale.
Fix it.
