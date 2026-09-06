# `@langwatch/plans`

One catalogue of every plan fact: identity, pricing, limits with the unit each
is counted in, gates, ladder rungs, the two baselines, and the overrides a
bespoke contract applies over them.

Zod and nothing else, so `contract`, `server`, `web` and `mail` can all read it
without any of them dragging the others onto a boot graph.

```ts
import { applyOverride, planCatalogue } from "@langwatch/plans";

planCatalogue.plan("GROWTH").limits.volume;              // { value: 100000, unit: "messages-per-month" }
planCatalogue.baseline("self-hosted");                   // the open-source plan
planCatalogue.above({ pricingModel: "TIERED", type: "LAUNCH" });
planCatalogue.gate("ENTERPRISE", "auditLogs");           // true
```

## What this package is not

It answers "what is the number", never "may this succeed". Enforcement stays
where it is: seat guards in organization, identity and SCIM, the visibility
window in trace, the dispatch ceiling in automation. Stripe price ids, the
checkout and the webhooks stay in billing; the catalogue holds the amount a
customer is *quoted*, not the thing we charge against. Refusal and upgrade copy
stay with the presentation registry and the refusing feature.

## Disputes

Four plan facts are still stated two ways in the codebase. The catalogue
carries the value billing enforces today and records the other; see
[`drift.md`](./drift.md) and `planCatalogue.disputes()`. They are Alex's to
resolve, and a fifth one fails the suite.

See `dev/docs/adr/131-plans-catalogue.md` and
`specs/dependencies/plan-catalogue.feature`.
