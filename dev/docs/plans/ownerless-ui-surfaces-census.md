# Ownerless UI surfaces census

`platform/app` was deleted in `faaa9ec333` (2026-09-03). 47 comments across `apps/**` and
`packages/**` still assert it is live — "still `platform/app`'s registered drawers", "a page
`platform/app` still serves", "BOTH addresses are still served by `platform/app`". Each such
claim names a surface. This file states, for every one, what that surface's actual state in
the tree is today.

Sweep command (47 hits; a 48th is a false positive inside
`packages/prisma-client/src/generated/internal/class.ts`, which embeds the Prisma schema
string):

```
grep -rn "still .*platform/app\|platform/app.*still\|platform/app's" apps packages \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=build --exclude-dir=coverage
```

## Summary

| Group | Meaning | Sites |
| --- | --- | --- |
| **(a)** | Already owned — the comment is merely stale | **34** |
| **(b)** | Surface exists in a web package but is not installed in `apps/ui` | **4** |
| **(c)** | Surface died with the platform and nothing replaces it | **9** |
| | **Total** | **47** |

The site count understates the damage, because one comment can name three drawers and
several ownerless surfaces are named by no comment at all. Counted by **surface** rather
than by comment:

| Surface class | Owned today | Ownerless |
| --- | --- | --- |
| Page keys in `ui-route-table.ts` | 134 / 134 | 0 |
| Settings-menu hrefs | 33 / 33 | 0 |
| Registered drawer names | 17 | **22** |

### The two clean bills of health

**Pages are whole.** Every one of the 134 `page:` keys in
`apps/ui/src/model/ui-route-table.ts` resolves to a loader registered under
`apps/ui/src/features/**`. There is no 404 anywhere in the route table, and
`resolveUiPageLoader` (which throws on a miss) is never reached with an unknown key. Every
"a page `platform/app` still serves" claim is therefore stale.

**The settings menu is whole.** All 33 hrefs in `apps/ui/src/model/ui-settings-menu.ts`
match a `path:` in the route table, and each of those has a loader. The claim that
"`platform/app` still serves twenty-odd of these" is stale.

### Where the damage actually is: drawers

