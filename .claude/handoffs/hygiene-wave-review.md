# Review of the five Terra lanes

Reviewed 2026-09-18. Five implementation lanes completed their bounded slices. The original hygiene pile is not complete; no whole-feature or successful production-boot claim.

## Outcome

| Lane | Accepted work | Remaining production work |
| --- | --- | --- |
| Governance | Full Auth API CLI-session lookup/revocation, selected live/memory repository, per-org entitlement lookup | Resolve distinct same-name Governance API tokens and supply the full app's real collaborators; CLI/ingest remain unmounted |
| Scenario | Mounted app-owned generation/export, private model execution, exact target permissions, audit/progress, CSV/gzip and cancellation | Model-provider composition fixture mismatch prevents its current package typecheck |
| Gateway/OTLP | Scoped secrets, minted HMAC door, mounted internal route declarations, canonical OTLP API and direct aliases | gatewayInternalProtocol still has an empty production supplier; canonical OTLP protocol handler needs further decomposition |
| Webhook | Faithful SQS memory sender and behavior tests | Production app still refuses dispatch; wire real HTTP/SQS channels, eventing and lifecycle |
| Hosted MCP | OAuth service plus contract schemas and Redis repository, atomic code redemption, corrupt-token refusal parity | Session/stream hosting and lifecycle decomposition; static client-registry persistence helper still crosses layers |

## Reviewer corrections incorporated

- Removed projected peer API and duplicate model resolution; reused private ModelProviderExecutionHandleService.
- Closed export cancellation races before initial work and across count/page awaits; verified no extra fetch.
- Replaced ambient Gateway secret reads with scoped setup.secrets.into construction.
- Removed Hono contract types and returned credential callbacks from OTLP API.
- Replaced assertion-based Auth fixtures; fixed memory expiry for values, claims and token indexes.
- Added exact authorization target/permission assertions and module-owned export scenario bindings.
- Moved OAuth persistence/parsing behind repository and schemas; replaced get/delete with atomic GETDEL. Concurrent redemption yields exactly one token.
- Preserved refusal/deletion for present corrupt or expired bearer records; missing records retain direct API-key fallback.

## Independently rerun proof

| Check | Result | Log under /tmp/hygiene-wave/ |
| --- | --- | --- |
| Scenario generation/export + structured execution | 4 files, 9 tests pass | review-scenario-final-tests.log |
| Gateway installation/signature + OTLP declaration/composition | 4 files, 30 tests pass | review-gateway-otlp-tests.log |
| Auth sessions/expiry + SQS memory | 4 files, 19 tests pass | review-auth-sqs-tests.log |
| Hosted MCP OAuth parity/replay/corrupt bearer | 1 file, 4 tests pass | review-mcp-final-tests.log |
| Scenario process typecheck | Pass | review-scenario-types.log |
| Service ownership lint regression | 9 tests pass; prior own-repository test failed | service-rule-after-tests.log |

Hosted MCP agent also passed contract/process typechecks. Its full suite has 76 passes and 3 pre-existing failures: missing mcp/typescript/src/create-mcp-server.ts and two access-log assertions. Pre-edit run and unchanged logging implementation establish provenance. Model-provider typecheck has missing members.nlpServiceUrl and obsolete config.nlpServiceUrl in model-provider-composition.build.unit.test.ts. These are not reported green.

## Shared lint correction

service-dependencies recognized server/src/services but not process/src/services. Added core/enterprise valid-own and invalid-peer fixtures for both layouts. The scratch rule scan over modules and enterprise/modules changed from 431 to 9 diagnostics, in 3.259s before and 3.097s after. Remaining diagnostics are in automation, Langy, Trace and SCIM; some may also be false positives in database-client detection and need separate review. No exemption was added. Plugin cold import: 44ms; one-file full-config edit loop: 1.536s, clean for the new OAuth service. All five lint-rule spec scenarios are bound. Generated rule documentation refreshed; unrelated generated rule additions are kept separate from the behavior fix. Root Oxc on the rule itself still reports its unchanged create visitor at cognitive complexity 18 (limit 15); the owner-root change does not alter that visitor. Formatter and scoped whitespace checks pass.

Global architecture/spec/test-quality checks remain red; handoffs record their snapshots. Full hosted-MCP touched-file Oxc also retains existing handler/test findings. No claim that focused tests establish complete architecture compliance. Initial nonexistent package vitest.config.ts invocations failed before tests and were corrected to root/existing config.

The fresh `review:test-quality` rerun remains red with 53 findings (25 shown and 28 hidden by the reporter). Its shown examples are existing analytics memory-safety and Auth browser passkey-autofill assertions. It shows no matched diagnostics for the scenario download, structured generation, MCP OAuth, or service-dependencies slices; capped output does not establish a full clean result.

## Next steps

Finish real Governance/Gateway/Webhook composition; continue Hosted MCP session/host extraction. Then run queued lanes 06–10 and reconcile every original audit item against mounted behavior. The final gate remains composed API/worker boot, route refusal/success proof, and a fresh standards audit.

## Collected implementation commits

- `5be18730dc`: Auth/Governance prerequisite and session expiry.
- `efdd3293f0`: Gateway HMAC and canonical OTLP aliases.
- `c8c9b2ac28`: SQS memory sender.
- `a20ad45092`: Scenario generation/export and model-provider execution boundary.
- `712467cb7f`: Hosted MCP OAuth extraction.

Dependency metadata was collected separately in `ffd83adf8b`. Other sessions' active browser/kernel/app changes remain outside these groups.
