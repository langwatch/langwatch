# ADR-131: One catalogue states every plan fact

**Date:** 2026-09-07

**Status:** Proposed

## Context

A plan fact — a member ceiling, a monthly volume, a price, a retention window,
whether a tier may publish — is currently stated in eleven definitional places.
The census run on this branch found `PLAN_LIMITS` in the billing contract, a
second and different plan universe in the licensing contract (`FREE_PLAN`,
`UNLIMITED_PLAN`, three licence templates, a tier→entitlement map, an
open-source floor), the `Plan` schema in the entitlement contract, the
self-serve ladder in an API composition root, the automation dispatch buckets
in another, the marketing bullet lists in the billing web package, the
Enterprise capability list in `plan-gate`, and the `PlanTypes` and
`PricingModel` enums written once in Prisma and again in TypeScript with a
comment asking that the two stay aligned.

Eleven sites is not a style problem. It has already produced four live
disagreements. Two Free plans exist and both are reachable, so a free
organization's real ceiling depends on which source resolves first. Pro is
quoted at 10,000 messages a month while Free is quoted at 50,000, and since the
ladder ranks rungs by volume, the product can never offer Free an upgrade to
Pro. The pricing page says Growth includes 200,000 events while Growth enforces
100,000, and no test compares the two. The daily automation dispatch ceiling is
stated three times, with the automation service's own test pinning numbers
neither of the other two states.

The constraint that shapes the answer: this is the one module a feature
contract, a server, a browser bundle and the mail renderer all have to read.
ADR-111 forbids a value-import chain from server code into a browser package,
so whatever holds these facts can carry no framework, no Prisma client, and no
feature dependency at all.

## Decision

We will state every plan fact once, in a new workspace package
`packages/plans` (`@langwatch/plans`), whose only dependency is zod.

It is infrastructure, not a feature. ADR-112 admits a feature when it has an
independently meaningful lifecycle, a permission boundary, a durable model or a
runtime responsibility; a catalogue has none of those. Nothing in it is
created, authorized, stored or executed. Made a feature, it would need a
`server/` with no repository and a `web/` with no screen — the strict layout
grammar satisfied by empty directories, which is the tell.

The catalogue answers "what is the number". It never answers "may this
succeed". Enforcement stays exactly where it is: seat guards in organization,
identity and SCIM, the visibility window in trace, the dispatch ceiling in
automation. Stripe price ids, the checkout, the webhooks and proration stay in
billing — the catalogue holds the amount a customer is *quoted*, not the thing
we charge against. Refusal and upgrade copy stay in the presentation registry
and the refusing feature; the catalogue is data, not words a customer reads.
`@langwatch/mail` keeps importing nothing from it: the sender passes resolved
numbers as props.

Every limit carries the unit it is counted in, because a bare number is how the
same ceiling reads as "members" on one screen and "seats" on the next.

A bespoke contract is never a new entry. It is a `PlanOverride` carrying a
provenance (`licence` or `negotiated`), the limits the contract actually
settled and the gates it explicitly granted or withheld. `applyOverride` keeps
today's three rules, which currently live in three files: an explicit value
always wins, an absent value falls to the plan's tier, and on self-hosted
everything except seats floors at the open-source baseline. Provenance is what
makes an organization account-managed, so "this organization negotiated" stops
being inferred from `planSource === "license"` in three separate places.

Prisma stays the storage enum and is **validated rather than generated**: a
unit test reads `schema.prisma`, extracts `enum PlanTypes` and `enum
PricingModel`, and asserts set equality with the catalogue. A generator would
add a build step to the one package whose point is having none, and the failure
we care about — a name added on one side only — is caught just as well by the
test. It replaces the "Values must stay aligned" comment.

### Who reads the catalogue

```
                          ┌─────────────────────────────┐
                          │      @langwatch/plans       │
                          │  limits · rungs · gates     │
                          │  baselines · applyOverride  │
                          │   (zod only, no deps)       │
                          └──────────────┬──────────────┘
             ┌────────────────┬──────────┼───────────┬─────────────────┐
             ▼                ▼          ▼           ▼                 ▼
      entitlement/      licensing/    billing/   plan-gate      billing/web
        server           server        server                  (labels only)
   PlanNextStep,     floor + override  Stripe    Enterprise      pricing page
   UsageMeterPolicy   over a baseline  mapping   capability
             │                │           │           │
             └────────────────┴─────┬─────┴───────────┘
                                    ▼
                          PlanProvider.getActivePlan()
                                    │
        ┌──────────────┬────────────┼──────────────┬──────────────┐
        ▼              ▼            ▼              ▼              ▼
   organization    identity       trace       automation        scim
   invite seats  join ceiling  visibility   dispatch cap     provisioning
                                    │
                                    ▼   (resolved numbers as props)
                             @langwatch/mail   ← imports nothing from plans
```

