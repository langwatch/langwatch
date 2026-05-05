# ADR-018: Plan-resolution bypass must land at every fork

**Date:** 2026-05-05

**Status:** Accepted

## Context

Self-hosted LangWatch installs use `LANGWATCH_DEV_FORCE_ENTERPRISE=true` as a
documented escape hatch to unlock the full feature surface (audit log, ingestion
sources, anomaly rules, multi-user surfaces) without a signed license file —
intended for dogfood and capture runs. The feature exists because the FREE
plan caps `maxMembers` aggressively, and self-hosted dogfood without the bypass
hits "1/1 members" on the first invite, blocking every multi-user governance
path the platform was built for.

Plan resolution funnels through `getApp().planProvider.getActivePlan()` in
production code (InviteService, license-enforcement guard, usage-stats
service). The expectation when the bypass first shipped was that patching the
*composite* plan provider would catch every consumer.

In practice, the composite is wired only on SaaS:

```ts
// presets.ts
const planProvider = config.isSaas
  ? PlanProviderService.create(createCompositePlanProvider({ ... }))
  : PlanProviderService.create({                             // ← non-SaaS
      getActivePlan: async ({ organizationId }) => {
        const plan = await getLicenseHandler().getActivePlan(organizationId);
        return { ...plan, planSource: ... };
      },
    });
```

The non-SaaS branch builds directly from the license handler and skips the
composite as an optimization (no Stripe lookup, no SaaS plan precedence). That
optimization predates the bypass and is correct on its own terms — but it
means a "bypass at the canonical layer" written into the composite never fires
on dogfood, where the user actually needs it.

The first attempted fix patched only the composite (`0cc690381`) and tested
green against the SaaS unit suite. Under dogfood it didn't engage. A
follow-up (`7714a0356`) mirrored the same bypass on the non-SaaS branch.

## Decision

Plan-modifying bypasses (dev-force-enterprise, license-tier overrides, future
test-mode shims) MUST land at every plan-resolution fork in `presets.ts` —
both the SaaS composite branch and the non-SaaS direct branch — OR at a layer
strictly inside both. They MUST NOT live in just one branch on the assumption
that a "canonical layer" exists; the composite is canonical only for SaaS.

The non-SaaS branch in `presets.ts` is the runtime path for every self-hosted
install. Any plan transformation logic that should also affect dogfood needs
to be present there explicitly.

## Rationale / Trade-offs

Two alternatives were considered and rejected:

1. **Move the bypass to a shared inner function called from both branches.**
   Cleanest in code, but requires both branches to actually call into the
   shared function — which is the same defect class as the original bug
   (forgetting to wire one branch). A linter rule could catch it, but the
   linter would have to know which functions are "plan transformations,"
   which is a hard pattern to encode mechanically.

2. **Collapse to a single composite branch on every install.** Pulls Stripe
   client construction onto the non-SaaS path, which is wrong — non-SaaS
   has no Stripe at all. Possible to lazy-construct, but the composite's
   raison d'être is precedence between SaaS Stripe lookups and licenses;
   on non-SaaS the lookups don't exist, so the composite degenerates to a
   no-op wrapper.

Mirroring the bypass at both branches is duplicative but correct and
explicit. The bypass is small (six lines plus a comment), the duplication
is contained to one file, and a unit test pinning the dogfood path
(`devForceEnterprise === true && IS_SAAS === false → ENTERPRISE limits`)
prevents drift.

## Consequences

- Future plan-modifying bypasses follow the same shape: land at both
  branches OR drop a comment in `presets.ts` explaining why one branch
  doesn't need the patch (e.g. "SaaS-only feature flag").
- The composite plan provider's name no longer implies "this is the
  canonical layer for ALL plan transformations" — it's the canonical
  layer for **SaaS-side plan precedence between license + Stripe**.
  Worth a docstring on `createCompositePlanProvider` reinforcing this
  scope to the next maintainer.
- Tests should pin both paths whenever a new bypass lands. The composite's
  unit suite (28 tests) covers the SaaS path; the non-SaaS path needs its
  own unit asserting the dogfood case.

## References

- `7714a0356` fix(license): apply LANGWATCH_DEV_FORCE_ENTERPRISE on the non-SaaS plan-provider path too
- `0cc690381` fix(license): apply LANGWATCH_DEV_FORCE_ENTERPRISE at the composite layer so member-cap enforcement honors it
- `src/server/app-layer/presets.ts:266-304` — both plan-resolution branches
- `src/server/app-layer/subscription/composite-plan-provider.ts` — composite (SaaS) bypass
