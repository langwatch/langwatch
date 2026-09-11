# Lane brief: module conversion on the annotated runtime

The mechanism is now canonical elsewhere. How a lane reads, works, checks,
budgets and stops is `.claude/coordinator/LANE.md`; the rules that bind it -
no whole-tree checks, no git writes, never a `.env`, tests through the owning
package with `VITEST_MAX_WORKERS`, ownership and shared files, identifiers
through `tslsp-cli`, cost and reading discipline, prose style - are
`.claude/skills/core/repository-rules.md` and `testing-rules.md`; the report
is `.claude/skills/core/handoff-rules.md` and the template beside `LANE.md`.
Nothing below restates them.

This file keeps what is specific to the strict feature layout drive: the
exemplar for every shape a baseline row names, where a thing lives, the wire
pin, the code rules this drive fails review on, the module-specific test
exemplars, and where the shape comes from. ADR-133 and ADR-134 are the
background, not the recipe.

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

A `git show` exemplar is read as one outline plus one handler, never whole
(`LANE.md` section 1); a framework signature (`withModule`,
`defineRestRouter`, `defineRestMiddleware`, `runtime.mount`) comes from
`tslsp-cli hover --symbol X`, never from a read of `packages/api` or
`packages/runtime-composition` source.

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

## Code rules that fail review in this drive

The operating rules are canonical in `.claude/skills/core/`. Code-shape rules
are in `.claude/skills/module/SKILL.md`. On top of both, a conversion in this
drive is measured against: no re-exports, no `as unknown as` (except the
Prisma-client test double), no `try*` names, no `{ ok, error }` returns, ksuid
ids.

One check `repository-rules.md` section 5 leaves to the lane: before an export
is deleted, `git grep -n "<name>" -- apps enterprise modules packages` beside
`tslsp-cli references`, because the two things the language server cannot see
(`vi.mock("<path>")` strings and tests that read source as text) are what the
text search catches.

## The handoff, for this drive

`.claude/coordinator/handoff-template.md` is the form. A conversion lane's
handoff also states, under section 5, the namespaces and families served with
counts versus origin/main and the scenario bindings ported; under section 10,
the baseline rows to drop as `rule|path` keys; and under section 11, every wire
delta with its reason.

## Tests: the module-specific exemplars

`@langwatch/test-harness` is the toolkit and `testing-rules.md` section 3 says
how it is used. What is specific to this drive: a transport test mounts the
real router on a real `createApiRestRuntime` (exemplar:
`apps/api/src/features/analytics/__tests__/query-rest.mount.integration.test.ts`)
over a module booted with its memory repositories through the fixture in
`modules/<m>/server/src/app/__tests__/<m>.fixture.ts` (no `testing.ts` in a
server package). Pass `logger` from `createTestLogger()` wherever the code
under test takes one, and drop `LANGWATCH_TEST_LOGS=1` into that package's own
`vitest.config.ts` `test.env` only if a suite asserts on `createLogger`'s own
behaviour rather than on a caller's.

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
