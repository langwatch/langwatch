# Peer cycles remaining, 2026-10-08 (evening)

Date: 2026-10-08. Lane: peer-cycles-remaining (read-only plan). Builds on `peer-cycle-layering-2026-10-08.md` (the target, ruled in round 36) and the rulings through round 53 (`.claude/coordinator/rulings-2026-10-07.md`), with round 44's open questions from `.claude/coordinator/held-questions.md`. Patterns follow R40: shared reads over copies, facts for writes, doors move down the layering (the higher module serves the door and calls down), Api-bound channels (round 34) where a lower module must ask a higher one.

## 1. The graph now

- **Command.** `pnpm lint:architecture --policies peer-cycles --all`: **135 findings**, `architecture-enforcer: 135 findings across 1 policy, exit 1`. The run was on the shared working tree, which other lanes had changed but not committed (131 dirty paths).
- **Named exception landed.** The policy prints `kept by named exception: identity <-> organization (owner organization; round 29 PC-1)`, so that pair no longer counts.
- **Edges.** 372 declared peer edges, read with the policy's own `peerEdges` (`packages/architecture-enforcer/src/policies/boundaries/peer-cycles.ts:238`). The layering plan had 382.
- **Component.** The same 30 modules as the layering plan. All 135 findings are inside it.
- **Landed since the layering plan (10 of its 32 cuts):** `billing -> gateway`, `billing -> project`, `billing -> data-retention`, `billing -> audit-log` (C2 group 2), `entitlement -> project` (C1), `analytics -> instant-eval` (X1 judge channel), `workflow -> monitor`, `agent -> workflow`, `agent -> trace` (W1/D3), `scim -> organization` (S1, R41 shares).

## 2. Coverage: every finding has a ruled cut

The check was to remove the 22 plan cuts that remain from today's 372 edges, together with the excepted pair. **No strongly connected component remains.** No edge points upward against the layer table in the layering plan's §3, apart from those 22. So:

- **(c) edges that no plan covers: none.** The 113 findings on the other edges are downward edges. They are reported only because some cut edge still closes a loop through them, and they clear when the cuts land.
- **New edges since the plan: none.** No edge is upward or on the same layer outside the cut set.

The 22 remaining cuts, grouped by status:

