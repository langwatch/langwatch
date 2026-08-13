# ADR-094: RPC endpoint naming for the webhooks management family

**Date:** 2026-08-13

**Status:** Proposed

## Context

The management API surface is converging on `@langwatch/api` (`packages/api`),
the versioned service framework. Four families already run on it through
`createManagementService` — `organization`, `roles`, `role-bindings` and
`scim-tokens` — and all four are **resource-REST**: a noun path, an HTTP verb
carrying the operation, `GET /roles`, `POST /roles`, `PATCH /roles/{id}`.

The webhook-endpoints family is the next to migrate. It is currently a
hand-rolled Hono app at `/api/webhooks/v1/*` on the older `createOrgApp` builder:
twelve endpoints across five HTTP verbs, with unvalidated path params, response
DTOs that are described for OpenAPI but never checked at runtime, and four
pieces of business logic living in the route rather than the service layer.

Resource-REST has been a poor fit for this particular family from the start, and
the friction is concentrated in the operations that are not CRUD:

- `POST /endpoints/{id}/roll-secret` — not a sub-resource; a verb wearing a noun
  costume.
- `POST /endpoints/{id}/test` — same.
- `PATCH /endpoints/{id}` — a single handler that inspects the body and dispatches
  to `update`, `getById`, `disable` or `enable`. Four distinct operations sharing
  one route because REST offers one verb for "change this thing".

The `enable` / `disable` pair is the clearest tell. The tRPC router that serves
the settings UI (`server/api/routers/webhookEndpoints.ts`) models these as four
separate procedures — `update`, `enable`, `disable`, `archive` — because the
procedure-call style lets each carry its own input schema and its own
authorization. The REST surface collapses them into one PATCH and then re-derives
the distinction inside the handler at runtime. The same domain, expressed twice,
and the RPC-shaped expression is the one that has been easier to read and to
change.

A second force: **the surface has no installed base.** `/api/webhooks/v1` has
served **zero 2xx responses in production since it shipped** on 2026-08-04.
Of 895 requests over nine days, 865 were 401s (overwhelmingly one scanner burst),
18 were 404s from a security-research scanner probing for an exposed
OpenAI-compatible proxy, and 12 were 403s — the only authenticated attempts, all
from a single organization, every one refused by the enterprise plan gate. There
is no compatibility story to write. This is the last moment the surface can be
reshaped for free, and that timing is why the question is being asked now rather
than deferred to the next family.

## Decision

**We will name the webhooks management endpoints as RPC calls: a dotted
`<resource>.<verb>` path, always POST.**

```
POST /api/webhooks/endpoints.create
POST /api/webhooks/endpoints.rollSecret
POST /api/webhooks/endpoints.listDeliveries
POST /api/webhooks/eventTypes.list
```

The grammar, asserted at registration time by `assertRpcPath` in
`packages/api/src/version-builder.ts`:

```
^/[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$
```

Lower camelCase on both sides of the dot, at least one dot, no path parameters.
A name that does not match fails the build, not review.

Three rules follow, and they are load-bearing:

1. **Every argument travels in the JSON body.** There are no path parameters and
   no query strings. What was `GET /endpoints/{id}/deliveries?limit=50` becomes
   `POST /endpoints.listDeliveries` with `{ id, limit }`. This is the change that
   finally puts zod on the identifiers, which resource-REST never did here.

2. **An RPC with no required arguments declares no `input` schema**, and its
   handler ignores the body. Hono's `zValidator("json", …)` rejects an absent
   body, and the framework only installs that validator when `input` is
   declared — so omitting it accepts both `{}` and nothing at all. Do **not**
   write `input: z.object({}).optional()`; that reintroduces the parse and makes
   a bodyless POST fail.

3. **Reads are POST like everything else.** `endpoints.list` is a POST.

**We will implement this as `v.rpc()` in `@langwatch/api`**, a pseudo-method that
mounts as a real POST. This follows the existing `v.sse()` precedent exactly:
`sse` mounts as a real GET and is special-cased in the pipeline and in the
route-coverage parser. `v.rpc` needs the same three touch-points and no new
concepts. Date-based versioning, forward-copying, `withdraw()`, the policy
registry and the OpenAPI generator all work unmodified, because endpoint identity
is already `` `${method}:${path}` `` and `post:/endpoints.create` is unique.

**We will treat webhooks as a pilot, not as a new default.** The four REST
families stay as they are. This ADR is scheduled for review once the webhooks
family has been in production for one quarter — **review by 2026-11-13** — at
which point we either extend RPC naming to new management families, or revert
webhooks to resource-REST and record RPC as tried and rejected. Two naming
conventions coexisting *indefinitely* is the failure mode this ADR is most
worried about, and a dated review is the mechanism against it.

## Rationale / Trade-offs

