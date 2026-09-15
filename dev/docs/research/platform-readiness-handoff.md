# Platform readiness handoff

Working branch: `feat/strict-feature-layout-v0`. Shared worktree; preserve other
agents' changes and user commits. This is an execution snapshot, not an ADR.

## Next sequence

1. Finish ordered, schema-parsed middleware trailing arguments in REST and tRPC.
   Keep the existing first handler argument unchanged. Implement type, runtime
   and adversarial tests before moving SCIM onto the fluent API.
2. Complete SCIM bearer/webhook middleware wiring, then migrate remaining
   endpoints in bounded batches. Use the transport lints as the inventory.
3. Get API and worker listening with real composed providers. Finish the
   stored-object startup migration before claiming its Postgres cutover works.
4. Run authenticated UI smoke, API diff against `origin/main`, and visual diff
   in small batches. Fix and rerun each batch. Package test counts are not proof
   of process readiness or product parity.
5. Finish Webhook caller cutover and review Prisma scoped access before adopting
   it repository by repository. Keep exact reviewed commit scripts current.

## Accepted rules

The authority is [ADR-133](../adr/133-composition-spec.md) and
[composition-spec.feature](../../../specs/server/composition-spec.feature).
`AGENTS.md` and the inventory, migration and migration-review skills now point
to the updated handler requirements and verifiable checks. Middleware trailing
arguments are agreed but **not implemented**. Do not substitute context setters,
input mutation, raw headers or callback bags.

## Current evidence and blockers

- API framework: agent reports 509 tests and typecheck passing for inferred
  return types, strict void callback returns, and log-only output mismatches.
  Observability reports 209 tests including content-free schema diagnostics.
  Those results precede implementation of trailing middleware arguments.
- Handler lint: Luna reports 41 focused tests and typecheck passing. It enforces
  inline handlers and rejects headers and response-shaped calls, including
  `input.headers` and `app.text()`. Root reviewed and corrected false positives
  before the user's stricter header/response requirement was applied.
- SCIM: bearer and webhook authentication extracted into middleware; protocol
  tests pass. Static secured families gained a fluent adapter. Final handler
  migration waits for typed trailing facts; no input/context workaround accepted.
- API still does not listen. Actual boot reached StoredObjectApp after factory
  fixes. The new App writes Postgres metadata, while existing file/byte services
  read ClickHouse metadata. Supplying arbitrary ports or limits would conceal an
  incomplete migration. Latest log: `/private/tmp/langwatch-api-readiness.log`.
- Worker: full graph integration written, actual boot unproven. Missing links
  are fixed; the fourth attempt passed imports but sandbox denied Redis access.
  Final dependency scan and offline relink succeeded. Root started an escalated
  boot at 14:04 UTC: session `23122`, PID `21853`, log
  `/private/tmp/langwatch-worker-readiness-root.log`. Inspect that running process
  before starting another worker. The worker lead knows root owns this session.
- Worker residuals: avatar storage uses the real legacy ClickHouse service via
  the existing technical port; Postgres StoredObjectApi adoption remains undone.
  Processing privacy and canonical DataPrivacyApp still need one shared owner.
  Evaluation/ModelProvider use named process declarations for cyclic setup.
- UI runs at `http://localhost:5560`. Production build passes; 82 navigation/
  governance tests pass. Authenticated smoke waits for API health on port 6560.
  Screenshots currently show the startup gate. Do not call that UI parity.
- Webhook has a callable API and installer; gateway peer cutover landed.
  Service getters and legacy delivery/REST callers still require final removal.
- Prisma scoped capability is unadopted and scenarios remain pending. Root
  rejected its first implementation for optional relations, fluent relation
  escapes, implicit cascades, mutable claims and JSON false positives. Agent
  reports fixes and 130 passing tests. Review the revised implementation before
  adoption; update/delete/upsert are currently denied rather than proven safe.
- Root's shared-trace resourceId-to-traceId fix is present. Its API integration
  suite has 18 passing and 13 failing tests because old fixtures omit the newly
  required trace viewer. Reconcile with the canonical Trace composition first.

## Owners and review

- `/root/api_handler_types`: API return types, runtime output diagnostics;
  next owner for trailing middleware facts.
- `/root/api_handler_lint`: Luna owns lint wiring; do not use Astra for it.
- `/root/scim_handler_migration`: middleware and fluent SCIM migration.
- `/root/api_runtime_readiness`: API composition and actual boot.
- `/root/astra_provenance_design`: worker graph lead and its existing children.
- `/root/webhook_canonical_app`: Webhook API and remaining caller cutover.
- `/root/prisma_repository_capability`: scoped Prisma foundation fixes.
- `/root/ui_runtime_readiness`: authenticated browser smoke after API is healthy.
- `/root/diff_readiness`: prepared origin/main baseline and diff commands.

API diff must compare `origin/main`, not stale local `main`. Prepared baseline:
`/private/tmp/langwatch-ts-bench-origin-main`. Run the existing apidiff harness
with the dirty candidate and isolated databases, starting with `/api/traces`.
Use its kept base URL for direct visual runner comparison with UI port 5560.

`dev/scripts/commit-reviewed-corrections.sh` commits earlier reviewed batches
using isolated indexes while preserving unrelated staged changes. It does not
automatically include the newer work listed here. No blanket staging or reset.

Documentation checks: changed files pass `git diff --check`; all three skill
frontmatters and relative links were validated with the installed YAML parser.
The skill-creator Python validator could not run because PyYAML is unavailable.
New Gherkin scenarios remain tagged unimplemented until their coverage is proven.
