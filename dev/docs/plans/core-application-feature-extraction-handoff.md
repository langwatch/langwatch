# Core application extraction hand-off

**Updated:** 2026-08-28

**Branch:** `feat/strict-feature-layout-v0`

**Current committed head:** `13a0805bf3`

This is a short operational hand-off for the next agent. It records current
facts and unfinished work. It does not replace the repository `AGENTS.md`, the
feature catalogue, accepted ADRs, feature ADRs/specs, or the main
[application exit ledger](core-application-feature-extraction-plan.md).

## Read first

1. the nearest `AGENTS.md`;
2. `packages/features/catalogue.json`;
3. ADRs 101, 111 and 112 linked from the main ledger;
4. the owning feature ADR/spec and current source; and
5. `.agents/skills/feature-migration/SKILL.md` and
   `.agents/skills/feature-migration-review/SKILL.md` for a migration batch.

The goal is still to delete `platform/app`, not to make its current roots look
tidier. Reusable domain, server and browser behaviour belongs in singular
feature packages. `apps/api`, `apps/worker` and `apps/ui` own process
composition only.

## Committed checkpoint

The following work is committed and must not be rebuilt in the application:

- `9a98835d5f` proves `HandledError` provenance, keeps trusted backend errors
  lossless, sanitises untrusted failures and adds retryability.
- `5f7f2046dc` makes modern REST a first-class `@langwatch/api` transport:
  schema-first fluent definitions, mandatory Zod input/output, bounded input,
  date/header versions, explicit access and limit decisions, and one error
  boundary.
- `0b65dc696d` makes architecture lint inspect fluent REST `.handle(...)`
  callbacks.
- `13a0805bf3` integrates the Prompt frontend boundary, exact `apps/ui` shell,
  frontend architecture lint and Design System Storybook.

The frontend merge is authoritative. Do not restore the former Prompt paths
from the working-tree backup.

## Working-tree safety

The pre-frontend working tree was saved as:

```text
stash@{0}: codex backend and frontend integration work 2026-08-28
```

That stash has already been applied on top of `13a0805bf3`. It remains only as
a recovery copy. Do not apply it again. Keep it until the Secret, tRPC pilot
and Agent batches are committed, then inspect it before dropping it.

The tree is shared. Stage exact paths, inspect the cached diff, and never use a
blanket commit. In particular, Secret, Agent, `apps/api`, `apps/ui`, the
architecture baseline and `pnpm-lock.yaml` are concurrent but distinct commit
buckets.

The post-merge workspace install did not complete. It rebuilt most of
`node_modules`, then failed with:

```text
ENOENT: chmod sdks/typescript/node_modules/openapi-typescript/bin/cli.js
```

Do not assume workspace links are healthy. Rerun installation or repair that
link before treating package typechecks as meaningful. Preserve the combined
frontend, Agent and `apps/api` manifest changes when regenerating the lockfile.

## Active backend batch: Secret modern REST

Secret REST is implemented in the working tree and has passed focused review.
It is not committed yet.

Current intended surface:

- `GET /api/v1/secret/{date|latest?}/secrets`
- `GET /api/v1/secret/{date|latest?}/secrets/:id`
- `POST /api/v1/secret/{date|latest?}/secrets`
- `PUT /api/v1/secret/{date|latest?}/secrets/:id`
- `DELETE /api/v1/secret/{date|latest?}/secrets/:id`
- version `2026-08-24`, also accepted through `X-API-Version`;
- the deprecated Secret REST and public RPC routes are intentionally removed;
  internal tRPC compatibility remains.

The feature adapter uses the sealed fluent API with `withInput`, `withOutput`,
an explicit permission decision and `.handle`. Input is capped at 16 KiB.
Rate and resource limits have written opt-outs because no transport quota was
invented for this migration.

Authentication order is settled:

1. canonical authentication resolves the credential and target project;
2. multi-project/PAT/admin credentials select that project through
   `X-Project-Id`;
