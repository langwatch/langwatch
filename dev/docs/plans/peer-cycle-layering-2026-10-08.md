# Peer-cycle layering, re-derived from the 2026-10-08 graph

Date: 2026-10-08. Ruling: round 30 PC-2 ("re-derive the layering from today's graph ... the new layering replaces the plan's design order as the target", `.claude/coordinator/rulings-2026-10-07.md`). Rules: ARCHITECTURE.md §5 (peer cycles; cut from the reactor's side). Replaces the target order in `peer-cycle-cuts-2026-10-06.md` §2; the cut patterns (i) to (iv) are that plan's §3 and are not restated. **No cut lands without Alex's ruling (§5, 2026-10-05);** the 26 ruled cuts below already have one, the 6 new cuts do not.

## 1. The graph today

- **Command.** `pnpm lint:architecture --policies peer-cycles --all`, run twice by this lane. At the start: 159 findings. At 11:29 UTC: **145 findings**, `architecture-enforcer: 145 findings across 1 policy, exit 1`. The tree moved between the two runs because other lanes landed (experiment left the component; `workflow -> experiment` is gone).
- **Edges.** 382 declared peer edges between 60 modules, read with the policy's own `peerEdges` (`packages/architecture-enforcer/src/policies/boundaries/peer-cycles.ts:232`), so the edge set is exactly what the gate counts.
- **Component.** One strongly connected component of 30 modules holds all 145 findings: agent, analytics, annotation, api-key, audit-log, auth, billing, data-privacy, data-retention, dataset, entitlement, evaluation, evaluator, feature-flag, gateway, identity, instant-eval, licensing, model-provider, monitor, organization, project, prompt, role, scim, share, sso, trace, user, workflow.

## 2. Method

**Weights: the work to cut an edge.** For each edge A -> B, every call in A's process source (tests excluded) on a receiver bound to B's `*Api` token, with the op in B's `*Api` interface; `Pick<BApi, ...>` members count once where no call was seen. Each call site is weighted by kind:

| Kind    | Where                                           | Weight | Usual pattern                  |
| ------- | ----------------------------------------------- | ------ | ------------------------------ |
| door    | the call sits in `transport/`                   | 1      | (ii) the door moves            |
| command | any other site, op not a read verb              | 2      | (i) fact plus peer subscriber  |
| read    | op starts get, find, list, count, is, resolve.. | 3      | (iii) fold, table and backfill |

This is a regex heuristic over receiver names, not a type-checked count. One edge needed a hand weight: `entitlement -> licensing` (plan source passed whole to `entitlement.service.ts:38`), set to 3. It is a kept edge, so the value does not change the result.

**Rulings applied before solving.**

- **Excepted pair.** organization <-> identity is contracted into one node, `org+identity` (round 29 PC-1: "the one named, linted exception in the peer-cycles policy").
- **Ruled cuts (forced, 26 present today).** Listed with their source in §4. Ten more ruled cuts have already landed: `workflow -> experiment`, `project -> api-key`, `data-privacy -> project`, `data-privacy -> evaluation`, `entitlement -> trace`, `entitlement -> user`, `licensing -> project`, `billing -> entitlement`, `licensing -> entitlement`, `organization -> audit-log`.
- **Kept (never cut).** `gateway -> evaluation` (2026-10-01), `project -> data-privacy` (2026-09-30), `auth -> sso` (2026-09-25), `auth -> identity` and `auth -> user` (better-auth hooks; round 21), `identity -> scim` (SSO sees a deactivation at once), `instant-eval -> licensing` (2026-09-30), `workflow -> agent` (round 16 D1), `experiment -> trace` (SR-5), `entitlement -> billing`, `entitlement -> licensing` (2026-10-06 late evening: entitlement calls both) and `billing -> licensing` (2026-10-06 night Q7).

**Solver.** An exact minimum weighted feedback arc set: a 0/1 programme over linear orderings of the component (one variable per module pair, transitivity constraints), solved by HiGHS through scipy. HiGHS reports the result **optimal**, so this is the minimum under these weights, not a heuristic floor. The unweighted programme (every edge costs 1) picks the same six edges.

**Check.** With the 32 cuts removed from today's 382 edges, the only edges whose target reaches back are `organization -> identity` and `identity -> organization`: the gate reads 2 until the named exception of round 29 PC-1 lands in the policy, then 0.

## 3. The new layer order

Lowest first. A module may call only modules in lower layers (depth = longest path to a module with no peers, after the cuts). Modules outside the old component are included so the order is complete.

| Layer | Modules                                                                        |
| ----- | ------------------------------------------------------------------------------ |
| L0    | audit-log, authz, instant-eval-judge, managed-provider, notification, presence |
| L1    | licensing, secret, stored-object                                               |
| L2    | billing, user                                                                  |
| L3    | entitlement, nurturing                                                         |
| L4    | role, scim                                                                     |
| L5    | organization + identity (the excepted pair)                                    |
| L6    | data-retention, demo-data, feature-flag                                        |
| L7    | data-privacy, sso                                                              |
| L8    | project                                                                        |
| L9    | agent, api-key, dataset, model-provider, share, slack                          |
| L10   | auth, workflow                                                                 |
| L11   | evaluator, github, prompt                                                      |
| L12   | monitor                                                                        |
| L13   | trace                                                                          |
| L14   | analytics, annotation, log, metric                                             |
| L15   | evaluation                                                                     |
| L16   | experiment, gateway, topic                                                     |
| L17   | enterprise-gateway, instant-eval, scenario, webhook                            |
| L18   | automation, governance, suite                                                  |
| L19   | coding-agent, dashboard, hosted-mcp                                            |
| L20   | onboarding                                                                     |
| L21   | langy                                                                          |
| L22   | ops, platform-health                                                           |
| L23   | enterprise-ops, saas                                                           |

Inside the remaining component the solver's order is: user < scim < org+identity < feature-flag < data-privacy < project < data-retention < share < model-provider < dataset < api-key < agent < workflow < evaluator < monitor < trace < analytics < evaluation < gateway < instant-eval.

**Against the 2026-10-06 design order:**

- The commercial modules sit at the bottom (licensing L1, billing L2, entitlement L3), not mid-stack: the 2026-10-06 night rulings (Q7, Q9, entitlement calls billing and licensing) leave them only downward edges.
- audit-log sits at L0 once R6 lands: it answers touches only and calls no owner.
- user sits **below** organization and project (the design order had organization and project below user). This is what makes `user -> organization` and `user -> project` new cuts; see decision D1.
- auth sits at L10, above organization, identity, user and sso, as R1 implies.
- trace sits below instant-eval, so the `traces.instantEval.*` door leaves trace (the design order already moved it, B3 T).

## 4. The cut set: 32 edges, weight 431

Ruled cuts (26, weight 384) carry their ruling; new cuts (6, weight 47) are what the re-derivation adds and need Alex's ruling. "Lane" refers to §5.

| Edge                        | Ruling        | Sites | Weight | Pattern                                                               | Lane |
| --------------------------- | ------------- | ----- | ------ | --------------------------------------------------------------------- | ---- |
| identity -> auth            | R1            | 22    | 60     | (ii) session and account doors move to auth; (iv) capability booleans | A1   |
| user -> auth                | R1            | 23    | 57     | (ii) and (iv), as above                                               | A1   |
| billing -> organization     | Q9            | 16    | 42     | (i) and (iii): billing learns by facts or is passed the data          | C2   |
| licensing -> gateway        | Q9            | 15    | 34     | (i): licensing records facts; gateway peer-subscribes                 | C3   |
| licensing -> organization   | Q9            | 14    | 33     | (i) and (iii), as above                                               | C3   |
| trace -> evaluation         | round 30 PC-3 | 9     | 24     | (iii) fold of evaluation facts; (i) queueing and reporting move       | T1   |
| entitlement -> organization | Q9            | 6     | 18     | (ii) `AuthzApi.getScope`; (iii) fold `lw.organization.signed_up`      | C1   |
| organization -> project     | R2            | 6     | 17     | (ii) ceremony moves above both; listings to project or the browser    | O1   |
| billing -> gateway          | Q9            | 6     | 15     | (iii) fold gateway spend facts                                        | C2   |
| entitlement -> project      | Q9            | 5     | 15     | (iii) fold `lw.project.*`                                             | C1   |
| audit-log -> agent          | R6            | 4     | 9      | repair task retires (R6); round 6 parked it                           | L1   |
| licensing -> instant-eval   | R8            | 3     | 8      | (ii) hosted judging moves to instant-eval                             | C3   |
| analytics -> instant-eval   | round 29 PC-1 | 2     | 6      | judge channel filled by the process (Codex handle precedent)          | X1   |
| audit-log -> project        | R6            | 2     | 6      | (ii) browser composes recent items                                    | L1   |
| audit-log -> prompt         | R6            | 2     | 6      | (ii), as above                                                        | L1   |
| billing -> data-retention   | Q9            | 2     | 5      | (i) billing fact; data-retention peer-subscribes                      | C2   |
| billing -> audit-log        | Q9            | 2     | 4      | (i) audit-log reacts (organization audit-producer precedent)          | C2   |
| audit-log -> annotation     | R6            | 1     | 3      | (ii) browser composes                                                 | L1   |
| audit-log -> dataset        | R6            | 1     | 3      | (ii) browser composes                                                 | L1   |
| audit-log -> monitor        | R6            | 1     | 3      | (ii) browser composes (monitor-client, round 31 CT-1)                 | L1   |
| audit-log -> workflow       | R6            | 1     | 3      | (ii) browser composes                                                 | L1   |
| billing -> project          | Q9            | 1     | 3      | (iii) or passed in                                                    | C2   |
| organization -> user        | round 21      | 1     | 3      | (ii) `UserApi.checkSignUp` composes the verdict                       | O1   |
| workflow -> monitor         | round 30 WF-1 | 1     | 3      | (ii) workflow browser reads monitor-client                            | W1   |
| agent -> workflow           | round 16 D1   | 1     | 2      | see D3: `executeComponent` remains                                    | W1   |
| organization -> api-key     | R3            | 1     | 2      | (ii) provisioning door moves to api-key                               | O1   |
| **trace -> instant-eval**   | new           | 8     | 22     | (ii) `traces.instantEval.*` and the search classifier move (B3 T)     | T2   |
| **user -> organization**    | new           | 4     | 10     | D1                                                                    | U1   |
| **scim -> organization**    | new           | 3     | 7      | D2                                                                    | S1   |
| **project -> trace**        | new           | 1     | 3      | (ii) `projects.getFieldProtections` moves to trace (B2 P, size S)     | T2   |
| **user -> project**         | new           | 1     | 3      | (ii) `AuthzApi.getScope` or the caller passes the project             | U1   |
| **agent -> trace**          | new           | 1     | 2      | D3                                                                    | W1   |

## 5. Lanes

Within a wave, lanes touch disjoint process modules. Contract `index.ts` exports, `apps/worker` installation tests and the peer-cycles policy file still serialise (as in the 2026-10-06 plan §5).

| Wave | Lane | Edges                                                                       | Modules                                         | Clears alone | In flight                                        |
| ---- | ---- | --------------------------------------------------------------------------- | ----------------------------------------------- | ------------ | ------------------------------------------------ |
| 1    | A1   | identity -> auth, user -> auth                                              | identity, user, auth                            | 16           | peer-b4-u (review) covers part of user           |
| 1    | C1   | entitlement -> organization, entitlement -> project                         | entitlement (+ organization, project facts)     | 2            | commercial-cycle-cuts (partial; D1 to D6 open)   |
| 1    | C2   | billing -> organization, gateway, data-retention, audit-log, project        | billing (+ gateway facts)                       | 5            | commercial-cycle-cuts                            |
| 1    | C3   | licensing -> gateway, organization, instant-eval                            | licensing, instant-eval                         | 9            | commercial-cycle-cuts; licensing-finish (review) |
| 1    | L1   | audit-log -> agent, annotation, dataset, monitor, project, prompt, workflow | audit-log (+ agent contract op removal)         | 24           | AL; agent edge parked in round 6                 |
| 1    | T1   | trace -> evaluation                                                         | trace, evaluation                               | 1            | PC-3 ruled; trace-peer-folds (review)            |
| 1    | W1   | agent -> workflow, agent -> trace, workflow -> monitor                      | agent, workflow, scenario if D3 (a)             | 3            | peer-b4-w                                        |
| 1    | S1   | scim -> organization                                                        | scim                                            | 1            | none                                             |
| 1    | X1   | analytics -> instant-eval                                                   | analytics, apps composition (shared)            | 1            | PC-1 ruled                                       |
| 2    | O1   | organization -> project, api-key, user                                      | organization, project, api-key                  | 3            | peer-b3-o-user (blocked), peer-b2-p (review)     |
| 2    | U1   | user -> organization, user -> project                                       | user (after A1)                                 | 2            | none                                             |
| 2    | T2   | trace -> instant-eval, project -> trace                                     | trace, instant-eval, project (after T1, C3, O1) | 2            | none                                             |

**Order inside a wave.** "Clears alone" is how many of today's 145 findings go if only that lane lands; the rest clear only together, because the component is densely tangled. Run L1 and A1 first, then C3. The commercial lanes' patterns wait on D1 to D6 in `.claude/handoffs/commercial-cycle-cuts.md`. Wave 2 waits for the wave 1 lane that holds the same module: O1 and U1 both touch user's or organization's sign-up path and run one after the other; T2 runs after T1 (trace), C3 (instant-eval) and O1 (project).

## 6. LIN-2: feature-flag -> organization and licensing -> gateway

- **`feature-flag -> organization`: not in the set. Do not cut it** (round 31 LIN-2: "cut only if the new cut set includes it"). feature-flag sits at L6, above organization at L5, so the edge points down. Solving again with the edge marked kept gives the same six new cuts at the same weight (47): it closes no cycle once the others go.
- **`licensing -> gateway`: in the set.** It is ruled already (2026-10-06 night Q9, "licensing ends with no peers"), and the solver chooses it on its own: freed from Q9 it is still cut (the optimum rises from 47 to 81 only by its own weight, 34); marked kept, the remainder grows from 7 cuts and weight 81 to 14 cuts (15 edges) and weight 106, because entitlement must move above organization, identity and trace. The cycle it closes is `licensing -> gateway -> organization -> entitlement -> licensing`. The 2026-10-06 plan dropped it as redundant because licensing then called entitlement; the late-evening ruling reversed that direction, which is why it is no longer redundant.

## 7. Decisions the new cuts raise

- **D1. `user -> organization` (and `user -> project`).** The optimum puts user at L2, below organization. That cuts `checkSignUp` (`user.app.ts:465`), which round 21 placed on UserApi calling organization's verdict, and `ensurePersonalWorkspace` / `getPersonalWorkspace`.
  - (a) As derived: the sign-up verdict is composed above both (auth already calls user and identity), and the personal workspace is ensured by organization, either called by the sign-up flow (ii) or reacting to user's `created` fact from round 32 (i). Weight 10 + 3.
  - (b) Runner-up, +15 (weight 62): keep `user -> organization` and `user -> project`; cut `identity -> user` (`hasPassword`, `findJoinOfferDismissedDomains`, `dismissJoinOffer`, `findById`) and `scim -> user` (`getProfiles`, `findById`, `findByEmail`, `create`) instead. This puts user above organization, identity, scim and project, and makes SCIM user provisioning eventual or moved.
  - Needed: whether the round 21 shape of `checkSignUp` binds the layer of user. (a) is the cheaper and keeps user a foundation.
- **D2. `scim -> organization` is forced by the exception.** With organization <-> identity excepted and `identity -> scim` kept, scim must not reach organization. The calls are the synchronous administrator guard `assertRemovalKeepsAnAdministrator` (deprovision and membership access) and `findProvisioningSummary` (oversight). Options: (a) the guard asks authz for administrator bindings (ii; scim already holds AuthzApi), the summary is folded or composed; (b) reverse the ruled `identity -> scim` (an SSO login would stop seeing a directory deactivation at once). Needed: whether authz can answer "this removal leaves an administrator" without organization.
- **D3. agent's HTTP test turn.** Both `agent -> trace` (`recordCapturedSpan`, `http-agent-test.service.ts:121`) and the remainder of the ruled `agent -> workflow` (`executeComponent`, `http-agent-test.service.ts:176`, an op round 16 D1 did not name) live in one service. (a) The HTTP agent test moves to scenario (ii, the 2026-10-06 S1 precedent; scenario already holds AgentApi, TraceApi and WorkflowApi), cutting both. (b) Keep `agent -> trace` and cut `trace -> evaluator` and `trace -> monitor` instead (+4 today). `trace -> monitor` is the on-message trigger subscriber, which PC-3 moves to evaluation, so after T1 lands (b) costs about +1: re-run this derivation after T1 before choosing.
- **D4. `traces.instantEval.*` leaves trace.** The 2026-10-05 coordinator ruling (L7 R1) declared the opt-in procedures as TraceApi operations forwarding to InstantEvalApi "with no new module edge"; that edge is now in the set. A namespace moves with its owner (round 31 ID-1, CD-2 as built), so the paths become `instantEval.*`: a UI-internal wire difference to record, as ID-1 did.

## 8. Sensitivity

Each row re-solves with one edge marked kept (or freed from its ruling) and reports the new minimum for the unruled remainder.

| Change                            | Cuts | Weight | What moves                                                                                                       |
| --------------------------------- | ---- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| none (the derivation)             | 6    | 47     |                                                                                                                  |
| keep feature-flag -> organization | 6    | 47     | nothing                                                                                                          |
| keep agent -> trace               | 7    | 51     | cut trace -> evaluator, trace -> monitor instead (D3)                                                            |
| keep user -> organization         | 6    | 62     | cut identity -> user, scim -> user instead (D1)                                                                  |
| keep user -> project              | 6    | 62     | same as the row above                                                                                            |
| keep trace -> instant-eval        | 8    | 60     | cut analytics -> trace (23), instant-eval -> trace, instant-eval -> gateway instead                              |
| keep project -> trace             | 10   | 119    | trace drops below project: cut trace -> project, model-provider, api-key, evaluator, monitor                     |
| keep scim -> organization         | n/a  | n/a    | infeasible without cutting the kept identity -> scim (D2)                                                        |
| free licensing -> gateway from Q9 | 7    | 81     | still cut: licensing -> gateway (34) joins the set                                                               |
| free it and keep it               | 14   | 106    | entitlement moves up; cut organization, identity, trace, dataset, scim, data-retention, analytics -> entitlement |

## 9. Reproducing

The lane's scripts were scratch files and are not in the tree. To repeat: dump `peerEdges` from the policy module, count call sites as in §2, contract organization and identity, drop the ruled cuts, give kept edges an infinite weight, and solve the ordering programme per strongly connected component. Re-run after T1 and the commercial lanes land: each landed cut removes edges and can change the six new cuts.

## Appendix: call sites of the 32 cuts

Line numbers as of 11:29 UTC on 2026-10-08; other lanes were editing the same files.

#### `analytics -> instant-eval`

- Declared: `modules/analytics/process/src/app/analytics.app.ts:332`. 2 call sites, weight 6.
- `getJudgeLimits`: `modules/analytics/process/src/services/langwatch-ql.service.ts:471`
- `judgeQuery`: `modules/analytics/process/src/services/langwatch-ql.service.ts:518`

#### `trace -> evaluation`

- Declared: `modules/trace/process/src/app/trace.app.ts:876`. 9 call sites, weight 24.
- `deriveEvaluatorId`: `modules/trace/process/src/eventing/trace-processing-runtime.pipeline.ts:182`; `modules/trace/process/src/app/trace.app.ts:3480`
- `findInputs`: `modules/trace/process/src/services/trace-legacy-read.service.ts:368`
- `findRunsByTraceId`: `modules/trace/process/src/app/trace.app.ts:3198`
- `findSummariesByTraceIds`: `modules/trace/process/src/services/trace-list-read.service.ts:214`
- `findTraceEvaluations`: `modules/trace/process/src/services/trace-legacy-read.service.ts:337`
- `queueTraceEvaluation`: `modules/trace/process/src/eventing/trace-processing-runtime.pipeline.ts:177`
- `reportEvaluation`: `modules/trace/process/src/eventing/trace-processing-runtime.pipeline.ts:181`; `modules/trace/process/src/app/trace.app.ts:3473`

#### `workflow -> monitor`

- Declared: `modules/workflow/process/src/app/workflow.app.ts:594`. 1 call sites, weight 3.
- `list`: `modules/workflow/process/src/services/workflow-linked-rows.service.ts:47`

#### `agent -> workflow`

- Declared: `modules/agent/process/src/app/agent.app.ts:130`. 1 call sites, weight 2.
- `executeComponent`: `modules/agent/process/src/services/http-agent-test.service.ts:176`

#### `organization -> user`

- Declared: `modules/organization/process/src/app/organization.app.ts:325`. 1 call sites, weight 3.
- `hasAnyAccount`: `modules/organization/process/src/services/sign-up-policy.service.ts:78`

#### `identity -> auth`

- Declared: `modules/identity/process/src/app/identity.app.ts:440`. 22 call sites, weight 60.
- `countLegacySsoAccess`: `modules/identity/process/src/app/identity.app.ts:340`
- `disableTwoStepVerification`: `modules/identity/process/src/services/two-step-account.service.ts:67`
- `endBrowserSessionsForIdentifier`: `modules/identity/process/src/services/identity-lookup.service.ts:267`
- `findAssertedAmrForIdentifiers`: `modules/identity/process/src/services/organization-mfa.service.ts:193`
- `findDialableIdentityProviderOrigins`: `modules/identity/process/src/app/identity.app.ts:593`
- `findFederatedAccountProviders`: `modules/identity/process/src/app/identity.app.ts:296`
- `findMountedSocialMethodIds`: `modules/identity/process/src/app/identity.app.ts:539`
- `findSessionAmr`: `modules/identity/process/src/services/organization-mfa.service.ts:67`
- `issuesOwnPasswords`: `modules/identity/process/src/app/identity.app.ts:537`
- `linkProviderAccount`: `modules/identity/process/src/services/link-proposal.service.ts:57`
- `listBrowserSessions`: `modules/identity/process/src/services/account-identifiers.service.ts:261`; `modules/identity/process/src/services/identity-lookup.service.ts:372`
- `offersPasskeys`: `modules/identity/process/src/app/identity.app.ts:536`
- `offersTwoStepVerification`: `modules/identity/process/src/services/two-step-account.service.ts:29`; `modules/identity/process/src/services/organization-mfa.service.ts:59,116,134`
- `resolveAuthProvider`: `modules/identity/process/src/app/identity.app.ts:534,753`
- `retireLegacySsoAccess`: `modules/identity/process/src/app/identity.app.ts:341`
- `revokeAllBrowserSessions`: `modules/identity/process/src/services/identity-lookup.service.ts:264`
- `route`: `modules/identity/process/src/services/identity-lookup.service.ts:98`

#### `user -> auth`

- Declared: `modules/user/process/src/app/user.app.ts:182`. 23 call sites, weight 57.
- `assertSignUpOrigin`: `modules/user/process/src/app/user.app.ts:431`
- `changeFederatedPassword`: `modules/user/process/src/app/user.app.ts:999`
- `claimSignUpAddressProof`: `modules/user/process/src/app/user.app.ts:500`
- `claimUnconfirmedSignUpAddressProof`: `modules/user/process/src/app/user.app.ts:501`
- `endBrowserSession`: `modules/user/process/src/services/user-account.service.ts:75`
- `getSignedInWith`: `modules/user/process/src/app/user.app.ts:639`
- `getSsoSetupStatus`: `modules/user/process/src/services/user.service.ts:316`
- `issuesOwnPasswords`: `modules/user/process/src/app/user.app.ts:450,539,580`
- `listBrowserSessions`: `modules/user/process/src/services/user-account.service.ts:54`
- `offersPasskeys`: `modules/user/process/src/app/user.app.ts:205`
- `offersTwoStepVerification`: `modules/user/process/src/app/user.app.ts:643`
- `resolveAuthProvider`: `modules/user/process/src/app/user.app.ts:448,537,574`
- `revokeAllBrowserSessions`: `modules/user/process/src/services/user.service.ts:177,292,388`; `modules/user/process/src/services/user-account.service.ts:83`
- `revokeCliTokens`: `modules/user/process/src/services/user.service.ts:389`
- `revokeOtherBrowserSessions`: `modules/user/process/src/services/user-account.service.ts:79`
- `route`: `modules/user/process/src/app/user.app.ts:620`

#### `organization -> project`

- Declared: `modules/organization/process/src/app/organization.app.ts:323`. 6 call sites, weight 17.
- `create`: `modules/organization/process/src/services/organization-ceremony.service.ts:35`
- `findById`: `modules/organization/process/src/services/organization-group-scope.service.ts:57`; `modules/organization/process/src/app/organization.app.ts:1495`
- `listByOrganization`: `modules/organization/process/src/app/organization.app.ts:1506`
- `listByTeam`: `modules/organization/process/src/app/organization.app.ts:2007`
- `listIdsByOrganization`: `modules/organization/process/src/app/organization.app.ts:748`

#### `organization -> api-key`

- Declared: `modules/organization/process/src/app/organization.app.ts:326`. 1 call sites, weight 2.
- `create`: `modules/organization/process/src/app/organization.app.ts:846`

#### `audit-log -> agent`

- Declared: `modules/audit-log/process/src/app/audit-log.app.ts:50`. 4 call sites, weight 9.
- `create`: `modules/audit-log/process/src/services/agent-audit-log-ids.service.ts:14,26`; `modules/audit-log/process/src/tasks/agent-audit-log-ids.task.ts:19`
- `findIdsCreatedInWindow`: `modules/audit-log/process/src/services/agent-audit-log-ids.service.ts:90`

#### `audit-log -> annotation`

- Declared: `modules/audit-log/process/src/app/audit-log.app.ts:49`. 1 call sites, weight 3.
- `getQueue`: `modules/audit-log/process/src/services/recent-items.service.ts:153`

#### `audit-log -> dataset`

- Declared: `modules/audit-log/process/src/app/audit-log.app.ts:47`. 1 call sites, weight 3.
- `getByIds`: `modules/audit-log/process/src/services/recent-items.service.ts:108`

#### `audit-log -> monitor`

- Declared: `modules/audit-log/process/src/app/audit-log.app.ts:48`. 1 call sites, weight 3.
- `getAllByIds`: `modules/audit-log/process/src/services/recent-items.service.ts:115`

#### `audit-log -> project`

- Declared: `modules/audit-log/process/src/app/audit-log.app.ts:44`. 2 call sites, weight 6.
- `findOrganizationId`: `modules/audit-log/process/src/services/recent-items.service.ts:129`
- `findSummaryById`: `modules/audit-log/process/src/services/recent-items.service.ts:68`

#### `audit-log -> prompt`

- Declared: `modules/audit-log/process/src/app/audit-log.app.ts:45`. 2 call sites, weight 6.
- `getExistingIds`: `modules/audit-log/process/src/services/recent-items.service.ts:133`
- `getNamesByIds`: `modules/audit-log/process/src/services/recent-items.service.ts:136`

#### `audit-log -> workflow`

- Declared: `modules/audit-log/process/src/app/audit-log.app.ts:46`. 1 call sites, weight 3.
- `getById`: `modules/audit-log/process/src/services/recent-items.service.ts:143`

#### `licensing -> instant-eval`

- Declared: `enterprise/modules/licensing/process/src/app/licensing.app.ts:170`. 3 call sites, weight 8.
- `classify`: `enterprise/modules/licensing/process/src/app/licensing.app.ts:952`
- `priceOf`: `enterprise/modules/licensing/process/src/app/licensing.app.ts:953`
- `recordSpendForHostedCalls`: `enterprise/modules/licensing/process/src/app/licensing.app.ts:955`

#### `entitlement -> organization`

- Declared: `modules/entitlement/process/src/app/entitlement.app.ts:142`. 6 call sites, weight 18.
- `countMemberSeats`: `modules/entitlement/process/src/services/usage-stats.service.ts:151`
- `findAllIds`: `modules/entitlement/process/src/services/usage-warning.service.ts:49`
- `getDatasetLimits`: `modules/entitlement/process/src/app/entitlement.app.ts:287`
- `getOrganizationIdByTeamId`: `modules/entitlement/process/src/services/usage-enforcement.service.ts:245,269`
- `getPricing`: `modules/entitlement/process/src/app/entitlement.app.ts:317`

#### `entitlement -> project`

- Declared: `modules/entitlement/process/src/app/entitlement.app.ts:143`. 5 call sites, weight 15.
- `findOrganizationId`: `modules/entitlement/process/src/eventing/usage-meter-count.subscriber.ts:33`; `modules/entitlement/process/src/services/trace-meter-append.service.ts:34`; `modules/entitlement/process/src/services/billable-events-meter-append.service.ts:34`
- `listIdsByOrganization`: `modules/entitlement/process/src/services/usage-enforcement.service.ts:246`; `modules/entitlement/process/src/services/usage-warning.service.ts:40`

#### `billing -> audit-log`

- Declared: `enterprise/modules/billing/process/src/app/billing.app.ts:203`. 2 call sites, weight 4.
- `record`: `enterprise/modules/billing/process/src/app/billing.app.ts:1028,1048`

#### `billing -> data-retention`

- Declared: `enterprise/modules/billing/process/src/app/billing.app.ts:209`. 2 call sites, weight 5.
- `listOrganizationRules`: `enterprise/modules/billing/process/src/services/billing-subscription-lifecycle.service.ts:433`
- `setForScope`: `enterprise/modules/billing/process/src/services/billing-subscription-lifecycle.service.ts:459`

#### `billing -> gateway`

- Declared: `enterprise/modules/billing/process/src/app/billing.app.ts:201`. 6 call sites, weight 15.
- `isSpendSourceAvailable`: `enterprise/modules/billing/process/src/services/connected-usage-ceiling.service.ts:44`; `enterprise/modules/billing/process/src/services/connected-customer-facts.service.ts:71`; `enterprise/modules/billing/process/src/app/billing.app.ts:882`
- `sumSpendNanoUsdByRequestType`: `enterprise/modules/billing/process/src/services/connected-usage-ceiling.service.ts:45`; `enterprise/modules/billing/process/src/services/connected-customer-facts.service.ts:77`; `enterprise/modules/billing/process/src/app/billing.app.ts:884`

#### `billing -> organization`

- Declared: `enterprise/modules/billing/process/src/app/billing.app.ts:199`. 16 call sites, weight 42.
- `approvePaymentPendingInvites`: `enterprise/modules/billing/process/src/services/billing-checkout-completion.service.ts:199`
- `cancelPaymentPendingInvites`: `enterprise/modules/billing/process/src/services/seat-event-subscription.service.ts:307`
- `checkInvitesWithinCaller`: `enterprise/modules/billing/process/src/services/seat-event-subscription.service.ts:210`
- `claimBillingCustomerId`: `enterprise/modules/billing/process/src/services/customer.service.ts:57`
- `clearLicense`: `enterprise/modules/billing/process/src/services/billing-subscription-lifecycle.service.ts:485`
- `createPaymentPendingInvites`: `enterprise/modules/billing/process/src/services/seat-event-subscription.service.ts:333`
- `findAllIds`: `enterprise/modules/billing/process/src/tasks/usage-billing-catch-up.task.ts:39`
- `findSelfHostedCustomers`: `enterprise/modules/billing/process/src/services/connected-customer-facts.service.ts:54`
- `getAllMembers`: `enterprise/modules/billing/process/src/services/billing-lifecycle-announcer.service.ts:81,199`
- `getBillingProfile`: `enterprise/modules/billing/process/src/services/customer.service.ts:40,84`
- `getWithAdministrators`: `enterprise/modules/billing/process/src/services/usage-limit-organization.service.ts:23`
- `listProjectsByOrganization`: `enterprise/modules/billing/process/src/services/connected-customer-facts.service.ts:136`
- `updateSentPlanLimitAlert`: `enterprise/modules/billing/process/src/services/usage-limit-organization.service.ts:41`; `enterprise/modules/billing/process/src/services/plan-limit-alert.service.ts:85`

#### `billing -> project`

- Declared: `enterprise/modules/billing/process/src/app/billing.app.ts:207`. 1 call sites, weight 3.
- `findProjectsWithDepartments`: `enterprise/modules/billing/process/src/services/usage-limit-organization.service.ts:46`

#### `licensing -> gateway`

- Declared: `enterprise/modules/licensing/process/src/app/licensing.app.ts:166`. 15 call sites, weight 34.
- `clearConnectUpstreamInternal`: `enterprise/modules/licensing/process/src/app/licensing.app.ts:1038`
- `createBudget`: `enterprise/modules/licensing/process/src/services/contract-budget-store.service.ts:53`
- `findVirtualKeyById`: `enterprise/modules/licensing/process/src/services/hosted-usage-reader.service.ts:37`
- `internalDoor`: `enterprise/modules/licensing/process/src/licensing.module.ts:21`
- `invalidateManagedInternal`: `enterprise/modules/licensing/process/src/app/licensing.app.ts:909`
- `listBudgetsWithHealth`: `enterprise/modules/licensing/process/src/services/contract-budget-store.service.ts:30`; `enterprise/modules/licensing/process/src/services/hosted-usage-reader.service.ts:47`
- `provisionConnectManagedKey`: `enterprise/modules/licensing/process/src/app/licensing.app.ts:903`
- `resetBudget`: `enterprise/modules/licensing/process/src/services/contract-budget-store.service.ts:102`
- `resolveApplicableBudgets`: `enterprise/modules/licensing/process/src/services/hosted-usage-reader.service.ts:39`
- `revokeManagedInternal`: `enterprise/modules/licensing/process/src/app/licensing.app.ts:908`
- `setConnectUpstreamInternal`: `enterprise/modules/licensing/process/src/app/licensing.app.ts:1037`
- `setManagedKeyConnectServicesInternal`: `enterprise/modules/licensing/process/src/app/licensing.app.ts:910`
- `setManagedKeyLicenseInternal`: `enterprise/modules/licensing/process/src/app/licensing.app.ts:911`
- `updateBudget`: `enterprise/modules/licensing/process/src/services/contract-budget-store.service.ts:84`

#### `licensing -> organization`

- Declared: `enterprise/modules/licensing/process/src/app/licensing.app.ts:168`. 14 call sites, weight 33.
- `clearLicense`: `enterprise/modules/licensing/process/src/services/licensing-infrastructure.service.ts:63`
- `countMemberSeats`: `enterprise/modules/licensing/process/src/app/licensing.app.ts:128,130`
- `createSelfHostedCustomer`: `enterprise/modules/licensing/process/src/services/license-registry.service.ts:388`; `enterprise/modules/licensing/process/src/app/licensing.app.ts:897`
- `findAllIds`: `enterprise/modules/licensing/process/src/services/domain-claim-authority.service.ts:32`
- `findProvisioningSummary`: `enterprise/modules/licensing/process/src/services/license-mint.service.ts:51`; `enterprise/modules/licensing/process/src/app/licensing.app.ts:964`
- `markSelfHostedCustomer`: `enterprise/modules/licensing/process/src/services/license-registry.service.ts:94,144,341`; `enterprise/modules/licensing/process/src/app/licensing.app.ts:899`
- `setLicense`: `enterprise/modules/licensing/process/src/services/licensing-infrastructure.service.ts:62`; `enterprise/modules/licensing/process/src/services/license-mint.service.ts:74`

#### `trace -> instant-eval`

- Declared: `modules/trace/process/src/app/trace.app.ts:879`. 8 call sites, weight 22.
- `cancelRun`: `modules/trace/process/src/services/trace-instant-eval-run.service.ts:69`
- `createRun`: `modules/trace/process/src/services/trace-instant-eval-run.service.ts:55`
- `estimateRun`: `modules/trace/process/src/services/trace-instant-eval-run.service.ts:44`
- `findRunWindows`: `modules/trace/process/src/services/trace-instant-eval-run.service.ts:104`
- `getOptInAccess`: `modules/trace/process/src/services/trace-instant-eval-run.service.ts:82`
- `getRun`: `modules/trace/process/src/services/trace-instant-eval-run.service.ts:91`
- `isReleased`: `modules/trace/process/src/app/trace.app.ts:1351`
- `optIn`: `modules/trace/process/src/services/trace-instant-eval-run.service.ts:87`

#### `user -> organization`

- Declared: `modules/user/process/src/app/user.app.ts:185`. 4 call sites, weight 10.
- `checkSignUp`: `modules/user/process/src/app/user.app.ts:465`
- `ensurePersonalWorkspace`: `modules/user/process/src/services/user.service.ts:427`; `modules/user/process/src/services/user-account.service.ts:87`
- `getPersonalWorkspace`: `modules/user/process/src/services/user-account.service.ts:91`

#### `scim -> organization`

- Declared: `enterprise/modules/scim/process/src/app/scim.app.ts:245`. 3 call sites, weight 7.
- `assertRemovalKeepsAnAdministrator`: `enterprise/modules/scim/process/src/services/scim-membership-access.service.ts:137`; `enterprise/modules/scim/process/src/services/scim-deprovision.service.ts:53`
- `findProvisioningSummary`: `enterprise/modules/scim/process/src/services/scim-oversight.service.ts:124`

#### `project -> trace`

- Declared: `modules/project/process/src/app/project.app.ts:102`. 1 call sites, weight 3.
- `resolveViewerProtections`: `modules/project/process/src/app/project.app.ts:247`

#### `user -> project`

- Declared: `modules/user/process/src/app/user.app.ts:186`. 1 call sites, weight 3.
- `findIdentity`: `modules/user/process/src/app/user.app.ts:1024`

#### `agent -> trace`

- Declared: `modules/agent/process/src/app/agent.app.ts:128`. 1 call sites, weight 2.
- `recordCapturedSpan`: `modules/agent/process/src/services/http-agent-test.service.ts:121`
