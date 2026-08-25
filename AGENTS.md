# LangWatch agent contract

This file is the short operating contract for repository work. Accepted ADRs
remain authoritative; do not copy them into local docs. Read the nearest
`AGENTS.md`, the owning feature ADR/spec, and the relevant source before editing.

## Use the repository skills

- Use `feature-inventory` before a broad split or when ownership is unclear.
- Use `feature-migration` for an app-to-package extraction or composition cutover.
- Use `feature-migration-review` before staging a migration batch.

The skills live under `.agents/skills/`. They supplement, rather than replace,
the accepted ADRs and the architecture linter.

## Architecture

- `packages/features/catalogue.json` is the ownership authority. Feature names
  are singular. Do not create a package per endpoint, table, or helper.
- A feature may have `contract`, `server`, and `web` workspace packages. Create
  only the surfaces it needs. API and worker code are process composition or
  feature server adapters, not extra implementations of the domain.
- Strict features use `feature.json` with `layoutVersion: 0` and the exact
  lower-kebab/dotted-role layout in the strict-feature ADR.
- A feature contract exposes portable values, errors, schemas, and one
  canonical abstract service for ordinary callers. A second public service
  requires a genuinely different lifecycle or trust boundary recorded in its
  ADR.
- Repository count does not determine service count. Merge duplicate ways of
  loading the same domain data when doing so leaves one coherent owner.
- A concrete service has a private constructor and `static create`. Construct
  one instance per process. Do not construct services in request handlers.
- A service receives its own private repositories and complete services from
  other feature contracts. Do not pass callback bags, service locators,
  `Pick`/`Omit` views, `Parameters`/`ReturnType` mirrors, or another feature's
  repository.
- Ordinary service and repository methods return a value or throw a concrete
  domain error. Only a method named `try*` may return `null`/`undefined`.
  `require*` is forbidden. Add a method only for a real caller.
- Hono uses `context.app`, tRPC uses `ctx.app`, and workers receive the composed
  app explicitly. Authenticated handlers use `context.actor()` and
  `context.authorize()`. A tenant target may be input when authorisation checks
  that same target.
- Only composition roots import feature server installers. Feature packages
  import other features through contracts. No `getApp`, `tryGetApp`, global
  Prisma, per-request construction, or import-time registration.
- Generated Prisma is private to strict Prisma repository adapters. Services,
  contracts, web packages, and public declarations never expose it.
- Environment access belongs to boot/config composition. Parse and validate it
  once, then inject typed semantic config. Packages do not read env modules.
- Enterprise implementation stays under `packages/enterprise/**`. `saas` is
  Enterprise-licensed; `ops` is core. Core never imports Enterprise
  implementations.

## Eventing

- Projections and process managers are deterministic and synchronous. They do
  no network, database, queue, clock, random, or heavy work.
- Projections derive state/writes. Processes derive state, wakes, and
  deterministically keyed intents. External work belongs in retry-safe intent
  execution.
- Subscribers may perform effects only behind a named idempotency/redelivery
  boundary. Durable follow-up events go through the owning command/pipeline;
  event handlers do not append fabricated events directly.

## Migration and parity

- Move a vertical slice, not a second copy. Rewire callers and delete displaced
  production files. Temporary compatibility files are thin named transport or
  composition adapters and carry no business logic.
- Once a feature package exists, do not leave its behaviour scattered across
  `src/runtime`, `src/features`, `src/server`, `src/server/app-layer`,
  `src/components`, and the package. Record every deliberate residual.
- Keep existing URLs, tRPC names, OpenAPI/RPC shapes, response fields, auth,
  error mapping, ordering, pagination, money/time units, side effects,
  idempotency, and query semantics unless the user explicitly changes them.
- Before replacing a query or mapper, characterise the full old response. For
  traces in particular, do not drop fields or interchange `trace_analytics`,
  `trace_summaries`, or timeseries rollups.
- UI packages own reusable presentation and browser behaviour. App UI owns page
  composition, routing, and transport hooks. Pass controlled data/actions or a
  small named render port; never inject tRPC hooks through a giant context bag.
- The eventual process split is physical: UI composes browser surfaces, API
  composes backend transports, and worker composes background execution.

## TypeScript and source shape

- Import Zod 4 only as `from "zod"`. Schemas are the source of truth at JSON,
  persistence, process, and transport boundaries. Do not replace parsing with
  `typeof` walls or assertions.
- No `any`, double assertions, `@ts-ignore`, or `@ts-expect-error` in new code.
  Fix the boundary. Runtime absence is `void 0`; type-level `undefined` is fine.
- Filenames are lower kebab case. Dots separate architectural roles, for
  example `prisma.project.repository.ts` and `project.service.ts`.
- Use Oxfmt, never Prettier. Prefer braces, blank lines between logical steps,
  and named intermediate values over dense chains, nested ternaries, or large
  boolean walls.
- Keep service modules and methods below the measured architecture ceilings by
  extracting real collaborators. Do not add or raise a baseline for new code.
- Comments explain durable non-obvious constraints. Soft review starts at 30
  comment lines attached to one declaration; 61 is a hard failure. Trim
  narration, history, section labels, and restatements of the code.

## Tests and documentation

- Move behavioural and integration coverage with the implementation. Never
  delete a test suite until equivalent canonical coverage exists.
- Tests must be able to fail and assert observable behaviour. Avoid bare
  `expect`, literal tautologies, empty snapshots, duplicate bodies, and mocking
  the unit under test. Use mutation testing separately for deeper confidence.
- Feature ADRs/specs describe current facts, decisions, and behaviour. Compress
  live-blog history and generic architecture prose; link shared ADRs instead.
- After a coherent slice, run package typechecks/tests, focused app tests,
  Oxfmt, Oxc, architecture lint, and `git diff --check`. Also run:
  `pnpm --filter @langwatch/architecture-lint review:test-quality` for changed
  tests and `review:comment-blocks` when reviewing long comments.
- If the full workspace is red from unrelated work, prove the changed slice and
  report the exact remaining diagnostics. Do not call a blocked check green.

## Shared worktree and commits

- Other changes in the worktree belong to the user or another agent. Do not
  rewrite, reset, or stage them. Stage exact paths or hunks and inspect the
  cached diff before committing.
- Keep commits small and coherent. Do not mix a feature move with unrelated
  lockfile, baseline, generated, or formatting churn.