**Why not stay on resource-REST for consistency?** Consistency is a real cost and
we are choosing to pay it, for a bounded period, to answer a question we cannot
answer by argument. Four families have shipped REST; none of them has the
verb-heavy shape webhooks has. `roll-secret`, `test`, `enable` and `disable` are
operations, not resources, and REST's answer — invent a sub-resource, or overload
PATCH and branch inside the handler — is exactly the code the migration is
supposed to delete. The pilot exists because the honest comparison needs one real
family on each side.

**Why all-POST rather than RPC names with GET for reads?** Mixing them would mean
the caller has to know which RPC is a read, which is precisely the knowledge the
naming is meant to remove. Uniform POST makes the surface mechanically
predictable: one method, one body, one place to look for arguments.

The cost is real and we accept it knowingly. All-POST **forecloses HTTP-level
caching** for reads and makes every read non-idempotent by HTTP semantics. For
this surface the practical loss is nil — the endpoints are organization-API-key
only, no CDN or intermediary caches them today, and nothing about them is
safely cacheable anyway (delivery health and event lists are live operational
data). But it would be a genuine loss on a high-volume read surface, and that is
a reason this pilot should not silently generalize to one.

Idempotency stays **explicit rather than implied by the verb**. Only
`endpoints.create` carries `withIdempotency`, keyed off the `Idempotency-Key`
header, which is the same protection it had before and is unaffected by the
method change. Its operation key moves from `"webhooks.v1.endpoints.create"` to
`"webhooks.endpoints.create"`; safe, because the dedup window has never had a hit.

**Relationship to ADR-088 (Terraform provider for provisioning).** ADR-088 makes
"could a Terraform provider be built on this without contortions?" the acceptance
test for management APIs, so this ADR has to answer it rather than leave it
inferred. RPC naming does not obstruct a provider. Terraform's resource lifecycle
is create / read / update / delete, and those map onto `endpoints.create`,
`endpoints.get`, `endpoints.update` and `endpoints.archive` one-for-one — arguably
more directly than REST did, since `enable` and `disable` stop hiding inside a
PATCH body and become nameable operations the provider can call explicitly. The
provider talks to a generated client keyed by `operationId`, not by URL shape,
and every operation keeps an explicit `operationId`. What a provider genuinely
needs — stable identifiers, a real read for drift detection, and an update that
does not require resending the whole object — is unchanged.

**Why the grammar is enforced in code.** A naming convention that lives in a
document drifts. `assertRpcPath` costs three lines and makes
`/endpoints.Roll_Secret` or `/endpoints/{id}` a build failure at registration.

## Consequences

**Positive.**

- Every identifier and every filter is zod-validated, because arguments moved
  into `input`. Under REST they were raw `c.req.param("id")` with no schema.
- The overloaded PATCH splits into `endpoints.update`, `endpoints.enable`,
  `endpoints.disable` and `endpoints.archive`, each with its own input schema and
  its own declared permission. Runtime branching becomes routing.
- The REST family and the tRPC router that backs the settings UI now describe the
  same domain in the same shape, which makes the pair far easier to keep honest.
- `operationId` drives both SDKs' method names, so `endpoints.rollSecret` reads
  the same in TypeScript, Python and the CLI.

**Negative.**

- **Two naming conventions in one management API** until the review date. A
  caller using both `roles` and `webhooks` sees two styles. This is the main cost
  and the reason for the dated review.
- HTTP-level caching and HTTP idempotency semantics are foreclosed for reads on
  this family.
- `/api/webhooks/v1/*` is **deleted, not aliased**. Old paths return 404. This is
  only defensible because of the zero-adoption evidence, and the check should be
  re-run immediately before the change lands rather than trusted from this
  document.

**Neutral.**

- Date-based versioning is unaffected. The family pins
  `MANAGEMENT_API_VERSION` (`2026-08-07`) alongside every other org-scoped
  family, and resolves at `/api/webhooks/{date}/…`, `/latest/…` and the bare
  alias identically to the REST families.
- The enterprise gate moves from a bespoke 403 to the shared **402
  `enterprise_plan_required`**, not because of RPC naming but because
  `createManagementService` composes the plan gate for every family it builds.
  Recorded here because it changes a wire code on the same PR.

## References

- Related ADRs: ADR-088 (Terraform provider for provisioning) — the acceptance
  authority this decision is tested against; ADR-045 (handled errors at the
  boundary); ADR-070 (modular package architecture).
- Plan: `dev/docs/plans/webhooks-rpc-api-migration.md`
- Spec: `specs/webhooks/webhook-endpoints.feature`
- Framework: `packages/api/src/version-builder.ts`,
  `platform/app/src/server/api/management/managed-service.ts`
- Review due: **2026-11-13** — extend, or revert and record RPC as rejected.
