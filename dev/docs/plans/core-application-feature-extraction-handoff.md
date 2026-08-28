# Core application extraction hand-off

**Updated:** 2026-08-28

**Branch:** `feat/strict-feature-layout-v0`

**Hand-off checkpoint:** `3d1166d8cc`

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

At this checkpoint Agent web/UI and Trace full-read are review-ready but
uncommitted. The generic tRPC/AuthZ extraction, Secret REST, process
observability, and Worker Eventing/Topic mount are implemented but still need
their named composition and workspace-link gates. `apps/api` is not yet a live
server: it has a typed Secret caller pilot, but Agent, request policy, logging
and tracing are not mounted. The new worker has the Eventing lifecycle but not
the production durable stores/Group Queue/Trace-assignment consumer and
external capability graph. The main ledger records exact proof and decisions.

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
- `410c5dc1eb` enforces the two-scope feature-web layout and exact
  screen/surface boundaries with 20 passing architecture fixtures.
- `3d1166d8cc` adds the semantic OpenAPI 3 JSON comparison tool and CI coverage.
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
- the same five operations under `/api/secret/{date|latest?}`;
- version `2026-08-24`, also accepted through `X-API-Version`;
- an omitted path/header version resolves to latest;
- deployed `/api/secrets` and `/api/secrets/:id` REST remain thin compatibility
  mounts; the branch-invented public RPC family is removed; and
- internal app tRPC compatibility remains until the API cutover.

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

1. released clients still call deployed `/api/secrets` REST; branch-only RPC
   callers are being moved to canonical `/api/v1/secret` REST;
2. current platform/docs OpenAPI artefacts contain only six `/api/v1/secret`
   paths and are stale: they omit `/api/secret` and the main-equivalent legacy
   REST operations. Regeneration is blocked before Secret by the unrelated
   missing identity Eventing envelope import;
3. `feature-map.json`, the OpenAPI route exclusions and one architecture
   baseline entry still describe the old route; and
4. real authentication and permission refusal behaviour is not covered by the
   mocked route suite.

The feature spec still has unbound scenarios, so parity is not completion proof.
Keep compatibility routes until callers migrate. Add focused Bearer plus
`X-Project-Id`, permission-refusal, project-mismatch and infrastructure-error
sanitisation coverage before approval.

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

The accepted API keeps tRPC separate in dedicated `@langwatch/trpc`. Generic
root creation and runtime/type tests now exist. AuthZ owns scope-lineage policy
over its repository; the old app Prisma guard and test are deleted. Focused
AuthZ proof passes, while workspace links and the missing blank-scope error
export block full tRPC/app proof. `apps/api` still needs the real server,
Secret/Agent mounts, request policy and process logging/tracing. The live root
is unchanged, so this remains compatibility preparation, not a production
cutover. Keep this commit separate from Secret REST and Agent UI.

## Active Trace full-read lane

Trace full-read is ready for root migration review. Its package-owned mapper
preserves normalized stored fields, bounded and deduplicated payload recall,
legacy event identity/timestamps, metrics/errors, metadata and privacy markers.
The new service is internal-only with an explicit all-visible policy. Public
viewer-specific protection, annotations and edit overlays remain deliberate app
residuals, so this batch does not delete those live reads.

## Active frontend batch: Agent

Agent reusable presentation and browser behaviour are partially moved into
`@langwatch/agent-web`. The architectural blockers are closed and focused
checks are green, but the batch remains uncommitted and must not be described
as committed. Focused proof covers:

- Agent web typecheck and 24 tests;
- `apps/ui` typecheck and 10 tests;
- the real platform Agent host's 6 tests; and
- focused `git diff --check`.

The Agent migration review found four parity and architecture blockers; all
four are now closed in the working tree:

1. push-to-copies stopped invalidating/reloading the visible Agent list;
2. extracted Agent cards lost the app-owned
   `LangyContextTarget(agentContextChip(...))` wrapper;
