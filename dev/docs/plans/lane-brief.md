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

## Where a thing lives

The contract package is the module's vocabulary and the server package is its
behaviour. That line decides three kinds of file, and getting it wrong is the
most common review finding:

- **Schemas.** Every Zod schema a request or an answer is shaped by lives in
  `modules/<m>/contract/src`, not beside the `defineRestRouter` or
  `defineTrpcContract` file that uses it. A transport file declares routes and
  imports its schemas. The reason is not tidiness: the browser, the SDK and
  another module all need the shape, and none of them may import a server
  package. A schema in `server/src/transport` is a shape only the server can
  see, so every other side of the wire ends up with a hand-written copy that
  drifts.
- **Errors.** Every `HandledError` subclass lives in
  `modules/<m>/contract/src/<m>.errors.ts` with its stable `code`, beside its
  entry in `packages/handled-error/src/presentation.ts`. A service throws it;
  a client reads its code. Both sides need the class, so it cannot live in the
  server package either.
- **Types.** A type both sides name goes in the contract. A type only the
  server's own internals name stays colocated with the code that uses it.

What does stay in the server package: the routers and routers only, the app,
the services, the repositories, the ports and adapters.

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

The developer's stack runs from this tree while a lane works, so every step
keeps it bootable. A new dependency is declared in `package.json` and linked
with `env -u CI pnpm install --filter "<package>..."` before the first import
of it is written. An export a process still imports is deleted only in the
same step that repoints or removes the importer (`git grep -n "<name>" --
apps enterprise modules packages` before deleting). A constructor's shape
changes only with every caller in the same step. After each landed step the
lane reads `haven logs backend --since 2m --agent` and treats a `SyntaxError`,
an `ERR_MODULE_NOT_FOUND` or a `fatal boot failure` naming its files as its
own defect to fix before continuing.

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

Identifier work goes through tslsp-cli, not grep or sed: from the package
directory (the one holding the tsconfig.json), `npx --no-install
@0xdeafcafe/tslsp-cli references --symbol Name --summary` for consumers,
`rename --symbol Old --new-name New --dry-run` then without `--dry-run` for a
rename, `rename-file OLD NEW` for a move (it rewrites every import),
`diagnostics --file F` after an edit. A package's program sees its own files
and its workspace dependencies, so consumers in apps/ are found by running the
same command from apps/api or apps/worker. Every pnpm, vitest, git and grep
command is prefixed with `rtk ` (the token filter on this machine).

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

## Reading budget (binding)

A lane at 150k tokens after five minutes has read, not written. The rules:
never Read a file whole; `tslsp-cli outline FILE` first, then Read the one
line range you need, at most 120 lines, once. A framework signature
(`withModule`, `defineRestRouter`, `defineRestMiddleware`, `runtime.mount`) is
`tslsp-cli hover --symbol X`, never a Read of packages/api or
packages/runtime-composition source. An exemplar is one outline plus one
handler, not the file. No grep for exemplars: the brief names them. Write the
new file first from the exemplar's shape, then `diagnostics --file` tells you
what the types want; that is cheaper than reading the types. Cap: 60 tool
calls, 100k tokens; a lane past either stops and reports what is landed.

## Tests use the harness (binding)

`@langwatch/test-harness` is the test toolkit and every lane uses it rather
than hand-rolling stubs: `createApiFixture<XApi>({ ...only the methods the
test calls })` for an app or peer double (an uncalled method throws by name,
so a test never passes on a silent no-op), `cleanupTestRows` for datastore
rows, `startTestClickHouseEndpoints` for isolated ClickHouse. A transport test
mounts the real router on a real `createApiRestRuntime` (exemplar:
apps/api/src/features/analytics/__tests__/query-rest.mount.integration.test.ts)
over a module booted with its memory repositories through the fixture in
`modules/<m>/server/src/app/__tests__/<m>.fixture.ts` (no `testing.ts` in a server package). A hand-written `{ getById: vi.fn() }` object literal or a
class stub in a test is a defect to fix, not a style choice.

## The shape comes from the reference, not from the brief

Load the `architecture-guide` skill and then the `module` skill and follow its
`references/convert.md`; copy `modules/annotation`, never the module next to
you. In particular: a peer module's `*Api` token goes in the app's `static
dependencies` and arrives at boot; technical needs (a clock, a base host, an
error reporter, encryption) are members of `<F>Infrastructure` supplied by the
process in `withInfrastructure`; every capability is a method on the one app;
handlers read `{ input, app, actor, scope, signal }`; middleware is credential,
audit, rate limit and body format only. No facts, effects, extended apps,
delegates, Proxies, `refusing*` twins, `ports/` or `adapters/`.
