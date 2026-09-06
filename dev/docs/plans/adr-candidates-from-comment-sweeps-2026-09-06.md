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