Prisma sits beside this, not under it: it stores the chosen plan type, and the
catalogue explains what that type means.

### The disputes are recorded, not resolved

Where two definitional sites disagree, the catalogue carries the value billing
enforces today — the number a customer is charged and refused against right now
— and records the other one, with the line that states it, in
`packages/plans/drift.md` and in `PLAN_DISPUTES`. The plans subject to a
dispute name it in a typed `disputed` field, and a test asserts the dispute
list is exactly the four the census found, so a fifth drift fails rather than
being absorbed.

| Dispute | In the catalogue | The other value |
| --- | --- | --- |
| `free-plan-two-definitions` | 2 members, 50,000 a month, publishing allowed | 1 member, 1,000 a month, publishing refused |
| `pro-volume-below-free` | Pro 10,000 a month, 5 members | Pro 100,000 a month, 10 members; Free is 50,000, above it |
| `growth-copy-volume` | Growth 100,000 a month | the pricing page says 200,000 |
| `automation-ceiling-three-ways` | per plan: 50 / 150 / 300 / 500 / 5,000 | buckets of 50 / 500 / 5,000; a test pinning 100 / 1,000 / 10,000 |

Resolving each is a product decision with a customer consequence, so each lands
in its own commit with the before and after values in the message.

### The lint rule

`langwatch/plan-literals` refuses an object literal that assigns two or more
plan limit fields anywhere outside `packages/plans`. One such field is a
fixture; two is a plan definition, and a second plan definition is how the
drift above happened. It ships at `error` with the twenty-three files that
state one today on the shared oxlint debt register, dated 2026-09-07, and the
register empties as the migration stages land.

## Rationale / Trade-offs

**Why not extend the billing contract?** Because licensing, entitlement and the
open-source deployment all need these facts, and a feature package may not
import another feature's implementation. That constraint is exactly what
produced `PlanCataloguePort` and its API-composition adapter: an interface
invented so entitlement could reach a ladder that lived in billing. With the
ladder in a dependency-free package the port and its adapter are deleted rather
than adapted.

**Why record the disputes instead of fixing them here?** Each is a number a
customer sees. Picking a side while moving files would land a pricing change
inside a refactor, where nobody would review it as one.

**Cost accepted:** one more workspace package, and a period during which the
catalogue and its readers both exist. Stage 1 is inert — nothing imports it —
so the tree typechecks and lints on its own at every step.

## Consequences

- Adding a plan, or changing a ceiling, is one edit in one file, and the
  pricing page, the upgrade mail, the seat guard and the ladder all follow.
- A drift becomes a test failure rather than a support ticket.
- `PlanCataloguePort`, `ApiPlanCatalogueAdapter`, `TIERED_LADDER`,
  `SEAT_EVENT_LADDER` and `PERSIST_CAP` all go, taking roughly 250 lines of
  wiring with them.
- The four disputes become visible and decidable rather than latent.

## Open items

1. **Licensing placement.** The catalogue carries LangWatch Cloud list prices,
   which today sit under `enterprise/`, while the open-source baseline
   must stay readable by Apache-licensed code. This ADR builds **one** package
   under `packages/plans`, carrying the same `MIT` manifest licence the other
   shared packages carry, on the argument that splitting it repeats the drift
   it exists to fix. Alex has not ruled; if the split is wanted, the seam is
   `catalogue-data.ts`, and the cloud plans move while the schemas, the read
   API, `applyOverride` and the open-source baseline stay.
2. **Each of the four disputes**, above.
3. **Whether Free belongs on the ladder.** Free carries no rung today, which is
   the mechanism behind `pro-volume-below-free`; it is recorded there rather
   than as a fifth dispute.

## References

- Related ADRs: ADR-111 (frontend boundary), ADR-112 (singular feature
  ownership), ADR-076 (single pnpm workspace)
- Spec: `specs/dependencies/plan-catalogue.feature`,
  `specs/tooling/lint-plan-literals.feature`
- Drift record: `packages/plans/drift.md`
