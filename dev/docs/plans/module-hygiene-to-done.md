# Module hygiene completion plan

Scope: the original sixteen-route request and the subsequent 57-module audit. Preserve released behaviour. Work proceeds in reviewed slices with at most three active Luna/Terra workers. An agent count is not a completion claim.

## Delivery order

| Order | Lane | Completion evidence |
| --- | --- | --- |
| 1 | Governance CLI and ingest | Real private composition and one truthful API boundary; mounted routes; organisation-specific entitlement and CLI-session refusal tests. |
| 1 | Scenario generation and export | Real ScenarioApi operations, private model execution, mounted generation/download, target permissions, CSV/gzip/cancellation proof. |
| 1 | Gateway internal and OTLP aliases | Real gateway composition and HMAC mount; aliases share canonical OTLP ingest with matching bytes/status/auth. |
| 2 | Webhook SQS | Production delivery invokes the injected channel; memory behaviour and retry/failure proof. |
| 2 | Hosted MCP | Cohesive protocol/service/channel boundaries, typed framework hosting, lifecycle/session/OAuth/CORS parity and bound specs. A first extraction alone does not close this finding. |
| 2 | Langy leftovers | Every leftover surface is wired through its real owner or removed with caller and parity evidence; internal secret scoping remains intact. |
| 3 | Authorization | Proven same-target checks declared at boundary; denied requests cannot call the operation; distinct-target checks retained. |
| 3 | Transport errors | Concrete domain errors and declared outputs preserve released semantics; obsolete remappers removed only with equivalent coverage. |
| 3 | Prompt memory | Faithful repositories selected by memory tier; tenant/filter/order/version behaviour and installed-module proof. |
| 3 | Billing memory | Billable events and meter memory implementations preserve aggregation, money/time units and tenant isolation; registry proof. |

At most three workers run concurrently. Each owns disjoint paths. Shared framework additions and dependency integration are coordinated centrally. New collaborator needs are resolved through the owning API or framework, never an untyped bag or a placeholder that only refuses.

Next action: construct Scenario's simulation, tab and broadcast collaborators privately from owned repository/channel registries and complete peer APIs, then prove installation before mounting scenario-events. Governance, Gateway, Webhook, Hosted MCP, Billing and supported Langy surfaces also retain production composition gaps. Dataset's nullable reads are collected; its dead REST error-handler mappings need production-equivalent coverage before removal.

## Reconciliation after these lanes

Recheck every original audit finding against current source. Record one of: fixed with proof, intentional and supported by a specific reason, or open with a concrete next action. Remaining implementation is requeued; five handoffs do not terminate the completion checklist.

Particular residuals to account for:

- Gateway repository memory parity beyond the internal route work.
- Remaining undeclared JSON outputs, inline transport schemas, unnecessary middleware and handler error/auth logic outside the selected routes.
- Dataset error handler and other dead residues: delete only after live callers and equivalent tests are accounted for.
- Hosted MCP raw HTTP hosting and lifecycle after its first decomposition slice.
- Stored-object file orchestration, GitHub channel memory coverage, and supported version/alias routes.
- The four untagged trace/topic feature files: bind observable behaviour, never add decorative tags.
- Annotation's recorded blockers and browser API-map findings: verify against current code before deciding they remain defects.

Browser-only modules and deliberate legacy/protocol routes are not fabricated into server modules or removed merely to improve counts. Registered permission spellings and organisation gates previously refuted as violations stay unless current evidence establishes a real defect.

## Closure gates

For each slice:

1. Callers resolve the real installed API; new routes are mounted with real production collaborators.
2. Contracts own schemas; ordinary bodies and outputs use framework parsing/serialization; protocol exceptions carry a reason and use framework support.
3. Behavioural proof covers relevant success/refusal, tenant isolation, protocol status/headers and cancellation. Changed scenarios are bound and a meaningful mutation is observed failing before restoration.
4. Scoped tests/typechecks, Oxfmt, Oxc, architecture review and whitespace checks run. Unrelated diagnostics are named exactly, not reported green.
5. Changes are reviewed and committed in practical groups. Preserve all work; no reset, stash, restore or blanket staging of an active lane.

Final acceptance: reconcile the finding ledger, test the composed API/worker and served surfaces, and rerun the standards audit. A signal scan is evidence for locating work, not a compliance certificate. No full boot or whole-feature compliance claim while a required check remains blocked.

## Current checkpoint

Earlier work collected in six commits: ef5722e683 (streaming), 642fc1036f (share), 94c32a7312 (licensing/entitlement), 61ae6fe6a0 (Langy), cdb205e9b9 (prompt), a6ba4e2df4 (identity). Streaming's 19 focused tests passed. Other group proof and limitations are recorded in `.claude/handoffs/hygiene-commits.md` and `/tmp/langwatch-module-hygiene-proof.md`.

Five Terra implementation lanes have been reviewed. Scenario generation/export is declared on the installer and fixture behavior is proven; continuation review found ScenarioApp still reads undeclared simulation/tab/broadcast collaborators, so real production execution is not proven. Governance has its Auth prerequisite but needs real complete composition. Gateway has scoped HMAC and OTLP alias proof but still lacks its production protocol supplier. Webhook has a faithful memory sender but no live dispatch integration. Hosted MCP has its first OAuth extraction, with atomic redemption; session hosting/lifecycle remains open. Detailed results and exact check limitations: `.claude/handoffs/hygiene-wave-review.md`.

## Continuation findings

