# Langy zero-friction onboarding — implementation plan

> **Epic:** #4528 · **Sub-issues:** #4273 → #4274 → #4275
> **Branch:** `issue4273/langy-api-key` · **Base:** `langy/per-session-manager` (PR #4272)
> **Worktree:** `~/langwatch_codebase/langy-keys`

## Goal

Make Langy *just work* — no manual key wrangling, no "configure a provider first" dead end.
Two credentials power Langy end-to-end; this epic makes both seamless:

1. **LangWatch API key** → Langy reads project data (MCP + outbound calls into LangWatch).
2. **AI Gateway `VirtualKey`** → Langy calls an LLM on the user's behalf, model chosen from a **dropdown**.

Target: new projects auto-mint the key; existing projects are backfilled; the key flows to the
Langy worker for traces + MCP automatically; model selection routes through the gateway VirtualKey.

## Target flow

```
  new project ─┐                          ┌─ backfill reconciler (existing projects)
               ▼                          ▼
        provisionLangyApiKey()  ◄── idempotent ──►  mint "Langy" key for any project missing one
               │                                            (#4273)
               ▼
     dedicated "Langy" ApiKey (service key, PROJECT-scoped, least-privilege)
               │
               ▼
   open Langy ─► "Set up Langy" modal (#4274)
                 (1) key:   (•) dedicated Langy key   ( ) project's own key
                 (2) model: [ dropdown / 1-click "use <provider>" ]
                            none configured? → guided add → return to modal
               │
               ▼
   Langy worker (per-session, from #4272)
     • MCP server   ← LangWatch API key            (traces / MCP)
     • opencode LLM ← VirtualKey → AI Gateway      (#4275)
```

## What already exists — reuse, do not rebuild

**From the #4272 base (`langy/per-session-manager`):**
- Per-session OpenCode workers + `LangyCredentialService.getOrProvision()`
  (`src/server/services/langy/LangyCredentialService.ts`) — already reads `project.apiKey`,
  **already auto-provisions a per-project Langy VirtualKey** (`langy_vk_secret` in `ProjectSecret`),
  and passes `langwatchApiKey` + `llmVirtualKey` + `gatewayBaseUrl` to the worker env.
  → A chunk of PR3's plumbing is already here; #4275 is mostly *flipping the gate* (see below).
- `ApiKeyService.create(...)` — signature verified to match the helper:
  `{ name, description, userId, createdByUserId, organizationId, permissionMode, permissions, bindings }`.
- `permission-categories.computePermissionsFromSelections()` and `Project.kind` (`@default("application")`).

**WIP to port from `~/langwatch_codebase/langy-full-rebase` (branch `issue4273/langy-default-api-key`):**
These were written on the diverged `langy/full` base but their dependencies all exist on #4272, so they
port cleanly (adapt imports/line refs only):
- `src/server/services/langy/langyApiKey.ts` — `provisionLangyApiKey()` + `backfillLangyApiKeys()` (idempotent, least-privilege, excludes hidden `kind != "application"` projects).
- `scripts/backfill-langy-api-keys.ts` — runnable backfill (`--dry-run` supported).
- `specs/assistant/langy-api-key-provisioning.feature` — BDD spec (6 scenarios).
- `src/server/api/routers/__tests__/project.create.langyKey.integration.test.ts` — real-DB integration test.

## Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Where the key lives | Reuse `ApiKey` + `ApiKeyService` — **no new schema** | Already supports named, hashed, revocable, scope-bound **service keys** (`userId: null`). |
| Key identity | Service key (`userId: null`), `name: "Langy"` | Not tied to a human; attributable via `createdByUserId`. |
| Key scope | PROJECT-scoped, least-privilege | A leak exposes one project + only Langy's actions. |
| When minted | Best-effort after project creation; **backfill reconciles** | Keeps project creation decoupled from `ApiKeyService`; eventual consistency. |
| Gateway key | A `VirtualKey` (already auto-provisioned in #4272) | Implies "whose budget / which provider" → made real in #4275. |
| No new REST endpoints | Extend services + existing Langy routes only | Project constraint. |

---

## PR 1 — dedicated Langy API key (#4273)  ·  *foundation*  ·  **CODE COMPLETE, typecheck green**

Spec: `specs/assistant/langy-api-key-provisioning.feature`.

- [x] **Spec-first** — `.feature` in `specs/assistant/` (6 scenarios).
- [x] **Integration tests** (real DB, no mocks) — `src/server/api/routers/__tests__/project.create.langyKey.integration.test.ts`:
  - new project → a `Langy` service key exists, distinct from `Project.apiKey`
  - key bound only to its project · no org-admin (least-privilege) · `permissionMode: "restricted"`
  - backfill mints for a project lacking one · backfill twice → exactly one key (idempotent)
- [x] **`langyApiKey.ts`** → `src/server/services/langy/langyApiKey.ts` (`provisionLangyApiKey` + `backfillLangyApiKeys`).
- [x] **Hook the live creation path** (best-effort, awaited + caught, never blocks creation):
  - tRPC `project.create` → `src/server/api/routers/project.ts` (after `prisma.project.create`).
  - **Finding (deviation from original plan):** the app-layer `ProjectService.create`
    (`project.service.ts:137`) is **not invoked anywhere** for real project creation —
    onboarding goes `onboarding.router.ts:62 → projectRouter.createCaller(ctx).create()` (the tRPC path).
    Hooking the app-layer service would be **dead code** *and* break the repository abstraction
    (the service holds `this.repo`, not a `PrismaClient`). So it's intentionally **not** hooked;
    the **backfill reconciler** is the safety net for any path that ever bypasses provisioning.
- [x] **Backfill script** → `scripts/backfill-langy-api-keys.ts` (idempotent; `--dry-run`).
- [x] `pnpm typecheck` → exit 0 (whole project).
- [ ] **Run integration tests end-to-end** — NOT yet run. The worktree `.env` `DATABASE_URL` points at the
      **shared dev RDS**; do NOT run create/delete tests against it. Bring up a local PG and override:
      ```bash
      make quickstart migration            # local postgres on host :5432
      cd langwatch
      DATABASE_URL="postgresql://prisma:prisma@localhost:5432/mydb?schema=langwatch_db" \
        pnpm prisma migrate deploy
      DATABASE_URL="postgresql://prisma:prisma@localhost:5432/mydb?schema=langwatch_db" \
        pnpm test:integration src/server/api/routers/__tests__/project.create.langyKey.integration.test.ts
      ```

**Open question (still):** finalize the least-privilege permission set (current: traces/evaluations/datasets/
scenarios/annotations/analytics/prompts/triggers/workflows = write, cost = read; no secrets/admin/audit).
Validate against what `langy.ts` + Langy's MCP tools actually call; trim to smallest viable.

## PR 2 — adaptive "Set up Langy" modal (#4274)  ·  *needs #4273*

One modal, server picks the branch:

```
① Langy key:  (•) Create dedicated Langy key ⭐   ( ) Use existing project key
② Model:
     A  Anthropic configured → "✓ Use Anthropic" (1-click)
     B  other provider only  → "✓ Use your <provider>" (default) + soft Anthropic nudge
     C  none configured      → [Add a model →] deep-link to Settings → Model Providers
                               (Anthropic prefilled), return-URL continuation back to the modal
```

- [ ] Reuse `src/components/scenarios/ModelProviderRequiredModal.tsx` as the pattern.
- [ ] **Gate (this PR):** the existing `ModelProvider` 409 in `src/server/routes/langy.ts:235`
      (`getVercelAIModel` → 409 at :244) — Langy's *real* failure today.
- [ ] Branch C reuses the real model-provider form (one source of truth, no duplicated validation).

### Execution map (researched — ready to build)
- **New component** `src/components/langy/SetUpLangyModal.tsx` — Chakra `Dialog` (same shape as `ModelProviderRequiredModal`).
- **Readiness / branch detection:** `api.modelProvider.getAllForProjectForFrontend.useQuery({ projectId })`
  → inspect enabled providers; Anthropic present = branch A, other-only = branch B, none = branch C.
- **Model dropdown:** reuse the existing `<ModelSelector model options={allModelOptions} onChange mode="chat" showConfigureAction />`
  from `src/components/ModelSelector.tsx` — it already renders grouped options *and* the branch-C
  "No models configured" callout via `useModelSelectionOptions` (its `isEmpty`).
- **Persist the pick:** `api.modelProvider.saveDefaultModelsConfig` mutation (feature key for Langy's default
  chat model; confirm key — likely `prompt.create_default` or a new `langy.*` role in `featureRegistry.ts`).
- **Wire the trigger:** `LangySidebar.tsx:427` `useChat({ onError })` — detect the 409 (status/`error` body)
  and open the modal instead of (or before) the toast. Optional: proactively open on mount when
  `getAllForProjectForFrontend` shows not-ready (more seamless than waiting for the error).
- **Key section:** PR1 already auto-mints the dedicated Langy key, so ① is a confirmation line
  ("✓ dedicated Langy key ready"), not an action.
- **Return-URL continuation (branch C):** deep-link `/settings/model-providers?return=<langy>` and reopen the
  modal on return (mirror an OAuth `redirect_uri`).

## PR 3 — route Langy LLM through the gateway / VirtualKey (#4275)  ·  *needs #4274*

Note: #4272 already provisions the VirtualKey and points the worker's opencode at `gatewayBaseUrl`.
This PR makes the **control-plane gate** honest and binds the VK to a provider chain.

- [ ] Ensure the Langy `VirtualKey` (already minted by `LangyCredentialService`) is bound to a
      `GatewayProviderCredential` fallback chain (reuse `src/server/gateway/virtualKey.service.ts`).
- [ ] Rewire / replace the `getVercelAIModel` availability check at `langy.ts:235` so the gate reflects
      **VirtualKey readiness** rather than the legacy `ModelProvider` path.
- [ ] Flip the modal's gate (from #4274): "ModelProvider configured?" → "VirtualKey configured?"
      (UI unchanged, only the underlying check).

## Dev env / verify

```bash
cd ~/langwatch_codebase/langy-keys/langwatch
pnpm install                       # match repo pnpm (corepack may pull the wrong major — see memory)
pnpm start:prepare:files           # regenerate Prisma/zod/generated types after worktree creation
pnpm typecheck
pnpm test:integration <file>       # real DB, no mocks
make quickstart migration          # postgres + clickhouse on host ports, for prisma + integration tests
```

## Conventions (from CLAUDE.md)
- Spec → test → code (outside-in TDD). Update the `.feature` *before* changing behavior.
- Always include `projectId` in Prisma WHERE clauses for project-level models.
- Each PR body: `Refs #4528` + tick the relevant sub-issue checkbox.
- No re-exports for back-compat; no new REST endpoints.
