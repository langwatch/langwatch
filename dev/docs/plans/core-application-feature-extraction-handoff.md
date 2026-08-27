# Core application extraction hand-off

**Updated:** 2026-08-28

**Branch:** `feat/strict-feature-layout-v0`

**Hand-off checkpoint:** `6d86932ce9`

**Frontend integration baseline:** `13a0805bf3`

This is a short operational hand-off for the next agent. It records current
facts and unfinished work. It does not replace the repository `AGENTS.md`, the
feature catalogue, accepted ADRs, feature ADRs/specs, or the main
[application exit ledger](core-application-feature-extraction-plan.md).

## Read first

1. the nearest `AGENTS.md`;
2. `packages/features/catalogue.json`;
3. ADRs 101, 111, 112 and
   [128](../adr/128-public-rest-and-internal-trpc.md) linked from the main
   ledger;
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
- `6d86932ce9` makes modern public REST and internal tRPC separate thin
  transports over one feature service graph. It records ownership, validation,
  authorisation, limits, error and compatibility rules in ADR-128.

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

The applied Secret server manifest initially made the lockfile stale. The lock
was regenerated offline without discarding the combined frontend, Agent or API
importers, then `pnpm install --frozen-lockfile --offline` completed successfully
for all 155 workspaces. The regenerated `pnpm-lock.yaml` remains uncommitted and
must be split or staged with the exact owning package batches.

## Active backend batch: Secret modern REST

Secret REST is implemented in the working tree. It is not committed and did not
pass the final migration review.

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

Proof reported before the frontend integration:

- modern REST application integration: 9/9;
- Secret contract typecheck and tests: 3/3;
- architecture test-quality review; and
- focused `git diff --check`.

The post-integration migration review found these blockers:

1. live TypeScript, Python, Go and MCP consumers still call removed
   `/api/secrets` and `/api/secrets/latest/secrets.*` URLs;
2. the served and documented OpenAPI artefacts still describe the removed
   routes and omit the new REST surface;
3. `feature-map.json`, the OpenAPI route exclusions and one architecture
   baseline entry still describe the old route; and
4. real authentication and permission refusal behaviour is not covered by the
   mocked route suite.

The feature spec also has seven unbound scenarios, so parity currently reports
vacuous 0/0. Do not delete compatibility routes until callers are migrated, or
retain a thin compatibility transport and record it explicitly. Add focused
Bearer plus `X-Project-Id`, permission-refusal, project-mismatch and
infrastructure-error sanitisation coverage before approval.

Commit Secret separately from the tRPC pilot and Agent UI.

## Active backend batch: internal tRPC pilot

The working tree contains a non-production Secret tRPC pilot:

- Secret owns a thin internal tRPC fragment in `secret-server`;
- `apps/api` owns a small `ApiApplication` that composes the canonical
  `SecretService` and the fragment; and
- a real `createCaller` test characterises list/create/update/delete inputs,
  actor attribution, project authorisation and legacy response shapes.

The production platform tRPC router has not been rewired or deleted. The live
root still mounts `platform/app/src/server/api/routers/secrets.ts`, while the new
`ApiApplication` is not composed by a running process. Global auth, audit,
trace and error middleware parity has not been proved.

No agent currently owns this batch. Review it against ADR-128 before changing
or committing it. In particular, do not import a feature server router or the
whole `AppRouter` into a web package and do not describe the current pilot as a
production cutover. Keep this commit separate from Secret REST and Agent UI.

## Active frontend batch: Agent

Agent reusable presentation and browser behaviour are partially moved into
`@langwatch/agent-web`. The batch is not currently type-correct and must not be
staged. Before the frontend merge, focused proof was green:

- Agent web typecheck and 22 tests;
- `apps/ui` typecheck and 7 tests; and
- focused `git diff --check`.

The Agent migration review found four parity and architecture blockers:

1. push-to-copies stopped invalidating/reloading the visible Agent list;
2. extracted Agent cards lost the app-owned
   `LangyContextTarget(agentContextChip(...))` wrapper;
