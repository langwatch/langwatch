# Drift: where two sites state the same plan fact differently

Recorded on `feat/strict-feature-layout-v0`, 2026-09-07, from the census in the
plans proposal. The catalogue in `src/catalogue-data.ts` carries **the value
billing enforces today**, because that is the number a customer is charged and
refused against right now. The other value is recorded here and in
`src/disputes.ts`, with the line that states it.

**Nothing here is resolved.** Alex decides each one. Until then
`planCatalogue.disputes()` lists all four, and
`src/__tests__/catalogue.unit.test.ts` fails if a fifth appears.

---

## 1. `free-plan-two-definitions` — two Free plans disagree

| | Members | Lite | Volume / month | Publishing | Visibility |
| --- | ---: | ---: | ---: | --- | ---: |
| **In the catalogue** (billing) | 2 | 0 | 50,000 | allowed | 14 days |
| Alternative (licensing) | 1 | 0 | 1,000 | refused | 14 days |

- In force: `packages/enterprise/features/billing/contract/src/plan-limits.ts:78`
- Alternative: `packages/enterprise/features/licensing/contract/src/license-constants.ts:44`
  (`FREE_TIER_LIMITS`, consumed by `FREE_PLAN` at line 77; `canPublish: false` at line 90)

Both are reachable. Which one answers depends on which source resolves first,
so a cloud free organization's real ceiling is decided by resolution order
rather than by a decision.

## 2. `pro-volume-below-free` — Pro is quoted below Free

| | Members | Lite | Volume / month |
| --- | ---: | ---: | ---: |
| **In the catalogue** (billing) | 5 | 9,999 | 10,000 |
| Alternative (licensing template) | 10 | 5 | 100,000 |

- In force: `packages/enterprise/features/billing/contract/src/plan-limits.ts:93`
- Alternative: `packages/enterprise/features/licensing/contract/src/license-plan-templates.ts:35`
- Consequence: Free is 50,000 at `plan-limits.ts:79`, above Pro.

The ladder ranks rungs by monthly volume, so with Pro at 10,000 the product can
never place Pro above anything and never offers Free an upgrade to Pro. Fixing
the ordering and fixing the number are the same decision.

## 3. `growth-copy-volume` — the pricing page quotes twice what Growth enforces

| | Volume / month |
| --- | ---: |
| **In the catalogue** (billing) | 100,000 |
| Alternative (pricing page copy) | 200,000 |

- In force: `packages/enterprise/features/billing/contract/src/plan-limits.ts:126`
- Alternative: `packages/enterprise/features/billing/web/src/model/billing-plans.ts:89`
  (and the same sentence in the upgrade block at line 63)

No test compares the sentence with the ceiling, so the page has been quoting a
number the product does not honour.

## 4. `automation-ceiling-three-ways` — the daily dispatch ceiling is stated three times

| | Free | Paid | Enterprise |
| --- | ---: | ---: | ---: |
| **In the catalogue** (per plan) | 50 | 150 / 300 / 500 | 5,000 |
| Alternative (API composition buckets) | 50 | 500 | 5,000 |
| Alternative (automation service test) | 100 | 1,000 | 10,000 |

- In force: `packages/enterprise/features/billing/contract/src/plan-limits.ts:83`
  (per plan: Free 50, Pro 500, Launch 150, Accelerate 300, Growth 500, Enterprise 5,000)
- Alternative: `apps/api/src/app/api-automation.composition.ts:80`
- Alternative: `packages/features/automation/server/src/services/__tests__/automation.service.unit.test.ts:293`

The buckets agree with the per-plan values on Free and Enterprise and flatten
Launch and Accelerate to the paid bucket; the test pins numbers neither of the
other two states.

---

## Observations, not disputes

Recorded because a reader will meet them, not tracked as disputes: neither is
two sites disagreeing about one plan's number.

- **Two unlimited sentinels.** Billing uses `999_999_999`
  (`plan-limits.ts:9`); licensing uses `Number.MAX_SAFE_INTEGER`
  (`license-constants.ts:14`). The catalogue exports both, as
  `UNLIMITED_MESSAGES` and `UNLIMITED`, and the open-source baseline uses the
  latter, as it does today.
- **The Free tier's counting unit.** Billing's Free states no `usageUnit`;
  licensing's states `traces` (`license-constants.ts:91`); the meter policy
  sends every free organization to `events`
  (`packages/features/entitlement/server/src/services/usage-meter-policy.service.ts`).
  The catalogue records `messages-per-month`, matching the only site that
  states a unit for the plan itself.
- **Retention days are prose only.** The pricing page says "14 days data
  retention" and "30 days retention" (`billing-plans.ts:77`, `:91`). No plan
  limit backs either. The catalogue carries the 14-day *visibility* window,
  which is a different rule, and states no retention limit at all.