3. `AgentManagementPage` received a 13-field callback bag and a forbidden
   `Pick` instead of cohesive controlled ports; and
4. the Agent RPC port and adapter were initially placed at the forbidden
   `apps/ui/src` root.

A repair moved the port and adapter to
`apps/ui/src/features/agent`, grouped the management-page inputs into named
data/navigation/feedback/lifecycle/card ports, removed the `Pick`, and requests
an `agentsChanged` lifecycle action after push, copy and sync. The platform
host now consumes the named ports, Langy card composition and post-push refresh
proof are green, and the focused Agent web, `apps/ui`, adapter and
frontend-boundary checks pass. No commit has been made; keep this Agent batch
separate from the Secret tRPC pilot.

Keep the one `platform/app/src/runtime/ui/features/agent-ui-host.adapter.tsx`
host only while it is required for composition. Do not move reusable Agent
behaviour back into the application. Re-run Agent web, `apps/ui`, frontend
architecture lint and residue checks before committing this batch.

The web architecture contract is committed at `410c5dc1eb` with its exact four
ADR/spec/linter/test files; focused typecheck, Oxfmt and diff are green with
20/20 tests. Recursive closure permits screen-to-own-narrow-surface and
surface-to-package-global-portable-model edges. Agent is the complete pilot
implementation but remains unstaged/uncommitted pending root migration review:
Agent web has 24 tests/typecheck, `apps/ui` has 10 tests/typecheck, and
frontend-only lint is green; intended platform Agent production deletions are
in the slice. The refined two-scope proposal has shared roots
`{model,behavior,ui,screens,surfaces}`, while each feature may use
`features/<feature>/{model,behavior,ui}`. This layout is active but unproven;
Agent web is the pilot, its current behavior remains uncommitted, and no final
folder names are asserted until the pilot proves them.

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
- Agent web typecheck and focused Agent tests pass after the controlled-port
  repair; this remains uncommitted proof, not a committed checkpoint;
- `apps/api` typecheck fails in `packages/api/src/capabilities.ts` because one
  callback does not return on every path and `BodyInit` is absent from that
  app's TypeScript library surface.

`git diff --check` passes. These red checks are current integration blockers,
not unrelated diagnostics and not green proof.

Every parity-proven vertical must delete its safely displaced `platform/app`
production paths in a coherent exact-path commit. Compatibility preparation is
not a substitute for deletion; do not claim a cutover until the corresponding
paths and residual imports are removed and verified.

## Immediate sequence

1. Review and commit the Agent UI vertical separately, preserving the green
   controlled-port, Langy composition and refresh proof.
2. Resolve Secret real-auth coverage and run migration review; retain old
   mounts. OpenAPI artefacts are corrected, while full docs page generation
   waits on the unrelated Roles ordering blocker. Commit the REST vertical
   separately.
3. Reconcile the non-production tRPC split with ADR-128 in dedicated
   `@langwatch/trpc`: the Secret parallel root is fixed, with `apps/api` owning
   one typed root injected into Secret. Prove final workspace-link/lock and
   typecheck reconciliation plus real middleware parity; keep permission
   vocabulary/decision and scope lineage in AuthZ while `apps/api` retains
   session/request/audit/log/trace policy. Commit separately; do not call this
   a production cutover until the running root is rewired.
4. Finish the uncommitted Topic/Eventing vertical. The package installer and
   `WorkerEventingRuntime` mount now exist: EventSourcing owns queue readiness,
   projections, process-manager wakes, intents, redelivery/idempotency and
   shutdown. Compose the durable stores, Group Queue, Trace assignment
   consumer, model/ClickHouse/Langevals/Redis/metrics/config and process
   observability before deleting displaced `platform/app` Topic paths. There is
   no compatibility import in the new worker graph.
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

At this hand-off the branch is 461 commits ahead of and three commits behind
`origin/main`. Rebase only at the planned batch boundary, after the current
working-tree buckets are safely committed.