| Edge                        | Ruling                | Status                                                                                                                      | Group |
| --------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----- |
| identity -> auth            | R1, round 48          | (a) lanes a1-identity and a1-user are ready and wait for policies-DS-2d, which holds auth                                   | A1    |
| user -> auth                | R1, round 48          | (a) as above                                                                                                                | A1    |
| billing -> organization     | Q9, R42, R46, R50     | (a) commercial-C2 attempt 4 is active                                                                                       | C2    |
| trace -> instant-eval       | R36 D4, R47, R51, R53 | (a) t2-classify-search attempt 2 is active. Left: `isReleased` (trace.app.ts:1322) and the `classify` pick                  | T2a   |
| entitlement -> organization | Q9; R-C1f **unruled** | (a) only `countMemberSeats` is left. Round 44 q9 is open                                                                    | C1    |
| audit-log -> 7 owners       | R6, BC-2              | (b) recent-items-browser stopped at the process half and waits for an ownership grant. The agent repair task is not retired | L1    |
| trace -> evaluation         | PC-3, R38, R40, CH-2  | (b) t1 slice 1 is done. Slice 2 was replaced by the share, which is declared but has not been taken up                      | T1    |
| project -> trace            | R36 (plan's new cut)  | (b) no lane                                                                                                                 | T2b   |
| organization -> project     | R2, R40               | (b) no lane                                                                                                                 | O1    |
| organization -> api-key     | R3                    | (b) no lane                                                                                                                 | O1    |
| organization -> user        | round 21, R36 D1      | (b) no lane. Clears with the sign-up verdict                                                                                | U1    |
| user -> organization        | R36 D1, R41, R50      | (b) partly: auth-sync-workspace attempt 2 is ready after DS-2d and covers `ensurePersonalWorkspace`. Avatar gap, see Q5     | U1    |
| user -> project             | R36 D1, R40           | (b) no lane                                                                                                                 | U1    |
| licensing -> instant-eval   | R8, Q9                | (b) no lane. Q2                                                                                                             | C3a   |
| licensing -> gateway        | Q9 ("no peers"), R36  | (b) no lane. Q2 and Q3                                                                                                      | C3b   |
| licensing -> organization   | Q9, R37 D6, R42       | (b) licence-ownership moved the licence table. The rest has no lane. Q1 and Q4                                              | C3c   |

## 3. Lanes, ranked

"Alone" counts the findings that clear if only that lane lands. "Blocks" counts the findings left if every other lane lands and this one does not. The component is densely tangled, so most findings clear only near the end. "Blocks" is the better guide to which lane gates zero. The rank orders by blocks, then by how many lanes depend on it.

| Rank | Lane        | Edges removed                                                               | Alone | Blocks | Needs Alex           | Can start                             |
| ---- | ----------- | --------------------------------------------------------------------------- | ----- | ------ | -------------------- | ------------------------------------- |
| 1    | C3a         | licensing -> instant-eval (and 8 of the 15 licensing -> gateway ops)        | 1     | 80     | **Q2**               | after Q2                              |
| 2    | C3b         | licensing -> gateway (managed keys, Connect upstream)                       | 1     | 72     | **Q3**               | after C3a and Q3                      |
| 3    | L1          | audit-log -> agent, annotation, dataset, monitor, project, prompt, workflow | 23    | 50     | no                   | now (grant audit-log process paths)   |
| 4    | A1-user     | user -> auth                                                                | 2     | 20     | no (round 48)        | after DS-2d                           |
| 5    | T2b         | project -> trace                                                            | 1     | 18     | no (R36)             | now                                   |
| 6    | A1-identity | identity -> auth                                                            | 1     | 16     | no (round 48)        | after DS-2d                           |
| 7    | C3c         | licensing -> organization                                                   | 1     | 12     | **Q1, Q4**           | after Q1 and Q4                       |
| 8    | U1          | user -> organization, user -> project, organization -> user                 | 3     | 11     | **Q5** (avatar only) | after A1-user and auth-sync-workspace |
| 9    | T2a         | trace -> instant-eval                                                       | 1     | 9      | no                   | active                                |
| 10   | C2          | billing -> organization                                                     | 1     | 9      | no                   | active                                |
| 11   | O1          | organization -> project, organization -> api-key                            | 2     | 8      | no                   | after U1 (shared sign-up files)       |
| 12   | C1          | entitlement -> organization                                                 | 1     | 8      | **Q1**               | after Q1 (same answer as C3c's seats) |
| 13   | T1          | trace -> evaluation                                                         | 1     | 4      | no                   | now                                   |

**Projected trajectory** if the lanes land in a workable order (running lanes first, ruled lanes next, lanes held for a ruling last): T2a 134, C2 133, L1 110, A1-identity 109, A1-user 95, T1 94, T2b 93, O1 91, U1 83, C3a 74, C3c 73, C1 72, **C3b 0**. Even with everything else done, `licensing -> gateway` alone keeps 72 findings, because gateway reaches entitlement through the middle layers and `entitlement -> licensing` is kept. That is why Q2 and Q3 decide when the count reaches zero.

## 4. The lanes

Each lane lists the paths it owns, the work, and the edges it removes. Shared files serialise as in the layering plan's §5: contract `index.ts`, `apps/worker` installation tests, the peer-cycles and table-ownership policy files.

### L1 audit-log answers touches only (R6, BC-2): 7 edges

- **Owns.** `modules/audit-log/process/src/{services,rules,app,transport,tasks}/**`, `modules/audit-log/specs/**`, `modules/audit-log/process/package.json`, and in `modules/agent/contract` the removal of `findIdsCreatedInWindow` if no other caller remains.
- **Work.** Follow recent-items-browser handoff §9 steps 1 to 7 (the browser half has landed): the recent-items service maps touches to `{ id, type, updatedAt }`, `deriveRecentItemHref` is deleted, five owner peers go, and the two home-strip scenarios are reworded. Then retire the agent audit-id repair task (R6): `services/agent-audit-log-ids.service.ts`, `tasks/agent-audit-log-ids.task.ts` and `agents: AgentApi` (audit-log.app.ts:50).
- **Ruling.** None needed. The 200-row dataset cap was answered in round 37 (a dataset by-ids procedure).

### T2b field redaction door moves to trace (R36): project -> trace

- **Owns.** `modules/project/process/src/{app,transport}`, `modules/trace/process/src/transport`, `modules/trace/contract/src` (the procedure declaration), and the browser caller of `project.getFieldRedactionStatus`.
- **Work.** `project.getFieldRedactionStatus` (project.trpc.ts:168) becomes `traces.getFieldRedactionStatus`, served from `resolveViewerProtections`. Delete `ProjectApp.getFieldProtections` and `trace: TraceApi` (project.app.ts:102). Record the path move as a UI-internal wire difference (CD-2 and ID-1 precedent).
- **Ruling.** None needed: R36 accepted the plan's new cuts.

### T1 trace drops EvaluationApi (PC-3, R38, R40): trace -> evaluation

- **Owns.** `modules/trace/process/src/{app,services,repositories,eventing}`, `modules/evaluation/process/src/eventing` (the subscriber), and `modules/evaluation/contract/src` (the rule export and the fact schema).
- **Work.**
  - `readEvaluationRuns` (trace.app.ts:3119) and `findSummariesByTraceIds` (trace-list-read.service.ts:214) read `evaluation_runs` through trace's own repository. The share is already declared in `clickhouse-table-ownership.ts:170`, with readers analytics and trace.
  - The collector's `reportEvaluation` (trace.app.ts:3394) records the "evaluations received" fact that evaluation peer-subscribes to (round 38 coordinator call).
  - `deriveEvaluatorId` (trace.app.ts:3401) becomes a pure rule that evaluation-contract exports. This follows the CI-1 precedent, where a contract exports a rule, so it is a coordinator call.
- **Ruling.** None needed. Jobs queued at deploy follow E4 lane aliases (round 49).

### A1-identity and A1-user (round 48): identity -> auth, user -> auth

These lanes are already manifested. They are listed here only for the ranking. Run A1-user first: it blocks 20 findings, against 16 for A1-identity, and U1 depends on it.

### U1 user leaves organization and project (R36 D1, R40, R50): 3 edges

- **Owns.** `modules/user/process/src/**`, `modules/auth/process/src/services` (the sign-up path), `modules/organization/process/src/services/sign-up-policy.service.ts`, and the `UserApi` and `OrganizationApi` contract operations it retires.
- **Work.**
  - Auth composes the sign-up verdict. It asks `UserApi.hasAnyAccount` and passes the answer into `OrganizationApi.checkSignUp`, which removes organization -> user (sign-up-policy.service.ts:78). User's register door takes the verdict from auth (user.app.ts:466).
  - The R50 personal-workspace work comes from auth-sync-workspace attempt 2 (`UserApi.ensurePersonalWorkspace` is deleted).
  - `UserApi.findPersonalWorkspace` (user-account.service.ts:90) is a pass-through. Its callers repoint to `OrganizationApi.getPersonalWorkspace`.
  - `#requireProject` (user.app.ts:1018) reads `Project` through a declared share, with user as a reader (R40).
  - The avatar door needs Q5.
- **Ruling.** Q5 only.

### O1 organization stops calling project and api-key (R2, R3, R40): 2 edges

- **Owns.** `modules/organization/process/src/**`, `modules/onboarding/process/src/{app,transport}`, `modules/api-key/process/src/transport`, and organization-contract's retired operations.
- **Work.**
  - `findById` in organization-group-scope.service.ts:57 and `listIdsByOrganization` in organization.app.ts:753 read `Project` through the share (add organization as a reader).
  - The `OrganizationApi` pass-throughs `findById`, `listByOrganization` and `listByTeam` (organization.app.ts:1500, 1511, 2011) retire, and their callers repoint to `ProjectApi`.
  - The first-project ceremony (organization-ceremony.service.ts:35, through `initializeOrganization` / `createAndAssign`) moves to onboarding, which already holds `OrganizationApi` and `ProjectApi`. It creates the organisation first, then the project (R2, "above both"). The path change is UI-internal.
  - `createForProvisioningWithAdminKey` (organizations.rest.ts:41, app :851) is served by api-key under an R10 shared path, with the path unchanged (R3).
- **Ruling.** None needed. Putting the ceremony in onboarding is a coordinator reading of R2.

### C3a hosted Connect family leaves licensing (R8): licensing -> instant-eval and most of licensing -> gateway

- **Owns.** `enterprise/modules/licensing/process/src/{transport/connect-hosted.rest.ts,services/hosted-*.ts,services/contract-budget-store.service.ts,licensing.module.ts,app}`, and the receiving module's transport and services.
- **Work.**
  - The hosted family is three routes under `/api/internal/gateway/connect/`: classify, usage and budget. The data plane signs them with the gateway's own secret. Move the family out of licensing as Q2 decides.
  - This removes `classify`, `priceOf` and `recordSpendForHostedCalls` (licensing.app.ts:952-955), which is all of licensing -> instant-eval.
  - It also removes 8 of the 15 gateway operations: `internalDoor` (licensing.module.ts:24), `listBudgetsWithHealth`, `createBudget`, `updateBudget`, `resetBudget`, `findVirtualKeyById` and `resolveApplicableBudgets`.
- **Ruling.** **Q2.**

### C3b licence side effects become facts (Q9, R40): the rest of licensing -> gateway

- **Owns.** `enterprise/modules/licensing/process/src/{services/connect-credential.service.ts,services/license-sync.service.ts,services/license-registry.service.ts,services/connect-install.service.ts,eventing,app}`, `modules/gateway/process/src/eventing` (the peer subscriber), and licensing-contract (the fact schemas).
- **Work.**
  - These calls become licensing facts that gateway peer-subscribes to: `revokeManagedInternal`, `invalidateManagedInternal`, `setManagedKeyConnectServicesInternal` and `setManagedKeyLicenseInternal` (licensing.app.ts:908-911), and `setConnectUpstreamInternal` and `clearConnectUpstreamInternal` (:1037-1038).
  - `provisionConnectManagedKey` (connect-credential.service.ts:144) needs the key id back synchronously, so it waits for Q3.
- **Ruling.** **Q3.**

### C3c licensing leaves organization (Q9, R37 D6, R40, R42): licensing -> organization

- **Owns.** `enterprise/modules/licensing/process/src/{services,app}`, `modules/organization/process/src/eventing` (the peer subscriber), and the table-ownership policy entry for the `Organization` share.
- **Work.**
  - `findProvisioningSummary` (licensing.app.ts:964, license-mint.service.ts:53) and `listAllIds` (domain-claim-authority.service.ts:32) read `Organization` through the share, with licensing as a reader (R40, R52 paging).
  - `markSelfHostedCustomer` becomes a licensing fact that organization applies (R42 shape).
  - `setLicense` and `clearLicense` (organization-license-writer.service.ts:34-39) stop once organization reads the licence through `LicensingApi` (licence-ownership §12 item 2). Dual-writing then ends. Coordinator default: stop it in the same commit, because the reconciling copy step keeps `needsOldWritersGone`.
  - `countMemberSeats` (licensing.app.ts:128-130) waits for Q1.
  - `createSelfHostedCustomer` waits for Q4.
- **Ruling.** **Q1, Q4.**

### C1 entitlement's last organization read: entitlement -> organization

- **Owns.** `modules/entitlement/process/src/{app,services,repositories}`.
- **Work.** Only the `countMemberSeats` pick is left. It gets the same answer as C3c (Q1), so run C1 and C3c's seat half as one slice.
- **Ruling.** **Q1** (round 44 q9, R-C1f).

## 5. Questions for Alex

- **Q1 (R-C1f, round 44 q9, restated). Seat counts below organization.**
  - **Background.** Entitlement (L3) and licensing (L1) both ask `OrganizationApi.countMemberSeats`. Organization classifies members over its own `OrganizationUser` and `OrganizationInvite` rows, `User.deactivatedAt`, `RoleBinding` and `CustomRole` (prisma.organization-seat.repository.ts). Option (a) of q9 assumed entitlement sits above organization. The ruled layering puts it below (L3 under L5), so (a) no longer applies.
  - **Options.**
    - **(a, recommended).** Organization-contract exports the pure seat-classification rule (`isFullMember`, `isLiteMember`, developer), as CI-1 lets a contract export a rule. Entitlement and licensing read the five tables through declared Postgres shares (R40) and apply the rule. This adds four share entries and no new `*Api` operation.
    - **(b).** A new `AuthzApi` read for seat counts. Authz already reads `OrganizationUser` through a share and owns role bindings. It needs one new operation and the `User` and `OrganizationInvite` shares.
    - **(c).** Keep `entitlement -> organization` and `licensing -> organization` as named exceptions. This is against round 29 ("one exception").
- **Q2 (C3a). Where the hosted Connect family goes.**
  - **Background.** R8 moves hosted judging to instant-eval. The family also answers usage and the budget cap over gateway's budgets, behind the gateway's internal secret. Gateway (L16) cannot call instant-eval (L17).
  - **Options.**
    - **(a, recommended).** The whole family moves to instant-eval. Instant-eval already calls gateway and licensing (kept), and binds the gateway's `internal_secret` through `GatewayApi.internalDoor`. The paths are unchanged under an R10 shared-path declaration, with gateway as the path owner. The lane needs no new operation if licensing's caller resolution is already a `LicensingApi` read. If it is not, one new `LicensingApi` read resolves the hosted caller.
    - **(b).** Split by subject. Classify goes to instant-eval. Usage and the budget cap go to gateway, which calls `LicensingApi` down for contract terms. This puts each route with its owner, but caller resolution is needed in two modules.
- **Q3 (C3b). Provisioning a Connect managed key.**
  - **Background.** `connect-credential.service.ts:144` provisions a gateway virtual key and attaches its id to the issued licence in the same request. As a fact, the id arrives later.
  - **Options.**
    - **(a, recommended).** Licensing records `connect_credential_issued` and gateway provisions the key from it. Licensing stores the key id from gateway's `managed_key_provisioned` fact, through a licensing peer subscriber. The instance picks the key up on its next sync, so issuing a credential becomes eventual (seconds).
    - **(b).** The credential-issue door moves to gateway. Gateway provisions, then calls `LicensingApi` down to attach. This stays synchronous, but the door leaves licensing's subject.
    - **(c).** Keep only `provisionConnectManagedKey` behind an Api-bound channel that the process fills from `GatewayApi` (round 34). This is synchronous and adds no peer edge, but it bends "licensing ends with no peers" (Q9).
- **Q4 (C3c). Creating a self-hosted customer's organisation.**
  - **Background.** `license-registry.service.ts:388` and licensing.app.ts:897 create an organisation row and use its id at once.
  - **Options.**
    - **(a, recommended).** Licensing mints the organisation id and records `self_hosted_customer_requested { organizationId, name }`. Organization creates the row with that id (R42 shape, eventual).
    - **(b).** The operator door composes above both. Ops (L22) calls `OrganizationApi.createSelfHostedCustomer`, then `LicensingApi`.
- **Q5 (U1). Avatar storage after R50.**
  - **Background.** `UserService.setAvatar` (user.service.ts:426) calls `OrganizationApi.ensurePersonalWorkspace` to get a project to store the image under. R50 deleted `UserApi.ensurePersonalWorkspace` but did not name this path.
  - **Options.**
    - **(a, recommended).** setAvatar reads the caller's existing personal workspace project through the `Team` and `Project` shares, with user as a reader. R50 guarantees the workspace for every membership. It refuses if none exists.
    - **(b).** The avatar door moves to organization. Organization ensures the workspace, stores the image, and writes the image URL through a `UserApi` write.
    - **(c).** Avatars stop living in a project and are keyed by user in stored-object. This is a storage change and needs a data step.

## 6. Coordinator calls in this plan (no Alex needed)

- T1: `deriveEvaluatorId` becomes an evaluation-contract rule export (CI-1 precedent).
- O1: the first-project ceremony moves to onboarding (R2 "above both"). The `OrganizationApi` project pass-throughs retire, and their callers use `ProjectApi`.
- T2b: `project.getFieldRedactionStatus` moves to `traces.*` (namespace moves with its owner, CD-2).
- C3c: licensing stops dual-writing the licence in the commit where organization reads it through `LicensingApi`. This settles licence-ownership R4.
- Share additions:
  - `Project`: organization and user as readers.
  - `Organization`: licensing as a reader.
  - Q1's four seat tables, if (a) is chosen.

## 7. Reproducing

1. Run the policy command in §1.
2. Dump `peerEdges` and `peerCycleEdges` from the policy module over `discoverClassifiedPackages(root)` (`packages/architecture-enforcer/src/workspace/snapshot.ts:607`).
3. Recount findings with each lane's edges removed. A finding is an edge whose target reaches back; for the excepted pair, only a path other than the direct back edge counts.

The lane's scripts were scratch files and are not in the tree. Re-run after C2 and T2a commit.
