# Langy frontend — handoff

Worktree: `.claude/worktrees/langy-frontend/langwatch` · Branch: `feat/langy-frontend`
Dev server: http://localhost:5600 (login `admin@local.langwatch.dev` / `LocalAdmin!2026`)
Do NOT push / rebase — coordinator owns the PR stack.

## Commits added on this branch
- `a84d56e5b` refactor(langy): single Zustand store + React Query server state; sidecar rename
- `9fac9e887` feat(langy): full read-tool card coverage + docked panel shadow

`pnpm typecheck`: green for all changed non-test files (verified via tslsp diagnostics).
One PRE-EXISTING unrelated error remains at
`src/server/services/langy/execution/langy-turn.processor.ts:289` (logger typing) — ignore.

## 1) State-layer redesign (done, verified streaming e2e on :5600)
- NEW single store `src/features/langy/stores/langyStore.ts` (`useLangyStore`): panel
  open/closed, activeConversationId (+ history-load gate), composer draft, model
  override, dismissed context chips, proposal apply/discard lifecycle, Stream-B
  optimistic text + turn id, persisted dev mode. Folds in the old `langyComposerStore`.
- Server state now = the langy tRPC router via React Query: `useLangyConversationList`
  (recents) + `useLangyMessages` (history). The bespoke fetch-in-useEffect
  `useLangyConversations` is DELETED.
- Conversation delete = NEW tRPC mutation `langy.deleteConversation`
  (`src/server/api/routers/langy.ts`) → app-layer `conversations.deleteById` (dispatches
  the event-sourced archive command). NO raw client fetch for commands anymore.
  Frontend caller: `data/useLangyConversationCommands.ts`.
- Panel OPENS EMPTY by default (removed localStorage last-conversation restore).
- Stream B fast-path tokens are consumed directly into the store (`useLangyFastStream`).
- History hydration into useChat is gated on a user selection
  (`historyLoadConversationId`) and `setMessages` is captured behind a ref so a
  background refetch / a just-created conversation never clobbers the live stream.
  (This ref was the fix for an infinite `setMessages` render loop — do not remove it.)
- DEAD CODE removed: `useLangyConversations`, `useLangyNewCount`,
  `stores/langySseStatusStore`, `stores/langyComposerStore`. `useLangyFreshness` stripped
  of the now-dead SSE-status writes / newCount invalidation (keeps cache invalidation).
- `useLangyDevMode` now delegates to the store.

## 2) Card catalogue (#27) — `components/capabilities/capabilityRegistry.ts`
- Every READ tool now resolves to a real card (no raw-JSON fallback) EXCEPT the
  docs/schema helpers, which render as clean activity lines instead
  ("Reading the docs" / "Checking the schema" in `LangyToolActivity.tsx`).
- Added surfaces + nouns: workflows, annotations, secrets, projects, api_keys,
  model_providers, prompt_tags(->prompts).
- Fixed 3 mis-parses that fell to JSON: `platform_experiment_list`,
  `platform_experiment_list_runs`, and the `rename`/`set`/`assign` verbs
  (rename_dashboard, set_model_provider, assign_prompt_tag).
- Settings/org surfaces render a card but no (wrong) deep-link (`SURFACE_NO_DEEPLINK`).
- WRITES still use the backend proposal object -> `ProposalCard` (unchanged).

## 3) Langy -> Foundry, admin/dev-gated (#28)
- NEW `components/LangyFoundryMenu.tsx` header control that opens the Foundry drawer
  (`useDrawer().openDrawer("foundry")`), gated on `useOpsPermission().hasAccess` — the
  SAME gate as the Foundry page. Verified hidden for the non-ops local admin (the
  `/ops/foundry` page also redirects them). Shows for ops users via the identical gate.

## 4) Thinking verbs — confirmed
- `LangyPanel` imports `LANGY_THINKING_VERBS` and passes them to `useCyclingVerb`;
  verified cycling live (the "thinking" text length oscillates as verbs rotate).

## UX polish from live review
- Renamed `LangyDrawer` -> `LangySidecar` (it docks from the side, not a drawer;
  also `LangyDrawerProps`->`LangySidecarProps`, `LangyDrawerConnected`->`LangySidecarConnected`).
  `LangyPanel` reads open/close from the store — the controlled/uncontrolled prop dance is gone.
- Collapse handle: `LANGY_DOCKED_OFFSET` now = PANEL_WIDTH + PILL_WIDTH so the handle sits
  in a gutter between page content and the panel, overlapping neither (it used to stick
  through the panel edge over the content). Hover nudge disabled when open.
- Restored the docked panel's left shadow (reference `--sh-panel`) so it floats, not flat.

## Streaming perf (measured on :5600)
- Perceived: thinking indicator paints ~60ms after send. Answer renders correctly.
- Wall-clock to full answer was ~21-27s in this local box — dominated by the Langy agent
  (OpenCode) SPAWN + model latency, NOT the panel. The panel renders tokens as they arrive.

## NOT done / known gaps (pick up here)
- TESTS: the 3 panel integration tests still assume the OLD fetch-based flow +
  auto-restore-last behavior and will FAIL at runtime. They need rewriting to mock
  `api.langy.list`/`langy.messages`/`langy.deleteConversation` and drive the store
  (set `useLangyStore.setState({ isOpen: true })`; open-empty by default). Files:
  `__tests__/LangyConversationHistory|LangyConversationThreading|LangyInlineModelSetup.integration.test.tsx`
  (already have the LangyDrawer->LangySidecar rename applied on disk, uncommitted).
  `ProjectLangyLayout.integration.test.tsx` asserts isOpen survival via LangyContext —
  now it's in the store.
- SPECS: `specs/langy/` referenced by tests does NOT exist on disk — add a feature file
  for the open-empty + store-driven behavior (CLAUDE.md: specs are the requirements).
- VISUAL FIDELITY: calibrated against `langy-full-experience-reference.html` tokens
  (--brand #ED8926, --hair, card r=14px, composer r=18px, spktile r=10px, --sh-panel).
  Panel shadow fixed; a fuller pass over card radii / mono overlines / bubble bg to the
  reference is still open if the "ugly corners / colours" feedback persists.
- The live streaming stat card / progress bar (`useLangyTurnSignals`) still returns null
  (PR3 transport seam) — that's why the "fluid" mid-stream cards don't appear yet.

## Tooling note for the next agent
Edit/Write were harness-pinned to a DIFFERENT worktree (adr-domain-errors, later
langy-stack) this whole session, and EnterWorktree could not cross the submodule-worktree
boundary, so files here were authored via bash heredocs. If your Edit/Write resolve to
`langy-frontend`, prefer them. Use tslsp for symbol nav/rename/diagnostics.
