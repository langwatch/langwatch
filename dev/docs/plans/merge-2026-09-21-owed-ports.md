# Owed ports from the 2026-09-21 origin/main merge

This merge (base `c5999477f`, main `84a6dcc7e1`) ported main's changes into the module layout. Every row below
is a change of main's that did **not** land yet. It is carried here so nothing is silently dropped. Each is a
normal post-merge PR: read main's change with `git diff c5999477f 84a6dcc7e1 -- platform/app/<path>` (or
`git show 84a6dcc7e1:platform/app/<path>` for an added file), port it into its module, and delete its row.

## Rows owed (main's file → why it has not landed)

| main path (under `platform/app/`) | state |
|---|---|
| `e2e/langy/fake-explorer-tab.ts` | blocked: needs a shared-model move plus an unrunnable LLM suite main's headless Explorer tab (and its consumer langy-find-traces.scenario.test.ts, also missing) shares readLiveExplorer, the explorer manifest and defaultE |
| `ee/admin/backoffice/resources/IdentityLookupView.tsx` | deferred: identity lane (modules/ops browser) main 44521d36f0/d41f19a46e: the identity lookup page gains the claim queue panel (ClaimQueuePanel, waitedFor) and loses the nested Card for flush sections; ops backoffice is |
| `ee/event-sourcing/pipelines/sso-connections/process-manager/__tests__/sso-domain-proof-notification.process.unit.test.ts` | blocked: per-recipient durable fan-out needs an eventing capability the two facts, their stable per-ceremony keys and the mails are present (identity eventing/sso-domain-proof-notification.process.ts, services/sso-domain |
| `ee/scim/routers/scimReconciliation.ts` | blocked: getActivity/getById unported (plan gate ported) getAll and getRequests are served (scim-reconciliation.trpc.ts) and getAll now asks the plan as main does (ScimApp.getDirectoryReconciliation -> EnterprisePlanRequ |
| `ee/scim/routers/scimToken.ts` | blocked: supplied secret needs a keyed digest the process must supply list/generate/revoke with sso:view / sso:manage are served (scim-token.trpc.ts). Missing from main: (1) generate accepts an administrator-supplied sec |
| `ee/telemetry/instances/composition.ts` | B-cloud-instances Cloud instances composition + CloudCustomerLookup over user/organization owners, and the usage-report receiver host (open decision, G-1b4 §11.2) |
| `prisma/seed.ts` | blocked: R1 authz grants-only cutover main seeds through seed-authz.ts (Grant row + compat RoleBinding + Role projection). Successor packages/storage-seed/src/seed.ts:255-275,390-450 still writes raw RoleBinding/CustomRo |
| `scripts/seed-local-admin.ts` | blocked: R1 authz grants-only cutover same change as seed.ts (grant-backed bindings); successor is packages/storage-seed/src/seed.ts:252-275 (the admin org+team bindings), raw RoleBinding today; ports with the seed.ts ro |
| `src/components/home/__tests__/LangyHomeHero.integration.test.tsx` | blocked: project module, §10 S-6 main's hero stands its ask field down while the panel is open on a conversation (ContinueLine at the field's height, suggestions hidden in place, one field never starts a second conversat |
| `src/components/home/__tests__/OnboardingProgress.analytics.integration.test.tsx` | blocked -> §10 (project module owner) main's card sends onboarding_variant on viewed/onboarding_progress from checkStatus.guidedOnboarding.variant (main OnboardingProgress.tsx:233-242, fed by onboarding-checks.service.ts |
| `src/components/members/TwoStepRequirementCard.tsx` | blocked: whole feature absent main's change extracts useEnterpriseLock (behaviour-neutral). The card, its hook and the whole organization two-step admin surface (twoStepVerification.standing/requirement/setRequirement/me |
| `src/features/guided-onboarding/__tests__/guidedConversation.unit.test.ts` | blocked: follows guidedConversation.ts (handoff Risks R-2) the 22 cases test the reader above (isGuidedConversation, guidedPathCompletedIn, guidedPathInProgress, guidedPullRequestFromMessages); they land with it |
| `src/features/guided-onboarding/guidedConversation.ts` | blocked: Langy's guided-conversation rendering needs a boundary decision (handoff Risks R-2) main reads the kickoff part in the transcript to tell a guided conversation (tour card on the kickoff, the pull request as a se |
| `src/features/guided-onboarding/home/__tests__/GuidedOnboardingOffer.integration.test.tsx` | blocked: the Home offer spans four owners' homes and the inert Langy hand-off (handoff Risks R-2, §10 S-4) GuidedOnboardingOffer and useSpaceInUse have no successor (the earlier "present -> langy-panel.tsx" was wrong). T |
| `src/features/guided-onboarding/takeover/__tests__/providers.unit.test.ts` | blocked: the provider step's model pills were replaced by the shared credential form (handoff Risks R-3) main's guidedChatModels (up to four chat-model pills, the catalog's recommendedChatModel first, bare names, none fo |
| `src/server/analytics/lwql/__tests__/instantEvalQueries.unit.test.ts` | blocked (Risks R1) all nine cases are synchronous judged queries through LangWatchQLService.execute: per-query text-volume refusal, free-budget refusal and ceiling hold released after spend, classifier-answered-nothing a |
| `src/server/analytics/lwql/appFunctions/__tests__/evaluateConversationBudget.unit.test.ts` | blocked (Risks R2) main re-renders a conversation past the judge's budget through conversation_bounded, keeping both ends and naming the omitted turns, and marks the row truncated. Here the run path hydrates eval(convers |
| `src/server/analytics/lwql/appFunctions/hydrate.ts` | blocked (Risks R1, R3); read/extract half present -> modules/analytics/process/src/services/langwatch-ql-hydration.service.ts collect keys, check caps before fetch, read once per kind, compute once per key, assemble with |
| `src/server/analytics/lwql/catalog/__tests__/columnsManifestParity.integration.test.ts` | blocked (Risks R4) no parity proof exists (the generator script modules/analytics/process/scripts/generate-lwql-columns-manifest.ts:5 even cites one). Main's test runs the very dump the generator calls; here that dump is |
| `src/server/app-layer/identity/__tests__/identity-lookup.service.unit.test.ts` | blocked: with the IdentityLookupView row main rewrote the suite around resolve-by-router, invitations, detach-with-stranding, per-method session ending and the claim queue. The tree's IdentityLookupService (resolve/findP |
| `src/server/app-layer/instant-evals/shorthand/__tests__/expandValidates.unit.test.ts` | partial: not ported (Risks R3) main runs every expanded shorthand (three targets, every question kind, a filter of every condition shape) through the LangWatchQL validator. That validator is analytics-process's and the e |
| `src/server/app-layer/instant-evals/spend/__tests__/instantEvalSpendLedger.integration.test.ts` | partial: §10 request to the gateway owner main's real-ClickHouse proof that a finished run and a synchronous query each land one confirmed ledger row (customer price, request type instant_eval) and that the free budget s |
| `src/server/app-layer/presets.ts` | blocked: R10 system-migration runner + R11 stripe webhook composition main composition root. Present: break-glass RequiresLocalDoorAndBinding modules/identity/process/src/app/identity.app.ts:408; LicenseDomainClaimAuthor |
| `src/server/onboarding-checks/onboarding-checks.service.ts` | blocked: project module, §10 S-5 main adds guidedOnboarding {variant, paths, currentPath, donePaths} to integrationsChecks.getCheckStatus (read from the organization's signupData) for the Home offer and OnboardingProgres |
| `src/server/onboarding/__tests__/guided-onboarding.analytics.unit.test.ts` | partial: §10 request to final-onboarding guided-event tracking is present in onboarding (not this lane's module): event names, named payload fields only, provider+model never a key, current path on tour events, conversat |
| `src/server/onboarding/__tests__/guided-onboarding.events.unit.test.ts` | blocked: nurturing fan-out needs a boundary decision (handoff Risks R-1); analytics half ported -> modules/onboarding/process/src/services/guided-onboarding.service.ts ported main's attribution: a write with no user (pro |
| `src/server/onboarding/__tests__/project-active-day.unit.test.ts` | blocked: billing, one divergence, §10 S-7 the tracker is enterprise/modules/billing/process/src/services/project-active-day-tracker.service.ts with 3 of main's cases. Divergence: main resolves the admin before claiming t |
| `src/server/role/repositories/__tests__/role.repository.unit.test.ts` | blocked: R1 authz grants-only cutover main repoints the role repository from CustomRole to the Role projection head (findById/assertNameFree read role where deletedAt null, retirement exclusivity reads grant); this tree |
| `src/server/app-layer/instant-evals/shorthand/__tests__/expandValidates.unit.test.ts` | partial: not ported (Risks R3) |
| `src/server/app-layer/instant-evals/spend/__tests__/instantEvalSpendLedger.integration.test.ts` | partial: §10 request to the gateway owner |
| `src/server/onboarding/__tests__/guided-onboarding.analytics.unit.test.ts` | partial: §10 request to final-onboarding |
| `ee/governance/services/pullers/__tests__/pullerWorkerErasureSuppression.unit.test.ts` | not ported: erasure suppression in the pull run (erasureDigest, export and discovery skip the erased). The module pull worker has no erasure seam; the six cases are it.todo in services/__tests__/ |
| `ee/governance/services/pullers/__tests__/pullerWorkerIdentityMatch.unit.test.ts` | not ported: the pull run's optional identity-matcher seam after person discovery; four cases it.todo in services/__tests__/ |
| `ee/governance/services/pullers/__tests__/pullerWorkerUnpricedWindow.unit.test.ts` | not ported: the unpriced-window record for days read without recording cost; eight cases it.todo in services/__tests__/ |
| `ee/governance/services/pullers/__tests__/pulledRowGovernanceHome.integration.test.ts` | not ported: needs the pulled-usage ledger scope id and the hidden governance project home; two cases it.todo in services/__tests__/ |
| `ee/governance/services/pullers/__tests__/pulledUsageRerun.integration.test.ts` | not ported: needs the governance cost-rollup fold projection and store (never ported); one case it.todo in services/__tests__/ |
| `ee/governance/projections/governanceCostRollup.foldProjection.ts` | not ported: the cost-rollup fold projection; the restated-bill case in __tests__/ingestion-pull-worker.pulled-usage.unit.test.ts is it.todo |
| `ee/governance/services/activity-monitor/__tests__/activityMonitorSpendQueryBounds.unit.test.ts` | not ported: main split spend reads into ActivityMonitorSpendClickHouseRepository with an OccurredAt ceiling and settings (#8072); the successor is PrismaActivityMonitorRepository, unbounded. Three cases it.todo in repositories/prisma/__tests__/ |
| `ee/governance/services/activity-monitor/__tests__/sourceHealthHistory.integration.test.ts` | not ported: ActivityMonitorHealthClickHouseRepository has no successor; one case it.todo in repositories/prisma/__tests__/ |

## Design questions the lanes left open (decide, then port)

- **Guided onboarding → billing nurturing:** onboarding gains a pipeline and billing subscribes (§9 cross-module
  reaction). A direct `BillingApi` call from a core module is forbidden (§11).
- **Langy kickoff vocabulary:** it lives in onboarding-browser, so langy cannot tell a guided conversation. Move the
  kickoff schema to langy-contract or an onboarding browser-kit.
- **Provider-step model pills:** this branch replaced them with the shared credential form (5b3c7b0fdc). Re-add them, or
  default the shared form to the recommended model.
- **SCIM supplied tokens:** main HMACs them with `CREDENTIALS_SECRET`, which process-stores owns. Either process-stores
  publishes a keyed-digest collaborator, or scim gets its own secret.
- **scimToken plan gate:** nothing calls `isEnterpriseEntitled` at the mount today.
- **Identity lookup back office:** identity has no transport and no browser package. Choose its home.
- **Per-recipient mail retry:** intent executors need to be able to append follow-up intents (`packages/eventing`).
- **Two-step requirement card:** it needs enforcement plus account setup across five modules before the card means anything.

## Composition debt (code ported; the host was never composed on this branch)

- Worker pipelines: `trace_processing` and the other deleted-installer pipelines (WP-1..7, `.claude/manifests/worker-pipelines.md`).
- Identity and join-request pipelines: no worker hosts them.
- The scim `lifecycle` member is supplied by no process.
- Transactional mail and the connected-statement mailer: nothing composes them.
- `OpsSystemMigrationRunner` is unavailable in every process.
- The Stripe webhook is unmounted, and `EEWebhookService` is composed nowhere.
- The project-keyed `/api/health/*` family is unserved, so checkup canaries get a 404.
- Governance has no tRPC transport (`personalVirtualKeys.*`, `governanceCost`). `governanceCost` was never ported.
- The licensing Cloud registry, instances and leads need five contract dependencies and a real system actor id (`merge-final-licensing.md` §9.3).
- Billing's PostHog channel, nurturing sink and Slack `NotificationService` are not composed.
- The `langy.*` tRPC router and the local-control and UI-action REST members are not mounted.
- `UiDeployment` lacks `PASSKEYS_ENABLED`, `NEXTAUTH_PROVIDER` and `EMAIL_PASSWORD_ENABLED`, so those sign-in sections render nothing.
- The user `secureAccountNudge` capability is declared but not mounted in the shell.

## Known test debt found during the merge

- Ops' hand-written `AuthApi` doubles break on every `AuthApi` addition. Convert them to `createApiFixture`.
- The config test `public-app-config-browser-graph` reads a path that doesn't exist at HEAD.
- The shell's governance legacy-redirect tests, and the pre-existing langy and scenario unit failures, are listed in the lane handoffs.
- `pnpm typecheck:one` points at a missing `dev/nx/typecheck-one.mjs`.
- `governance-cli.rest.ts` fails typecheck (31 errors, already red at HEAD before this merge). All 14 routes share
  `governanceCliAnswers`, whose 200 is a non-discriminated `z.union` of every route's body, and `OutputSchema` refuses that.
  Fix: give each route its own success schema, and narrow the matching `GovernanceApp` CLI method's return type.
- The `openapi-check` task CI calls (`langwatch-app-ci.yml:1173`) no longer exists (`apps/api/src/tasks/tasks.entrypoint.ts` is gone), so the OpenAPI drift job is broken. This predates the merge. Main's 10 new paths, its query paths and the traces `filter` field were ported into the frozen document by hand.
- `check:feature-parity` fails across the whole tree: 3,208 unbound scenarios, 326 unknown annotations and 8 stale exemption-list entries. Clean it up in the post-merge lint and parity sweep.