- The reported Auth secret refusal was caused by `ApplicationBuilder.addFeature` dropping the declared secret handles. A concurrent four-line fix is independently covered by API/worker construction and undeclared-handle refusal tests. Removing the fix inside the test runner reproduces the refusal. Whole-process boot is not yet confirmed.
- Shared ClickHouse requests now carry an explicit `organizationId` routing fact without changing their project tenant guard. This closes the library gap blocking Billing's organisation-level reader/meter registry. Commit `800ece6c9e`; package 312 tests and typecheck pass.
- Billing currently has factory exports but no module installer. A selected repository registry alone does not establish production billing composition.
- `scenario-event.rest.ts` still contains orchestration and is unmounted. Generation/export proof does not close this original route finding; manifest `.claude/manifests/hygiene-11-scenario-events.md` names the remaining slice.
- Langy's old transport spellings are being relocated with behaviour/tests preserved. Supported but unmounted endpoints must not be deleted as dead code.

## Reviewed continuation commits

- `54b7acd287`: supplied stores select repository tier; API/worker memory installation proof, 44 process-store tests and typecheck pass.
- `e77f18a0fa`: Prompt memory repositories and real installed API/worker proof; 225 package tests pass (45 existing TODOs) and typecheck passes. Review corrected stale tag names and same-timestamp version allocation; removing each fix fails its regression.
- `7d999ee81c`: Billing reader/meter memory twins, repository registries and direct shared ClickHouse routing; 492 package tests pass. Removing the organization filter fails the isolation regression. Billing still lacks its production installer.
- `542189b179`: Langy transport flattening with tests and snapshot iteration preserved; 22 Redis integration tests pass. Earned nested-transport/unused-export baseline entries removed. No supported endpoint was deleted; mounting remains open.

`c5ffc6fbd2` collects GitHub/Experiment declared authorization and API-key preservation regressions. Review rejected an unconditional API-key management gate; own-key view access and the service-only management check remain. Focused tests pass (12 GitHub, 44 API-key, 31 Experiment unit + 1 denied-route integration); Experiment typecheck still reports its existing eventing TS2322 and selected-file lint reports existing aliases/Zod composition. Workflow error review also requires checking archived-row parity before accepting a switch from publication flags to general workflow lookup.

Further composition review: ScenarioApp.reads declares only encryption, rateLimiter and publicBaseUrl, while create reads simulations, scenarioTabs, broadcast and other infrastructure from setup.members. Boot slices declared members. Generation/export and new event route mounting therefore do not establish functional production paths until real private collaborators are constructed. The Scenario lane is investigating the bounded event-side composition.

- `ba066ae4b6`: Trace owns callable scenario media extraction over required StoredObjectApi; 53 focused tests and contract typecheck pass. Trace process typecheck remains blocked by existing ModelProvider fixture drift.
- `aed8343de6`: Scenario event orchestration moved behind ScenarioApi; 41 focused tests and contract/process typechecks pass. Exactly-one archive scope is a registered concrete error. Real production mounting remains open; private construction must replace the undeclared infrastructure member bag, not expand it.

- `66214aa67e`: binds the direct archive-scope failure to its canonical spec and removes a duplicate API-key scenario.
- `4a4063bbac`: Workflow evaluator toggle is one API operation using the original publication lookup; Suite owns not-found translation; Ops replay owns registered conflict/start errors. Twelve focused tests pass with implementation mutation proof. Workflow/Suite/Ops process typechecks retain documented fixture/composition diagnostics.

### Check limits in this checkpoint

Architecture lint: 474 findings and 1,714 stale baseline rows on the shared checkout. Test-quality: 53 findings. Feature-parity: 2,503 unbound scenarios and 324 unknown annotations, plus tagging/exemption diagnostics. Whole-feature Oxc remains red; collected Prompt/Billing/Langy paths themselves have no findings in that run. Trace/Scenario touched files retain existing barrel, naming, comment and fixture-cast diagnostics. Counts include concurrent sessions and are not attributed entirely to this drive.

The `review:comment-blocks` package script does not exist; pnpm printed that fact while returning zero. It was not treated as a passing check. Shared handled-error tests: 89 pass, two fail because docs pages `/evaluations/real-time-evaluation` and `/platform/permissions` do not exist. Its typecheck passes.

Haven reports the API port is not listening. Recent API logs reach pipeline initialization, so whole-process readiness is still unproven. Auth secret registration regression tests are preserved in the checkout while the concurrent owner retains its application-registration fix; this drive did not stage that owner's file.

- `ecddaf30d3`: Dataset nullable reads are named API operations; unexpected errors still propagate. Thirty focused tests and contract/process typechecks pass. Review removed type escapes and redundant cases that overstated tenant/archive proof. Full Dataset tests retain two existing failures: AWS getSignedUrl endpointProvider and ENOSPC-to-StorageNotWritableError expectation. The unmounted REST error handler and its coverage remain pending a deliberate mapping conversion.

## Next batch and acceptance

1. Scenario: replace undeclared infrastructure members with real private construction; prove API/worker installation and event/report/archive/tab routes. Do not expand the ambient member bag.
2. Governance and Gateway: complete their real API implementations and protocol suppliers before claiming the existing declarations work in production.
3. Webhook, Hosted MCP, Langy and Billing: finish the recorded production dispatch/hosting/mount/installer gaps with lifecycle and refusal proof.
4. Dataset: characterize reachable REST error mappings through the installed router, convert plain domain errors and retire the unused handler only after equivalent coverage.
5. Reconcile the broader original audit ledger and rerun complete API/worker startup plus standards checks. This batch does not close the original pile.

All this batch's agents have stopped and reviewed feature changes are committed. Other sessions' dirty paths remain untouched. Proof logs are under `/tmp/hygiene-resume/`; detailed slice handoffs are under `.claude/handoffs/hygiene-*`.