`platform/app/src/components/drawerRegistry.ts` named 39 drawers. It was deleted in
`72ed591a13` ("Move the studio, the traces family and the drawer infrastructure out of
platform"); most of its components were deleted in `cc91631cd8` ("Second reachability
census: delete 230 unreachable platform files").

`apps/ui/src/features/installed-ui-drawers.ts` registers **17**. Everything else that any
screen, command-bar entry, host adapter or **outbound email** still addresses by name opens
nothing: `CurrentDrawer` looks the name up in `installedUiDrawers`, misses, and renders
null. There is no error, no toast and no log line — the reader clicks and the page does not
move.

Registered today: `addOrEditDataset`, `agentTypeSelector`, `agentWorkflowEditor`,
`annotationScoreEditor`, `codeEvaluatorEditor`, `evaluatorCategorySelector`,
`evaluatorEditor`, `evaluatorHistory`, `evaluatorList`, `promptEditor`, `promptList`,
`scenarioEditor`, `scenarioRunDetail`, `scenarioVersionHistory`, `selectDataset`,
`suiteEditor`, `uploadCSV`.

---

## Per-site rows

### Group (a) — already owned, comment merely stale (34)

| # | File:line | Claim (abridged) | Surface it names | State today |
| --- | --- | --- | --- | --- |
| 1 | `apps/ui/tests/chrome-drawer.integration.test.tsx:207` | "when the page below is one platform/app still serves" | The test fixture's own `/legacy` route | Fixture-local. No real route key lacks a loader, so the scenario models a case that cannot occur. Stale scenario name. |
| 2 | `apps/ui/tests/chrome-layout.integration.test.tsx:174` | "when the matched page is one platform/app still serves" | Same `/legacy` fixture; asserts the bare-outlet branch | Same. The branch it guards (`ui-app-chrome`'s "which half serves this page") is now always true. |
| 3 | `apps/ui/tests/ui-settings-menu.unit.test.ts:11` | "`platform/app` still serves twenty-odd of these" | 33 settings-menu hrefs | All 33 resolve to route-table paths with loaders. |
| 4 | `apps/ui/src/ui/sections/ui-settings-layout.tsx:23` | "the addresses of the pages still served by `platform/app` are unchanged and its router still answers them" | Same 33 hrefs | Same. The "copy rather than a repoint" rationale is spent — there is no platform `SettingsLayout` left to diverge from. |
| 5 | `apps/ui/src/behavior/ui-feature-loaders.ts:16` | "Empty while the first screen family is still in `platform/app`: the host registry answers for all 136 keys" | `uiFeatureLoaders` | Still literally `{}`, and now dead: `ui-application.tsx:92` passes `features.loaders ?? uiFeatureLoaders`, and `installedUiFeatures.loaders` (133 keys) always wins. Vestigial, not a gap. |
| 6 | `apps/ui/src/ui/sections/ui-route-objects.tsx:52` | "a page `platform/app` still serves brings its own header" | The `handle: { page }` the chrome reads | The handle is still written and still read; the question it answers has one answer now. Dead branch. |
| 7 | `apps/ui/src/features/installed-ui-page-keys.ts:4` | "a page `platform/app` still serves draws its own header" | `installedUiPageKeys` | Same. The set now contains every key the router can match. |
| 8 | `apps/ui/src/features/chrome/ui/sections/ui-app-chrome.tsx:21` | "WHY IT STILL ASKS WHICH HALF SERVES THE PAGE" | The shell-vs-bare-outlet branch | Same dead branch. Note the same comment correctly claims `CurrentDrawer` is mounted once above the outlet — that part is true and load-bearing. |
| 9 | `apps/ui/src/features/navigation/behavior/navigation-host.adapter.ts:208` | "the same honest answer this returned while the palette was still in `platform/app`" | Command palette | Answered for real; `features/chrome` mounts `CommandBarProvider`. Stale. |
| 10 | `apps/ui/src/features/workflows/behavior/workflows-host.adapter.ts:17` | "BOTH addresses are still served by `platform/app` — the studio key did not move" | `/:project/workflows`, `/:project/studio/:id` | Both have loaders (`pages/[project]/workflows`, `pages/[project]/studio/[workflow]`). Stale. |
| 11 | `packages/features/workflow/web/src/ui/sections/workflow-create-dialog-host.tsx:11` | "the studio, which `platform/app` still serves at `/:project/studio/:id`" | Studio route | Owned. Stale. |
| 12 | `packages/features/workflow/web/src/screens/workflows/workflows.screen.tsx:14` | "an address `platform/app` still serves" | Studio route | Owned. Stale. |
| 13 | `packages/features/workflow/web/src/model/workflow-host.ts:19` | "an address `platform/app` still serves" | Studio route | Owned. Stale. |
| 14 | `packages/features/workflow/web/src/screens/studio/index.ts:11` | "`platform/app` may not shrink a module another page still imports" | The studio move rationale | The constraint no longer exists. Stale rationale. |
| 15 | `packages/features/annotation/web/src/model/__tests__/annotation-overlay-address.unit.test.ts:128` | "The walker is still served by `platform/app`" | `/:project/annotations/my-queue` | Loader registered. Stale. |
| 16 | `packages/features/annotation/web/src/index.ts:2` | "The names `platform/app` still imports from this package" | The package root entry | 6 in-repo consumers remain, none of them platform. Entry justified by different callers now; rationale stale. |
| 17 | `packages/features/evaluator/web/src/index.ts:2` | "The evaluator presentation primitives `platform/app` still reads" — "thirteen `platform/app` modules import it" | The package root entry | 9 in-repo consumers remain, none platform. Same. |
| 18 | `packages/features/user/web/src/index.ts:10` | "the registry it asserts against is still a `platform/app` module, so the test cannot travel" | `processAvatarImage` root export | The platform test is deleted. 1 consumer left. The stated blocker is gone — `apps/ui/src/model/errors/presentation.ts` now holds the registry and `apps/ui/src/model/errors/__tests__/avatar-image-processing.unit.test.ts` exists. |
| 19 | `packages/features/evaluator/web/src/ui/sections/evaluator-history-panel.tsx:10` | "`platform/app`'s registered copy stays for the URL that still names it" | `evaluatorHistory` drawer | Registered in `evaluatorDrawers`. Stale. |
| 20 | `packages/features/evaluator/web/src/ui/sections/evaluator-list-drawer.tsx:20` | "the same call from a page `platform/app` still serves are one cache entry" | `evaluators.getAll` cache sharing | No platform page shares the cache any more. The segment-name rule still holds for other packages. Stale. |
| 21 | `packages/features/evaluator/web/src/ui/sections/evaluator-list-drawer.tsx:28` | "those three are still `platform/app` modules … The address is written and nothing opens" | `evaluatorCategorySelector`, `evaluatorEditor`, `codeEvaluatorEditor` | **All three are registered** via `workflowDrawers` / `studio-host-drawers.tsx`. The recorded gap closed; the comment did not. |
| 22 | `packages/features/model-provider/web/src/behavior/use-all-model-providers-list.ts:5` | "`useModelProvidersSettings` (still `platform/app`'s, for the editor drawer)" | That hook | `@langwatch/model-provider-web` exports `./hooks/useModelProvidersSettings`. Stale. |
| 23 | `packages/features/prompt/web/src/behavior/prompt-api.ts:19` | "the prompt editor drawer, the workflow signature panel and the experiments workbench all still read prompts from `platform/app`" | Three consumers | All three are in packages now. The load-bearing segment-name rule still holds; the named consumers are stale. |
| 24 | `packages/features/prompt/web/src/screens/prompt-studio/fields/demonstrations-field.tsx:24` | "the prompt editor drawer — still `platform/app`'s … still edits them" | `promptEditor` drawer | Registered. The separate "editing did not travel" loss stands, but `@langwatch/dataset-web` does export `./components/datasets/editor/DatasetEditorTable`, so the stated blocker is gone. |
| 25 | `packages/features/experiment/server/src/app/__tests__/experiment.transport.unit.test.ts:14` | "are still `platform/app/src/server/routes/experiments-v3.ts`" | `/api/experiments/runs*` | Served by `apps/api` (`app-rest.process-features.ts`, `api-experiment-run.composition.ts`). Stale. |
| 26 | `packages/features/github/server/src/adapters/__tests__/eventing.github-maintenance.unit.test.ts:5` | "FROZEN TWIN. Two graphs register this definition today … platform/app's legacy `pipelineRegistry`" | Pipeline job-name literals | One registrar left (`apps/worker`). The "may only change in a commit that changes the twin too" rule is now vacuous and should be retired deliberately rather than silently. |
| 27 | `packages/features/data-retention/contract/src/data-retention.snapshot.ts:5` | "the read model behind it still lives in `platform/app`" | `dataRetention.getRules` | Mounted by `@langwatch/data-retention-server` (`transport/api-trpc/data-retention.api.ts:148`). The stated "restatement rather than a move" and the alignment promise are both resolvable now. |
| 28 | `packages/features/analytics/web/src/ui/blocks/__tests__/langwatch-ql-result-pane.integration.test.tsx:344` | "`platform/app`'s version compared the two resolved titles; the registry does not travel" | Error presentation registry | The registry did travel — `apps/ui/src/model/errors/presentation.ts`, 3,726 lines. Stale premise; the assertion it justifies is still fine. |
| 29 | `packages/enterprise/features/governance/web/src/behavior/governance-feedback.ts:14` | "the full registry, its tips, its docs links and its global-handler dedup still live in `platform/app`" | Error presentation registry | Registry moved (3,726 lines). Docs link and trace id are wired through `BrowserUiFeedback` → `ui-error-toaster.tsx`. Only the global-handler dedup is genuinely absent, and `isReportedGlobally: false` is now the correct answer rather than a gap. |
| 30 | `packages/features/organization/web/src/behavior/organization-feedback.ts:15` | Same claim | Same | Same. |
| 31 | `packages/features/user/web/src/behavior/personal-workspace-feedback.ts:14` | Same claim | Same | Same. |
| 32 | `packages/features/ops/web/src/behavior/ops-feedback.ts:14` | Same claim | Same | Same. |
| 33 | `packages/features/automation/web/src/behavior/automation-feedback.ts:15` | Same claim, plus "`explainAnyError` does not travel" | Same | Same. |
| 34 | `packages/features/gateway/web/src/behavior/gateway-feedback.ts:14` | Same claim | Same | Same. |

Recommendation for all 34: delete or rewrite the clause. Six of them (29–34) are the same
paragraph copy-pasted, so a single sweep fixes them. Sites 5, 6, 7, 8 and 2 additionally
guard a now-unreachable branch — retiring the "which half serves the page" question removes
the `handle: { page }` write, `installed-ui-page-keys.ts`, the `uiFeatureLoaders` default and
two test scenarios. Site 26 is the one where the stale comment encodes a **rule** that is now
vacuous; retire it explicitly.

### Group (b) — surface exists in a web package, not installed in `apps/ui` (4)

| # | File:line | Claim (abridged) | Surface | State today | Recommendation | Size |
| --- | --- | --- | --- | --- | --- | --- |
| 35 | `apps/ui/src/features/agent/ui/sections/agent-drawers.tsx:18` | "THE THREE EDITORS IT LEADS TO ARE NOT INSTALLED YET. `agentCodeEditor`, `agentHttpEditor` and `workflowSelector` are still `platform/app` modules … a pick writes the next address and nothing opens" | `agentCodeEditor`, `agentHttpEditor`, `workflowSelector` | All three components exist: `packages/features/agent/web/src/features/http/ui/sections/agent-http-editor-drawer.tsx` (already exported from `screens/agent-management`), and `packages/features/scenario/web/src/ui/sections/agents/{agent-code-editor-drawer,workflow-selector-drawer,drawer-from-url}.tsx` (not exported). Picking an agent type still opens nothing. | Add the three to `agentDrawers`, exporting the two scenario ones through `@langwatch/scenario-web/drawers` first | 4 files |
| 36 | `apps/ui/tests/agent-host.adapter.unit.test.ts:7` | "The code, HTTP and workflow editors are still `platform/app`'s registered drawers" | Same three | Same | Same change; then this docblock states what the adapter writes and what receives it | 1 file |
| 37 | `packages/features/agent/web/src/screens/agent-management/__tests__/agent-management.screen.test.tsx:10` | "an editor still registered in `platform/app` is an address the host writes" | Same three | Same. The test asserts the address is written, which is still correct — it just no longer lands anywhere | Keep the assertion, correct the premise | 1 file |
| 38 | `apps/ui/src/features/chrome/index.ts:50` | "the ones whose component is still a `platform/app` module … are recorded drawer by drawer in the family manifests" | The residual unregistered set | Accurate in shape, wrong in cause: the components are in web packages or gone, not in `platform/app`. The manifests it defers to describe a tree that no longer exists | Replace the deferral with the concrete list below | 1 file |

### Group (c) — died with the platform, nothing replaces it (9)

All components below were deleted in `cc91631cd8` ("Second reachability census: delete 230
unreachable platform files"), except the drawer registry itself, deleted in `72ed591a13`.

| # | File:line | Claim (abridged) | Surface | State today | Old path | Recommendation | Size |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 39 | `apps/ui/tests/prompt-host.adapter.unit.test.ts:8` | "`traceV2Details` is still `platform/app`'s registered drawer, opened by most of the product" | **The trace drawer, everywhere except `/:project/traces`** | `traceV2Details` is not in `installedUiDrawers`, and nothing in `apps/ui` mounts `GlobalTraceV2DrawerMount`. `routeTraceDrawerForV2` rewrites every `traceDetails` open into `traceV2Details`, so *all* "View trace" affordances funnel into a name that opens nothing. Only `/:project/traces` works, because `traces-page.tsx:248` mounts its own `<TraceDrawerMount>` | `platform/app/src/components/drawerRegistry.ts` (`traceV2Details`) | Mount `GlobalTraceV2DrawerMount` (already in `@langwatch/trace-web`) in `ui-app-chrome` beside `CurrentDrawer`, or register `traceV2Details` in `installedUiDrawers`; export it from `@langwatch/trace-web` first | 2–3 files |
| 40 | `apps/ui/tests/model-provider-host.adapter.unit.test.ts:9` | "The provider editor, the default-model override and the model-cost editor are all still `platform/app`'s registered drawers" | `editModelProvider`, `defaultModelOverride`, `llmModelCost` | None registered; **no component for any of the three exists anywhere in `packages/**`** | `platform/app/src/components/EditModelProviderDrawer.tsx`, `.../settings/DefaultModelOverrideDrawer.tsx`, `.../settings/LLMModelCostDrawer.tsx` | Rebuild all three in `@langwatch/model-provider-web` and register them | ~8–12 files |
| 41 | `packages/features/model-provider/web/src/screens/model-provider/model-providers.screen.tsx:15` | "the one place a key is typed is the editor drawer, which is still `platform/app`'s and which this screen only ADDRESSES" | `editModelProvider` | **A customer cannot add or edit a model-provider credential.** The screen writes the address (line 212) and reads `query["drawer.open"] === "editModelProvider"` (line 101) to decide whether an editor is open; nothing ever opens | `platform/app/src/components/EditModelProviderDrawer.tsx` | Rebuild the credential form in `@langwatch/model-provider-web` and register `editModelProvider` | ~5 files |
| 42 | `packages/features/model-provider/web/src/behavior/use-model-provider-connection-test.ts:4` | "The sibling `useModelProviderApiKeyValidation` — still `platform/app`'s" | The typed-credential validation hook | Gone with the form above; no replacement | `platform/app/src/hooks/` (with the editor drawer) | Rebuild alongside the editor | 1 file |
| 43 | `packages/features/model-provider/web/src/behavior/use-model-provider-connection-test.ts:5` | "because the form that types a credential is still `platform/app`'s" | Same form | Same | Same | Same change | — |
| 44 | `packages/features/model-provider/web/src/ui/sections/default-models-section.tsx:12` | "'+ Add config' and each row's Edit open `defaultModelOverride`, a registered drawer that is still `platform/app`'s" | `defaultModelOverride` | Not registered, no component. Add and Edit on the Default Models table are inert | `platform/app/src/components/settings/DefaultModelOverrideDrawer.tsx` | Rebuild in `@langwatch/model-provider-web` and register | ~3 files |
| 45 | `packages/features/model-provider/web/src/ui/sections/__tests__/default-models-section.test.tsx:13` | "`defaultModelOverride` is still `platform/app`'s and the screen only addresses it" | Same | Same. The test asserts the host is asked — which still passes while the feature is dead | Same | Same change | 1 file |
| 46 | `packages/features/ops/web/src/behavior/ops-api.ts:19` | "the navigation badge, which still polls `ops.getBadgeCounts` from `platform/app`, is exactly such a call site" | The Ops sidebar badge | `ops.getBadgeCounts` is still **served** (`packages/features/ops/server/src/transport/api-trpc/ops.api.ts:301`) but nothing in the browser calls it — `@langwatch/navigation-web` has no consumer. The badge is silently gone; the procedure is a dead server surface | `platform/app` navigation shell | Either wire the badge in `@langwatch/navigation-web`, or delete the procedure. Do not leave it half-served | 2 files |
| 47 | `packages/features/user/web/src/ui/elements/model-provider-marks.tsx:11` | "the other ten are `platform/app` components that the whole product still uses" | Ten provider brand marks | Gone. The Design System publishes five; the other ten fall back to the generic model mark on the legacy tile path. Cosmetic, and the comment's stated blocker ("an edit to `platform/app` this move may not make") no longer exists | `platform/app/src/components/icons/**` | Promote the ten marks into the Design System and drop the fallback | ~11 files |

---

## Ownerless drawers named by no comment

The sweep is comment-driven, so it misses surfaces whose call sites never mentioned
`platform/app`. For completeness, here is the full diff of the old 39-name registry plus
every name any live call site addresses, against the 17 registered today. **A user hits
several of these before any of the commented ones.**

| Drawer name | Who opens it | Component today | Group |
| --- | --- | --- | --- |
| `traceV2Details` / `traceDetails` | Evaluator Try-it-out, prompt studio chat, simulations, langy links, command bar, evaluation results | `@langwatch/trace-web` (`GlobalTraceV2DrawerMount`, unexported/unmounted) | c |
| `addDatasetRecord` | Trace explorer bulk-action bar, trace overflow menu, annotation my-queue | **none anywhere** | c |
| `editModelProvider` | Model Providers screen, evaluator type selector | **none** | c |
| `defaultModelOverride` | Default Models table | **none** | c |
| `llmModelCost` | Model Costs screen | **none** | c |
| `createProject` | Teams screen, team form, CLI-auth screen | **none** | c |
| `editProject` | Teams screen | **none** | c |
| `targetTypeSelector` | Evaluations v3 table, Run Evaluation button | **none** | c |
| `comparisonLeaderboard` | Batch evaluation results | partial — `ComparisonLeaderboardChart` exists, drawer wrapper does not | c |
| `automation` | **Alert emails** (`automation/contract/src/templating/template-context.ts:271`), trace explorer Automate button, command bar, langy links | `@langwatch/automation-web` has the drawer, but the screen reads `?automation=<id>` / `?viewAutomation=<id>`, not `?drawer.open=automation` | b |
| `routingPolicy` | Gateway virtual-key screen (`gateway-virtual-key.screen.tsx:487`, an `href`) | `@langwatch/gateway-web` has the drawer, but the screen reads `?policy=<id>` | b |
| `agentViewer` | Command-bar entity search, command entity registry | **none** (never in the old registry either) | c |
| `agentCodeEditor` | Agent type selector, scenario agent list, experiments target editor, langy relay links | `@langwatch/scenario-web` (unexported) | b |
| `agentHttpEditor` | Agent type selector, scenario agent list, experiments target editor | `@langwatch/agent-web/screens/agent-management` (**exported**) | b |
| `workflowSelector` | Agent type selector | `@langwatch/scenario-web` (unexported) | b |
| `agentList` | Studio agent-picker flow, evaluations v3 table | `@langwatch/scenario-web` (unexported) | b |
| `agentWorkflowTargetEditor` | Experiments target editor | `@langwatch/scenario-web` (unexported) | b |
| `workflowSelectorForEvaluator` | Evaluator category selector | `@langwatch/evaluator-web` (unexported) | b |
| `onlineEvaluation` | Online Evaluations screen, langy capability registry, **monitor alert emails** (`monitor/server/src/transport/api-rest/monitor.api.ts:142`) | `@langwatch/evaluator-web` (unexported) | b |
| `guardrails` | Online Evaluations screen | `@langwatch/evaluator-web` (unexported) | b |
| `agentTestingPlanEditor` | agent-testing surfaces | `@langwatch/scenario-web` (unexported) | b |
| `inviteMember` | Members screen, command bar | `@langwatch/organization-web` (unexported) | b |
| `createTeam` | Teams screen | `@langwatch/organization-web` (unexported) | b |
| `foundry` | Command bar | `@langwatch/ops-web` (exported from root) | b |

Retired deliberately — these are **not** gaps. Each family converted its drawer to a
local overlay keyed on its own query parameter, and recorded why: `dashboardName` and
`seriesFilters` (`@langwatch/analytics-web`), `opsGroupDetail` (`@langwatch/ops-web`),
`dataPrivacyRule` (`@langwatch/data-privacy-web`), `addAnnotationQueue`
(`@langwatch/trace-web`, mounted by `add-to-annotation-queue-dialog.tsx`), and
`addOrEditAnnotationScore` (renamed to the registered `annotationScoreEditor`). Old
`?drawer.open=` links to these no longer reopen them.

## Two outbound-email links that now go nowhere

Worth separating because they leave the product and cannot be fixed after the fact:

- `packages/features/automation/contract/src/templating/template-context.ts:271` mints
  `…/automations?drawer.open=automation&drawer.automationId=<id>&drawer.source=email-link`
  for every alert email. `automations.screen.tsx` reads `?automation=<id>`. The link lands
  on the automations list with nothing open.
- `packages/features/monitor/server/src/transport/api-rest/monitor.api.ts:142` mints
  `…/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=<id>`, and
  `onlineEvaluation` is unregistered.
