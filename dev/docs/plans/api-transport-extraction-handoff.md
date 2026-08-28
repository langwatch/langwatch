# API transport extraction hand-off

**Updated:** 2026-08-28

**Branch:** `feat/strict-feature-layout-v0`

**Checkpoint:** `1956fe0c06`

This is the API-specific restart guide. Read ADR-128, the Secret and Agent
feature ADRs/specs, the repository `AGENTS.md`, and the authoritative
[platform exit ledger](core-application-feature-extraction-plan.md) before
editing. Use `feature-migration` and `feature-migration-review` for each cut.

## Settled transport architecture

Public integrations use schema-first REST from `@langwatch/api`. The first-party
application uses internal tRPC from `@langwatch/trpc`. Feature-server adapters
for both transports delegate to one canonical feature service instance composed
once by `apps/api`.

Hono handlers use `context.app`, `context.actor()` and
`context.authorize()`. tRPC handlers use `ctx.app` and the matching request
policy. Packages do not construct services per request, read environment
modules, access global Prisma or import the global App.

## What is committed

- `faf6db77e1` keeps the required Secret aliases live in platform composition.
- `02457aaebd` moves Agent and Secret tRPC behaviour to package adapters while
  the universal root remains the compatibility composition.
- `f1baea7011` adds the standalone Node/Hono listener, typed API config,
  request policy and bounded HTTP drain before observability shutdown.
- `f9dbf94c8a` mounts package-owned Secret REST into that listener.
- `589a251194` hardens the Go semantic OpenAPI comparator.

The callable API graph serves Agent/Secret tRPC and Secret REST. Secret REST
supports collection GET/POST and item GET/PUT/DELETE under all four bases:

```text
/api/v1/secret
/api/v1/secrets
/api/secret
/api/secrets
```

Path v1, omitted-to-latest and `X-API-Version: v1` are covered. Conflicting and
unsupported versions fail through the canonical REST error boundary. The
package REST pipeline supplies request logging and tracing.

## Exact non-deletion boundary

Do not delete the live platform routes yet.

The direct API graph exposes a process-owned `ApiRestSecurityPort`, but no
production adapter yet implements project API-key resolution, PAT/admin
selection, API-key permission ceilings and mark-used behaviour plus AuthZ. The
platform `/api/secrets` adapter also derives project ownership from credentials
and returns legacy payload/error/deprecation semantics, while the direct alias
uses the modern validated `projectId` contract and canonical errors.

The platform Agent/Secret tRPC wrappers remain required by the universal root,
mixed batches, app client types and direct root callers. Delete each wrapper
only when the executable API root owns the complete caller graph and parity
tests prove its request policy.

## OpenAPI parity record

Against `main`, the checked-in branch document has:

- 129 changed operations;
- 30 added operations;
- five removed operations;
- 73 changed request bodies, 49 operation IDs, 26 responses, eight parameter
  sets, five descriptions and one tag set.

The five removed operations are the deployed legacy Secret surface:

```text
GET    /api/secrets
POST   /api/secrets
GET    /api/secrets/{id}
PUT    /api/secrets/{id}
DELETE /api/secrets/{id}
```

Runtime source retains those operations, so the checked-in artefacts are stale.
OpenAPI generation still belongs to
`platform/app/src/tasks/generateOpenAPISpec.ts` and fails before route
composition because application environment configuration is not initialised.
Move generator and document serving ownership with the full API route graph;
do not edit generated JSON as a substitute.

## Next API sequence

1. Add an executable API boot that parses config once and constructs concrete
   session/project-key/PAT/admin, AuthZ, API-key ceiling/mark-used, audit,
   rate-limit and persistence adapters.
2. Characterise the legacy `/api/secrets` payload, errors, deprecation headers
   and credential-derived project semantics, then make an explicit
   compatibility decision.
3. Migrate the remaining REST and tRPC inventory by owning feature, preserving
   paths, operation IDs, auth, errors, ordering and response shapes.
4. Move OpenAPI generation/serving into `apps/api`, regenerate from the
   canonical route graph and compare semantically with `main`.
5. Activate the API process directly, then delete only the displaced platform
   transport/composition adapters with focused parity proof.

## Verification at checkpoint

- API typecheck and 27 tests pass across nine files.
- The listener test covers 20 Secret CRUD alias operations plus version,
  conflict, project-target, actor and permission behaviour.
- Secret server tests, focused Oxfmt/Oxc, test-quality review and
  `git diff --check` pass.
- The platform OpenAPI generator and broad workspace checks remain recorded
  red for the exact unrelated/shared diagnostics in the main ledger.

The branch contains unrelated dirty generated artefacts, Evaluation, Identity,
Secret, SDK, baseline and formatting work. Stage exact paths or lockfile hunks;
never fold those changes into an API migration commit.