3. the validated REST `projectId` must equal the authenticated project;
4. RBAC, transport limits and the single service call follow.

The JSON body never chooses the authenticated principal. Do not reintroduce
the abandoned `projectIdSource` option.

Modern Secret composition opts into a narrow throwing refusal mode in the
existing auth and API-key permission middleware. Existing legacy/canonical
response modes are unchanged. This lets the `@langwatch/api` boundary produce
one flat handled-error contract for authentication, permission, validation,
domain, output and unknown failures.

Proof already reported green before the failed workspace reinstall:

- modern REST application integration: 9/9;
- Secret contract typecheck and tests: 3/3;
- architecture test-quality review; and
- focused `git diff --check`.

High-rigour review found no runtime or security P0/P1. The remaining migration
gate is documentation/coverage binding: `secret.feature` has seven untagged,
unbound scenarios, so parity currently reports vacuous 0/0. Broad spec
reorganisation was explicitly deferred, but this changed feature cannot be
called migration-complete without either binding those scenarios or recording
the deliberate exception. Real auth middleware coverage is also weaker than
the mocked route test: add a focused test for Bearer plus `X-Project-Id`,
permission refusal, mismatch and infrastructure-error sanitisation.

Commit Secret separately from the tRPC pilot and Agent UI.

## Non-production tRPC pilot

The working tree contains a deliberately non-production pilot:

- Secret owns a thin internal tRPC fragment in `secret-server`;
- `apps/api` owns a small `ApiApplication` that composes the canonical
  `SecretService` and the fragment; and
- a real `createCaller` test characterises list/create/update/delete inputs,
  actor attribution, project authorisation and legacy response shapes.

The production platform tRPC router has not been rewired or deleted. Its global
auth, audit, trace and error middleware parity has not yet been proved. Do not
claim a production cutover and do not import the feature server router or the
whole `AppRouter` into a web package. High-rigour review found no intrinsic
defect in the pilot.

After workspace links are healthy, run the Secret server and `apps/api`
typechecks/tests and commit the pilot as its own checkpoint.

## Active frontend batch: Agent

Agent reusable presentation and browser behaviour have moved into
`@langwatch/agent-web`; platform files are now thin composition or deleted.
Before the frontend merge, focused proof was green:

- Agent web typecheck and 22 tests;
- `apps/ui` typecheck and 7 tests; and
- focused `git diff --check`.

The post-merge frontend architecture changed one important destination. The
new Agent RPC port, tRPC adapter and their test currently sit directly under
`apps/ui/src`. They must move under `apps/ui/src/platform/agent` and exports
must follow. Root-level feature/transport files intentionally fail the new
frontend source-root rule.

Keep the one `platform/app/src/runtime/ui/features/agent-ui-host.adapter.tsx`
host only while it is required for composition. Do not move reusable Agent
behaviour back into the application. Re-run Agent web, `apps/ui`, frontend
architecture lint and residue checks before committing this batch.

## Immediate sequence

1. Repair/re-run the workspace install without losing the merged lockfile.
2. Re-run Secret contract/server/app proof, close or explicitly record the
   scenario-binding gate, and commit the Secret REST cut.
3. Run and commit the non-production `apps/api` Secret tRPC pilot separately.
4. Move the Agent `apps/ui` adapter files under `platform/agent`, rerun its
   focused proof, and commit the Agent vertical plus exact baseline changes.
5. Update the main exit ledger with the real commit hashes and committed
   `platform/app` file counts.
6. Continue with the next dependency-closed vertical from that ledger. Do not
   begin another broad reformat, spec move, or architecture rewrite first.

Before any migration commit, use the feature-migration review gates: behaviour
and transport parity, one service graph, no displaced production residue,
meaningful moved tests, exact composition ownership, architecture lint, Oxfmt,
Oxc and `git diff --check`. Report unrelated red workspace diagnostics
honestly rather than calling the batch green.

Do not touch or fold work into PR 7531. This branch belongs to the application
extraction work and was previously published as draft PR 7536.
