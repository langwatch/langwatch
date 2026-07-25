# Unenforced-controls audit — executable probes

Reference branch. **Not a proposed change and not meant to merge.** It carries
no production code: three test files and this README.

## What these tests assert, and why they pass

Each probe asserts the **current, buggy** behaviour. So on `main` today they all
**pass**, and a passing test is the observation of the bug. When a fix lands, the
corresponding probe **fails** — that failure is the signal the fix worked.

That polarity is deliberate for audit evidence, but it is the opposite of what
you want in a shipped regression test. **If you are fixing one of these, flip the
assertion** (`assert.NoError` to `assert.Error`, `assert.True(dispatched)` to
`assert.False`, and so on) and move it into the normal suite. Each is a one-line
change; the fixture and the wiring are the valuable part.

## Probe to issue

| Test | Issue |
|---|---|
| `TestAudit_FailClosedGuardrail_FailsOpenOnEvaluatorError` | #6157 |
| `TestAudit_FailClosedGuardrail_PostDirectionFailsOpen` | #6157 |
| `TestAudit_ModelDenyPolicy_BypassedByProviderPrefixAndAlias` | #6158 |
| `TestAudit_ModelsAllowed_SkippedByAlias` | #6158 |
| `TestAudit_PolicyRules_NotEnforcedOnGeminiBodyShape` | #6160 |
| `TestAudit_PolicyInterceptor_PassesGeminiToolThrough` | #6160 |
| `TestAudit_CacheRule_PrincipalMatcherNeverFires` | #6165 |
| `audit.archivedTeamPermissions.integration.test.ts` | #6159 |
| `audit.seatCapPromotion.unit.test.ts` | #6161 |

## Running them

```bash
# Go probes (no services needed)
go test ./services/aigateway/app/ -run 'TestAudit_' -v

# Postgres probe (native PG on :5432, never CI=1)
cd langwatch && pnpm test:integration run \
  src/server/api/routers/__tests__/audit.archivedTeamPermissions.integration.test.ts

# Pure-function probe
cd langwatch && pnpm test:unit run \
  src/server/license-enforcement/__tests__/audit.seatCapPromotion.unit.test.ts
```

## Already fixed elsewhere

`origin/issue6139/gateway-hardening` fixes **#6157** (both directions). Verified
by running this branch's probes against it: the two guardrail tests fail there
with `guardrail_upstream_unavailable`, which is what contract §5 requires. The
other five Go probes still pass there, so those findings are untouched.

**#6170** (WEEK budgets) is fixed on `origin/issue6139/gateway-hardening` and
`origin/issue6141/budgets-and-onboarding` by migration
`00055_gateway_budget_scope_totals_period_start.sql`, which recreates the MV with
`toStartOfWeek(OccurredAt, 1)`. Neither is on `main` yet.

Everything else in the audit was still unfixed on every ref at the time of writing.