3. `AgentManagementPage` received a 13-field callback bag and a forbidden
   `Pick` instead of cohesive controlled ports; and
4. the Agent RPC port and adapter were initially placed at the forbidden
   `apps/ui/src` root.

A partial repair moved the port and adapter to
`apps/ui/src/platform/agent`, grouped the management-page inputs into named
data/navigation/feedback/lifecycle/card ports, removed the `Pick`, and requests
an `agentsChanged` lifecycle action after push, copy and sync. This repair is
incomplete:

- the platform host still passes the old 13 props and does not implement the
  new ports;
- the app-owned Langy card wrapper is not restored;
- the management-page tests still use the old props;
- the adapter test still imports the deleted root paths; and
- post-push refresh, Langy composition, dialog parity and the remaining adapter
  mappings lack coverage.

No other agent currently owns `apps/ui/src/platform/agent`, its root exports or
its adapter test. Treat them as part of this Agent batch, not the Secret tRPC
pilot.

Keep the one `platform/app/src/runtime/ui/features/agent-ui-host.adapter.tsx`
host only while it is required for composition. Do not move reusable Agent
behaviour back into the application. Re-run Agent web, `apps/ui`, frontend
architecture lint and residue checks before committing this batch.

## UI architecture records

The accepted frontend architecture is implemented and committed at
`13a0805bf3`. Four UI-local ADRs are recorded under `apps/ui/adrs`:

1. frontend features are independent user-facing capabilities and adopt the
   governed `app`, `platform`, `features`, `testing` graph;
2. the migration preserves the exact live `platform/app` shell through the
   temporary `LegacyUiShellAdapter`;
3. Prompt Studio is the first owner-screen/narrow-surface pilot and is not yet
   a complete page move; and
4. `apps/ui` consumes the shared `packages/design-system`, whose Storybook uses
   Foundations, Primitives, Components and app-independent Patterns.

These ADRs link architecture-lint ADR-004 and the Design System ADR instead of
copying their detailed enforcement and package rules.

## Current verification

After the successful frozen offline install, the checks rerun at this hand-off
still report:

- Design System typecheck passes;
- Prompt web typecheck passes;
- all 14 frontend-boundary lint fixtures pass;
- Secret contract and Secret server typechecks pass;
- Agent web typecheck fails because `agent-management-page.test.tsx` still uses
  the old prop shape;
- `apps/api` typecheck fails in `packages/api/src/capabilities.ts` because one
  callback does not return on every path and `BodyInit` is absent from that
  app's TypeScript library surface.

`git diff --check` passes. These red checks are current integration blockers,
not unrelated diagnostics and not green proof.

## Immediate sequence

1. Decide Secret URL compatibility, migrate or protect every live SDK/MCP
   caller, regenerate OpenAPI/docs, remove stale maps/baselines, add real auth
   coverage, then rerun and commit the Secret REST cut separately.
2. Complete the Agent controlled-port host, restore Langy card composition and
   parity coverage, then rerun and commit the Agent UI vertical separately.
3. Reconcile the non-production `apps/api` tRPC pilot with ADR-128, prove the
   real app middleware boundary and commit it separately. Do not call this a
   production cutover until the running root is rewired.
4. Update the main exit ledger with the real commit hashes and committed
   `platform/app` file counts.
5. Continue with the next dependency-closed vertical from that ledger. Do not
   begin another broad reformat, spec move, or architecture rewrite first.

Before any migration commit, use the feature-migration review gates: behaviour
and transport parity, one service graph, no displaced production residue,
meaningful moved tests, exact composition ownership, architecture lint, Oxfmt,
Oxc and `git diff --check`. Report unrelated red workspace diagnostics
honestly rather than calling the batch green.

Do not touch or fold work into PR 7531. This branch belongs to the application
extraction work and was previously published as draft PR 7536.

At this hand-off the branch is 461 commits ahead of and three commits behind
`origin/main`. Rebase only at the planned batch boundary, after the current
working-tree buckets are safely committed.
