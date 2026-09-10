# Lane brief: module conversion on the annotated runtime

This is the digest a lane reads instead of exploring. It names the exemplar
file for every shape, the rules, and the report format. A lane that reads this
and the exemplar files it names has everything it needs; ADR-133 and ADR-134
are the background, not the recipe.

## The target shape, per baseline row

Rows live in `packages/architecture-lint/src/feature-shape-baseline.json` as
`<module>|<rule>`. Each rule has one exemplar to copy exactly.

| rule | what closes it | copy exactly |
| --- | --- | --- |
| `contract-service` | the abstract `*Service` class in `modules/<m>/contract/src` is folded into `<M>Api` and deleted; every consumer takes the api; nullable reads are `find*` | `git show 0d84f8309d` (evaluator), `git show 2c3156986a` (experiment) |
| `legacy-transport-runtime` | tRPC namespaces declared with `defineTrpcContract` in the contract and served by `defineTrpcRouter`; REST families declared with `defineRestRouter` | tRPC: `modules/organization/contract/src/team.trpc.ts` and `modules/organization/server/src/transport/team.trpc.ts`. REST: `modules/api-key/server/src/transport/api-key.rest.ts`, and `modules/agent/server/src/transport/agent-connect.rest.ts` for bound facts and public access |
| `nested-transport` | no subdirectory under `transport/`; one file per namespace or family | `modules/organization/server/src/transport/` |
| `persistence-adapter`, `postgres-without-memory`, `unregistered-repositories` | `repositories/{prisma,memory}` behind interfaces, registered in `repositories/<m>-repositories.registry.ts` with `defineRepositories`; `PrismaClient` named only under `repositories/prisma` | `modules/project/server/src/repositories/` (interface, registry, prisma, memory) |
| `no-installer`, `installer-not-booted` | `modules/<m>/server/src/<m>.server.ts` is `defineModule("<m>").withRepositories(...).withApp(<M>App).withTransports(...)`; `installApi<M>` in `apps/api/src/features/<m>/<m>.composition.ts` boots it at `role: "api"` with a memory-backed boot test | `modules/organization/server/src/organization.server.ts`, `apps/api/src/features/organization/organization.composition.ts` and its `__tests__/organization.composition.integration.test.ts` |
| `refusing-composition` | the `refusing<M>Feature` twin is deleted; a process without the module's infrastructure refuses through the installer or throws at compose time | `git show 8857f70144` (ops) |
| `nested-web-entry` | screens under `modules/<m>/web/src/screens/` become `src/ui/sections/*-screen.tsx` behind one top-level entry the catalogue points at | `git show 7614b73cb7` (auth) |
| `testing-entry`, `fixtures-directory` | fixtures move to `app/__tests__/<m>.fixture.ts`; the `./testing` export goes; each external consumer builds its own double | `modules/evaluator/server/src/app/__tests__/evaluator.fixture.ts` |

The wire is pinned to origin/main: procedure and route names, paths, inputs,
outputs, statuses and permissions do not change. Find the old router with
`git grep -n "<name>" origin/main -- platform/app/src/server/api/routers` and
record every unavoidable delta with its reason. A status collapsed to 200 or a
setting that stopped being configurable is a regression, not a delta.

## Rules that fail review

No git write commands (add, commit, stash, checkout, reset, restore, mv).
No whole-application typecheck or lint (`pnpm typecheck`, `tsc -p apps/...`,
`pnpm lint`, `pnpm format`); `pnpm typecheck:one <package dir>` and
`tsc --noEmit --ignoreConfig <file>` only. Vitest only as
`VITEST_MAX_WORKERS=2 pnpm --filter <package> test:unit <paths>`, touched files
while working, the package suite once at the end, never backgrounded, and
`pkill -f "vitest/dist/workers"` after an interruption. Dependencies through
`env -u CI pnpm install --filter "<package>..."`. Never read `.env*`. No
subagents, no forks.

Shared files are the coordinator's; hand over exact lines instead:
`apps/api/src/app/api-production.composition.ts`,
`apps/api/src/app-trpc/app-trpc.features.ts`, `app-trpc.namespaces.ts`,
`apps/api/src/app-rest/api-rest.doors.ts`,
`apps/worker/src/app/worker-tenancy*.composition.ts`,
`apps/ui/src/features/catalogue.json`,
`packages/architecture-lint/src/*-baseline.json`.

Style: British English, no em dashes (write " - "), comments at most five
lines, no re-exports, no `as unknown as` (except the Prisma-client test double),
no `as never`, no `ctx: unknown`, no non-null `!`, no inline `import()`, no
`try*` names, no `{ ok, error }` returns, ksuid ids, folders at most twelve
files, no file under twenty lines, `it("does x")`, nested describe given/when,
assert on `code` not message prose, every `@scenario` annotation kept bound.

## Cache window

A lane's prompt cache lives five minutes. One tool call or wait longer than
that discards the whole context and re-reads it at full price. So: no single
tool call over four minutes. A vitest run is never backgrounded or cut, so it
is kept short by scope: touched files while working, one directory at a time,
the package suite once at the end. Installs, Go tests and stack waits that
run longer go to `run_in_background` and are checked every four minutes. No
`typecheck:one` mid-work (it queues behind the machine-wide slot and takes the
cache with it); `tsc --noEmit --ignoreConfig <file>` while working, the package
check once at the end. Every tool output is filtered (`tail`, `grep`, vitest
`--reporter=dot`); a raw log or a whole `git show` is re-read on every miss.

## Budget

The cap is 90 minutes or 120 tool calls, whichever comes first. A lane does not
stop before that because a module is large; it lands each step green and
continues. At 45 minutes it writes a one-paragraph status. Whole-file python
rewrites of the same file are a smell: use targeted edits.

The cost of a lane is the sum of its context over every turn, and the context
grows by every tool result and every line the lane writes, so the total is
quadratic in the number of turns. Measured on 10 lanes: 70k tokens on the first
turn, 350k to 410k by turn 280, 15M to 83M cached input tokens per lane, with
cache misses at zero or one. Fewer turns is the lever, not the cache window:
one Bash call runs several commands joined with `&&`; a file is read once and
edited with targeted `Edit` calls; a check runs once at the end, not after every
edit. A lane that reaches the cap writes its state to the report and stops; the
coordinator starts a fresh lane from that report rather than resuming, because
a resumed lane pays its full context again on every further turn.

## Report

Files changed, grouped by package. Exact lines for each shared file. Namespaces
and families served with counts versus origin/main. Wire deltas with reasons.
Scenario bindings ported. Test and typecheck results per package. Baseline rows
to drop as `rule|path` keys. Unfinished items, numbered.
