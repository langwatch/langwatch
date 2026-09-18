# Module hygiene completion plan

Scope: the original sixteen-route request and the subsequent 57-module audit. Preserve released behaviour. The current execution batch is five Terra implementation lanes, followed by coordinator review. Remaining lanes stay queued; an agent count is not a completion claim.

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

Current batch: governance, scenario, gateway/OTLP, webhook, hosted MCP. Langy residue, authorization, errors and memory coverage remain queued after the requested five-agent review.

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

Five Terra implementation lanes have been reviewed. Scenario generation/export is mounted and behavior-proven. Governance has its Auth prerequisite but needs real complete composition. Gateway has scoped HMAC and OTLP alias proof but still lacks its production protocol supplier. Webhook has a faithful memory sender but no live dispatch integration. Hosted MCP has its first OAuth extraction, with atomic redemption; session hosting/lifecycle remains open. Detailed results and exact check limitations: `.claude/handoffs/hygiene-wave-review.md`.
