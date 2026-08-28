# API transport extraction hand-off

**Updated:** 2026-08-28

**Branch:** `feat/strict-feature-layout-v0`

**Checkpoint:** `3d1166d8cc`

This is the restart guide for the public REST, internal tRPC and Secret
transport work. It supplements the
[application extraction hand-off](core-application-feature-extraction-handoff.md)
and [exit ledger](core-application-feature-extraction-plan.md). It does not
replace the repository agent contract or accepted ADRs.

## Read first

1. [ADR-128](../adr/128-public-rest-and-internal-trpc.md);
2. [ADR-045](../adr/045-domain-errors-handled-boundary.md);
3. the [`@langwatch/api` ADR index](../../../packages/api/adrs/README.md),
   especially public REST date negotiation;
4. the Secret contract, ADR and spec; and
5. the feature-migration and feature-migration-review skills.

## Settled architecture

Modern public integrations use REST. The first-party browser uses internal
tRPC. Both are thin feature-server adapters over the same canonical service
instance composed by `apps/api`.

Public REST always declares Zod 4 input and output schemas. The framework
merges path fields with GET query fields or a mutation JSON body and validates
the complete input once. It validates the returned output. Authors finish the
schema-first chain with `.handle()` and do not parse raw Hono query/body values.

tRPC validates input but does not add a second runtime output schema. Existing
procedure names and browser response shapes remain stable through thin
compatibility mappers where required.

Both transports own authentication, exact-target authorisation, transport
limits and error delivery. A handler calls exactly one feature service
operation and contains no repository access, service construction or business
logic. Hono uses `context.app`, `context.actor()` and `context.authorize()`;
tRPC uses their `ctx` equivalents.

Feature web packages never import feature server routers or the complete
`AppRouter`. `apps/ui` owns the real tRPC adapter and supplies a small browser
port.

## Adjacent extraction facts

Trace full-read is ready for root migration review. Its package-owned mapper
preserves normalized spans, legacy event identity/timestamps, metrics/errors,
metadata, bounded payload recall and privacy markers. The current audience is
internal-only with an explicit all-visible policy; public viewer-specific
protection, annotations and edit overlays remain deliberate app residuals.
The tRPC split uses dedicated `@langwatch/trpc` (ADR-128 keeps tRPC separate),
and AuthZ now owns scope-lineage policy over its repository. The old app Prisma
guard is deleted. Focused AuthZ checks pass; workspace links and the missing
blank-scope error export still block the full tRPC/app proof. The Secret typed
caller pilot uses one injected root, but `apps/api` still lacks a real logged,
traced server with Secret and Agent mounted.
Evaluation execution remains blocked on Trace composition and mapping; its
schema/ADR repair is complete, but evaluation-server typecheck is blocked by
`TestTraceService` lacking the new full-read methods. Worker physical-entrypoint
inventory and the first Eventing mount are complete but uncommitted.
`WorkerEventingRuntime` owns queue readiness, command/event dispatch,
projections, process-manager wakes, intents, redelivery/idempotency and
shutdown. Topic registers on that runtime and owns seeds/manual dispatch.
Production stores, Group Queue, Trace assignment consumption and the remaining
model/ClickHouse/Langevals/Redis/metrics/config graph are not composed, so the
live `platform/app` Topic path remains. There is no app-layer import in the new
worker graph.

## Committed foundation

- `9a98835d5f` proves handled-error provenance, adds default-false retryability,
  keeps trusted backend errors lossless and sanitises untrusted payloads.
- `5f7f2046dc` adds first-class `createRestService`: fluent method builders,
  mandatory Zod input/output, bounded input, permission and limit decisions,
  OpenAPI, and URL/header date versions.
- `0b65dc696d` makes architecture lint inspect fluent REST `.handle()` bodies.
- `6d86932ce9` accepts ADR-128, accepts the public REST versioning ADR and
  limits the older shared RPC/REST ADR to its compatibility surface.

The public URL is:

```text
/api/v1/{service}/{endpoint}
/api/v1/{service}/{YYYY-MM-DD|latest}/{endpoint}
```

`v1` is static. A date or `latest` may instead arrive through `X-API-Version`
when it is absent from the path. Additive changes are compatible; removals or
meaning changes need a dated contract.

## Uncommitted Secret REST batch

The working tree contains a modern Secret REST adapter and application mount:

- `packages/features/secret/contract` owns public schemas and mappers;
- `packages/features/secret/server/src/api/public` owns the thin installer;
- `platform/app/src/app/api/v1/secret` is the temporary live composition;
- existing auth and API-key middleware have a narrow throwing mode for the
  modern handled-error boundary; and
- modern REST is mounted under both `/api/v1/secret` and `/api/secret`, while
  the deployed `/api/secrets` REST surface remains a thin compatibility adapter;
  the branch-invented public RPC family is removed.

The intended operations are list, get, create, replace and delete at version
`2026-08-24`. Multi-project, PAT and admin credentials select their project
through `X-Project-Id`; any validated input `projectId` must match the project
resolved by authentication. Actor identity never comes from request input.

