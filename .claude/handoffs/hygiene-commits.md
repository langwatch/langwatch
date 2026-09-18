# Hygiene commits handoff

## Collected commits

| Commit | Scope | Evidence |
| --- | --- | --- |
| `ef5722e683` | API async byte streaming producer | Direct focused Vitest: 2 files, 19 tests passed. `git diff --check` passed. |
| `642fc1036f` | Share feature boundary migration | Reviewed feature-directory slice. `git diff --check` passed. |
| `94c32a7312` | Licensing and entitlement wiring | Reviewed feature-directory slice. `git diff --check` passed. Existing focused licensing and entitlement logs are listed in `/tmp/langwatch-module-hygiene-proof.md`. |
| `61ae6fe6a0` | Langy feature internals | Reviewed feature-directory slice. `git diff --check` passed. Existing focused Langy log is listed in `/tmp/langwatch-module-hygiene-proof.md`. |
| `cdb205e9b9` | Prompt feature execution boundary | Reviewed feature-directory slice. `git diff --check` passed. Existing focused prompt logs are listed in `/tmp/langwatch-module-hygiene-proof.md`. |
| `a6ba4e2df4` | Identity verification ceremony | Reviewed feature-directory slice. `git diff --check` passed. Existing focused identity logs are listed in `/tmp/langwatch-module-hygiene-proof.md`. |

## Preserved and skipped work

- Preserved pre-existing index entries: seven staged dashboard-widget renames from `modules/analytics/process` to `modules/dashboard/process`. They were not changed or committed.
- Skipped analytics/dashboard because those pre-existing staged entries overlap its completed slice.
- Skipped `modules/user`: its app composition was actively changing during collection.
- Skipped `modules/model-provider` and `modules/auth` at the coordinator's instruction because live lanes own them.
- Governance, scenario, gateway and trace remain excluded.

## Limits

- The API package script expanded to the full suite and found one unrelated compiler-fixture assertion mismatch: `runtime.compiler.test.ts` expected six diagnostics but observed five. The directly selected streaming tests passed.
- Backend logs continue to show the known live failure: `LANGWATCH_NLP_SERVICE` is declared by both `http` and `model-provider`. No commit claims a successful backend boot.

## Second collection pass

| Commit | Scope | Evidence and limit |
| --- | --- | --- |
| `5be18730dc` | Auth CLI access-session API, repository and TTL prerequisite, with its settled Governance fixtures | Parent reran the Auth and memory-SQS coverage: 4 files, 19 tests passed at `/tmp/hygiene-wave/review-auth-sqs-tests.log`. Auth and Governance routes remain unmounted where their real production collaborators are absent. |
| `efdd3293f0` | Gateway internal HMAC mount and Trace canonical OTLP aliases | Parent reran Gateway and OTLP coverage. The gateway root still supplies `gatewayInternalProtocol` as `{}`, so no production-composition fix is claimed. |
| `c8c9b2ac28` | Webhook memory destination sender | Webhook typecheck and focused memory/SQS tests passed according to `.claude/handoffs/hygiene-04-webhook.md`; the live webhook dispatch composition remains absent. |
| `ffd83adf8b` | Module dependency and generated membership metadata | Reviewed `modules/package.json`, `modules/server-module-members.generated.ts`, and `pnpm-lock.yaml` only. No baseline was included. |

All four slices passed their scoped whitespace check. Scenario, model-provider and hosted MCP were left uncommitted because live review fixes own those paths. The untracked browser-node-leak architecture baseline remains intentionally uncommitted.

## Final module and review collection

| Commit | Scope | Limit |
| --- | --- | --- |
| `a20ad45092` | Scenario generation/export and portable model-provider execution | Scenario's focused four-file suite passed; model-provider's current package typecheck retains an unrelated composition-fixture mismatch. |
| `712467cb7f` | Hosted MCP OAuth schemas, service, repository and protocol delegation | Focused OAuth proof passed. The full suite retains three pre-existing failures. |
| `9d60577994` | Service-dependencies process-module owner-root correction | Nine rule tests and all five bound scenarios passed. The unchanged rule visitor retains its complexity finding. |
| `5d8d03dd15` | Generated lint-rule reference | Contains generator output, including other existing rule declarations. |
