# ADR candidates surfaced by the comment sweeps, 2026-09-06

The comment sweeps cut every block to the why alone. The narrative below was
too long for a comment and too valuable to lose; each row names the file that
now carries a one-line pointer and the record that should hold the detail.
Recover the original text with `git log -p -S'<phrase>' -- <file>`.

| File | Narrative to record | Home |
| --- | --- | --- |
| `packages/api/src/rest/idempotency-ledger.ts` | Create-only receipt semantics, liveness-based claim supersession, fencing via claimId rewrite, why only 2xx is stored, why the body is encrypted | New ADR: idempotency ledger |
| `packages/api/src/trpc/trpc-api-service.ts` | Policy must wrap an already-parsed procedure or checks no-op; scope-lineage guard runs before the check | ADR on the tRPC chain |
| `apps/api/src/features/enterprise/enterprise-governance-trpc.mount.ts` | Why governance and gateway compositions are built together; why personalDashboard merges into `user.*` | ADR on composition roots |
| `apps/api/src/features/langy/langy-trpc.mount.ts` | Demo-project refusal before `enforceLangyAccess`; the order is security load-bearing | ADR-129 appendix |
| `packages/clickhouse-client/src/tenancy.ts` | Fail-closed tenant routing; the cache never expires, it only evicts | ADR-127 appendix |
| `apps/api/src/features/experiment/experiment-v3-rest.mount.ts` | The two named absences pattern (no analytics sink, no progress store), also in evaluations-legacy | Best practice: composition roots |
| `apps/api/src/features/*/*.composition.types.ts` | Why the type lives apart from its composition (37 copies collapsed to one line) | `service-repository-adapter-port.md` |
| `packages/features/langy/server/src/repositories/prisma/prisma.langy-turn-admission.repository.ts` | `COMMITTED_ABANDON_MS` backstop: a COMMITTED row has no lease escape when a worker dies skipping terminal events; 10 min chosen against 35 to 65 s turns. Deploy-boundary window: pre-hash receipt ids 409 a byte-identical retry for minutes around one deploy | ADR-129 appendix |
| `packages/features/langy/server/src/services/langy-local-session.service.ts` | Split-brain fencing via presence instance id: GONE is not supersession, only a record naming a different instance retires the connection | ADR-129 appendix |
| `packages/features/langy/server/src/adapters/redis.langy-local-presence.adapter.ts` | Heartbeat versus TTL race; replaced versus restored semantics | ADR-129 appendix |
| `packages/features/langy/server/src/transport/api-trpc/langy-egress.api.ts` | Demo project leaked its egress allowlist because `project:view` is demo-granted; gate on `langy:*` plus explicit demo refusal | ADR-129 appendix, security note |
| `packages/features/langy/server/src/transport/api-rest/langy.local-control-http.ts` | The CLI, worker and panel route table for local control | ADR-129 appendix |
| `packages/features/langy/contract/src/cards/derived-safe.ts` | Three compile-time gates against the DERIVED-SAFE allowlist widening, plus the runtime pin test | ADR-060 appendix |
| `packages/features/trace/contract/src/trace-ai-query.ts` | `AiActionErrorDetails.reason` never carries raw provider text: a 401 body once leaked a managed-provider key | Security note in error-handling best practice |
| `packages/features/trace/server/src/projections/trace-derived.projection.ts` | Storage-anchor split history (00056 read-back discriminator, decode-in-place for pre-split rows, incident 196952); always-write-row fix for the store-miss ambiguity (150k wasted fallback scans a month); accumulator keys coupled to `FOLD_ACCUMULATOR_KEYS` by the fold-equivalence suite | ADR-066 and ADR-071 appendices |

Remaining sweep scope not yet started: the rest of `trace/server` (spool service,
eventing stores, six transport files) and roughly 35 other feature server
packages. Repo-wide `comment-block-size` stood at 1891 after sweep A and 726
inside the feature-server scope after sweep B.

## Sweep G (2026-09-06): apps/api, apps/server, apps/ui e2e/tests, enterprise webhook/governance/billing, observability, test-harness, sdks/typescript/agent

| File | Narrative to record | Home |
| --- | --- | --- |
| `packages/observability/src/logger.ts` | Logger factory cache keyed by (name, disableContext): 400+ call sites, fresh `pino()` measured at 2.3% of prod wall time; safe to share since per-request fields arrive fresh via the mixin, never baked in at construction | New ADR: observability logger factory caching |
| `packages/observability/src/logger.ts` | Pretty-console transport options must survive `structuredClone` (cross a worker-thread boundary, so no formatter functions); building the pretty stream on this thread instead silently kills the OTel log transport | Appendix to the same ADR: pretty console transport constraints |
| `apps/api/src/features/enterprise/enterprise-webhook.composition.ts` | The webhook surface's entitlement gate is a plan read, not an Enterprise capability, so a deployment with no governance app still answers a customer-actionable 403 instead of an unknown-error 503 | Best practice: composition roots (webhook plan-gate independence) |
| `packages/enterprise/features/webhook/server/src/app/webhook.app.ts` | Why `WebhookApp` is a holder (lifts only the entitlement gate and optional-events-log decisions both doors used to duplicate) rather than restating endpoint-store operations | Best practice: service-repository-adapter-port (application-as-holder) |
| `apps/api/src/features/trace/trace-rest.mount.ts` | Named absence: the coding-agent transcript join is not supplied because `composeApiTraceReadStack` refuses `LogService.getLogsByTraceId` by name (legacy table has taken no write since the canonical cutover) | Best practice: composition roots (named absences) |
| `apps/ui/e2e/langy/local-control-fixture.ts` | CLI API key mint is read back before use: `apiKey.create` answering 200 has been seen to leave the binding unwritten under load, surfacing two minutes later as a CLI that never printed its prompt | ADR-129 appendix |