Earlier focused route proof passed 9/9, and Secret contract/server checks were
green. That proof is not sufficient to commit the cut. The migration review
found these blockers:

1. released clients still use deployed `/api/secrets` REST and need an explicit
   modern REST release before that compatibility mount can be removed;
2. current platform/docs OpenAPI artefacts contain only the six
   `/api/v1/secret` paths and are stale: `/api/secret` and main-equivalent legacy
   REST are absent. Regeneration currently fails before Secret on the unrelated
   missing identity Eventing envelope import;
3. feature maps, exclusions and one architecture baseline entry still name the
   old route;
4. route tests mock the real authentication and permission refusal boundary;
   add Bearer plus `X-Project-Id`, permission denial, target mismatch and
   infrastructure-error sanitisation coverage; and
5. all seven Secret scenarios are unbound, so parity currently reports a
   meaningless 0/0.

Keep deployed REST compatibility while live callers remain. Remove the
branch-only public RPC and migrate its unreleased callers directly to canonical
modern REST.

The Go OpenAPI semantic comparison tool is committed at `3d1166d8cc`. It handles
recursive components and Path Item references, structural validation and OAS
3.1 boolean schemas, and has Go test/race/vet/golangci coverage. Use `main` as
the parity baseline: it contains five Secret REST operations and no public
Secret RPC. Regenerate and compare after the identity Eventing import blocker
is fixed.

## Uncommitted internal tRPC pilot

The tree also contains:

- `packages/features/secret/server/src/api/app-trpc/secret.api.ts`;
- `apps/api/src/api.application.ts`; and
- `apps/api/tests/api.application.secret-trpc.integration.test.ts`.

The feature owns a thin router fragment. `ApiApplication` composes the same
`SecretService`, and the `createCaller` test characterises the legacy
list/create/update/delete inputs, actor attribution, target authorisation and
response shapes. Review found no intrinsic architecture or security defect in
the pilot.

It is not a production cutover. The running platform still mounts its old
Secret and Agent tRPC routers. `@langwatch/trpc` now provides the reusable typed
root, but global auth, audit, trace, logging and handled-error policy has not
been composed in `apps/api`, and Agent has not been mounted there. Do not delete
the live routers or advertise `ApiApplication` as live until the real server and
its parity tests exist.

## Current red checks

These were rerun immediately before this hand-off:

```text
pnpm --filter @langwatch/platform-api typecheck
  cannot resolve the new @langwatch/trpc, @langwatch/eventing,
  @langwatch/topic-{contract,server} and @langwatch/trace-contract workspace
  links; Secret callback inference failures are downstream of that missing root

pnpm --filter @langwatch/agent-web typecheck
  passes; Agent focused checks are green but remain uncommitted

pnpm --filter @langwatch/evaluation-server typecheck
  passes
```

Web architecture contract `410c5dc1eb` focused typecheck/Oxfmt/diff and 20/20
tests are green. Agent is complete but unstaged/uncommitted pending root review;
Agent web has 24 tests/typecheck, `apps/ui` has 10 tests/typecheck, and
frontend-only lint is green. The tRPC app modules and no-any checks are green,
but typecheck awaits final workspace-link/lock reconciliation. Evaluation server
now typechecks against the full-read seam.

## Working-tree boundaries

The tree is shared. Secret REST, the tRPC pilot and Agent UI overlap in package
manifests and `pnpm-lock.yaml`, but they are separate commits. Stage exact paths
or hunks and inspect the cached diff. Never use `git add .`.

Each parity-proven vertical must delete its safely displaced `platform/app`
production paths in a coherent exact-path commit. Compatibility preparation is
not a substitute for that deletion.

The recovery stash is `stash@{0}: codex backend and frontend integration work
2026-08-28`. It has already been applied. Do not apply it again.

Do not touch or fold this work into PR 7531. The application extraction branch
was published as draft PR 7536.

## Next sequence

1. Repair the two `@langwatch/api` type errors without weakening its public
   types or adding DOM globals to feature contracts.
2. Review and commit Agent UI readiness in its separate batch, then resolve Secret docs
   API-reference residuals and real auth coverage while retaining old mounts;
   bind the Secret scenarios.
3. Run feature-migration-review, focused typechecks/tests, Oxfmt, Oxc,
   architecture lint, test-quality review and `git diff --check`; commit the
   Secret REST vertical alone.
4. Resolve the dedicated `@langwatch/trpc` workspace-link/lock and typecheck
   seam, prove `apps/api` middleware parity and the running composition
   boundary, with AuthZ owning permission vocabulary/decision and scope
   lineage; commit the internal tRPC pilot separately.
5. Start the uncommitted Topic clustering/Eventing lane as the first
   dependency-closed process-manager slice: wire one package installer into the
   API producer and worker consumer roots, delete displaced `platform/app`
   Topic registration/production, and keep worker composition under
   `apps/worker/src/{app,platform,features}` with testing support and no
   compatibility path, legacy loader or legacy import.
6. Update the exit ledger with real commit hashes and committed deletion
   counts, then rebase at the planned batch boundary.

At this checkpoint the branch is 461 commits ahead of and three commits behind
`origin/main`.
