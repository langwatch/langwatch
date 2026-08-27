# API transport extraction hand-off

**Updated:** 2026-08-28

**Branch:** `feat/strict-feature-layout-v0`

**Checkpoint:** `6d86932ce9`

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
- the former Secret public REST/RPC implementation is deleted in the tree.

The intended operations are list, get, create, replace and delete at version
`2026-08-24`. Multi-project, PAT and admin credentials select their project
through `X-Project-Id`; any validated input `projectId` must match the project
resolved by authentication. Actor identity never comes from request input.

Earlier focused route proof passed 9/9, and Secret contract/server checks were
green. That proof is not sufficient to commit the cut. The migration review
found these blockers:

1. live TypeScript, Python, Go and MCP callers still use the removed legacy
   URLs;
2. served and generated OpenAPI still describes the old routes and omits the
   modern ones;
3. feature maps, exclusions and one architecture baseline entry still name the
   old route;
4. route tests mock the real authentication and permission refusal boundary;
   add Bearer plus `X-Project-Id`, permission denial, target mismatch and
   infrastructure-error sanitisation coverage; and
5. all seven Secret scenarios are unbound, so parity currently reports a
   meaningless 0/0.

Do not delete compatibility endpoints while live callers remain. Either move
every caller in the same reviewed batch or retain a thin, explicitly named
compatibility adapter with no business logic.

## Uncommitted internal tRPC pilot

The tree also contains:

- `packages/features/secret/server/src/api/internal/secret.internal-trpc.api.ts`;
- `apps/api/src/api.application.ts`; and
- `apps/api/tests/api.application.secret-trpc.integration.test.ts`.

The feature owns a thin router fragment. `ApiApplication` composes the same
`SecretService`, and the `createCaller` test characterises the legacy
list/create/update/delete inputs, actor attribution, target authorisation and
response shapes. Review found no intrinsic architecture or security defect in
the pilot.

It is not a production cutover. The running platform still mounts its old
Secret tRPC router, and global auth, audit, trace and handled-error middleware
parity has not been demonstrated in `apps/api`. Do not delete the live router
or advertise `ApiApplication` as live until that composition is real.

## Current red checks

These were rerun immediately before this hand-off:

```text
pnpm --filter @langwatch/platform-api typecheck
  packages/api/src/capabilities.ts:119  not all code paths return
  packages/api/src/capabilities.ts:137  BodyInit is absent from the app TS libs

pnpm --filter @langwatch/agent-web typecheck
  agent-management-page.test.tsx still uses the old prop shape

pnpm --filter @langwatch/ui typecheck
  the Agent adapter test imports two deleted root-level modules
```

The two UI failures belong to the separate Agent batch. Do not fix or stage
them with API transport work. The `apps/api` failure must be cleared before the
tRPC pilot can be called type-correct.

## Working-tree boundaries

The tree is shared. Secret REST, the tRPC pilot and Agent UI overlap in package
manifests and `pnpm-lock.yaml`, but they are separate commits. Stage exact paths
or hunks and inspect the cached diff. Never use `git add .`.

The recovery stash is `stash@{0}: codex backend and frontend integration work
2026-08-28`. It has already been applied. Do not apply it again.

Do not touch or fold this work into PR 7531. The application extraction branch
was published as draft PR 7536.

## Next sequence

1. Repair the two `@langwatch/api` type errors without weakening its public
   types or adding DOM globals to feature contracts.
2. Resolve Secret compatibility callers, OpenAPI/maps and real auth coverage;
   bind the seven scenarios.
3. Run feature-migration-review, focused typechecks/tests, Oxfmt, Oxc,
   architecture lint, test-quality review and `git diff --check`; commit the
   Secret REST vertical alone.
4. Prove `apps/api` middleware parity and the running composition boundary;
   commit the internal tRPC pilot separately.
5. Update the exit ledger with real commit hashes and committed deletion
   counts, then rebase at the planned batch boundary.

At this checkpoint the branch is 461 commits ahead of and three commits behind
`origin/main`.
