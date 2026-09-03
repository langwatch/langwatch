# @langwatch/egress

The fence outbound requests leave LangWatch through.

Three layers, bottom up:

1. **The address policy** (`src/ssrf/`) — which destinations may be reached at
   all, and at which resolved IP. Cloud metadata endpoints and cloud-internal
   domains are refused unconditionally; private, loopback, link-local and every
   other non-globally-routable range is refused when the policy says so, using
   the `src/ssrf/address.ts` classification table the Go services share. The name is
   resolved once and the connection is pinned to that address, so a rebind
   cannot move the destination between the decision and the socket.
2. **The fenced fetch** (`src/ssrf/fenced-fetch.ts`) — the only way a validated
   destination is actually contacted. `redirect: "manual"` always; a hop is
   either refused or re-judged, never taken on the receiver's say-so.
3. **The webhook sender** (`src/webhook/`, `src/services/`) — the customer-
   supplied destination on top of both: the admission policy (https, default
   port, no credentials), the hourly dispatch cap, the Stripe-style signature,
   the response caps and the retry-vs-terminal classification.

## Why it is a package and not a feature

Three callers owe the same answer — the graph-alert half of Automation running
in a background process, the Enterprise webhook endpoints platform, and any
transport that wants the same fence. `architecture-lint`'s `cross-feature`
policy forbids one feature's server package from depending on another's, so no
feature home is reachable by all three. This is a shared non-feature package for
that reason, and because the fence is egress policy rather than any one
feature's asset.

## Frozen twin (historical)

This package started life as a frozen twin of the SSRF and webhook-sending
code that used to live under `platform/app/src/server/webhooks/` and
`platform/app/src/utils/ssrfProtection.ts` — a few source comments still name
that twin for provenance. `platform/app` is deleted, so there is no longer a
live counterpart to drift from: this package is now the sole, canonical
implementation, used directly by `apps/worker`'s webhook and gateway-spend
composition, the enterprise webhook feature's destination adapters, and the
model-provider egress adapter. The rules stay pinned as literals in this
package's own tests rather than read out of a caller's source, so a rule
quietly loosening and delivering to an address it should have refused still
fails here even with no twin left to compare against.

The signature is pinned against `specs/webhooks/signature-vectors.json`, the
same committed vectors the TypeScript and Python SDKs verify against.

## What a caller must supply

Nothing here reads the environment. A composition root states:

- the **TLS policy** (`rejectUnauthorized`), which the application ties to
  `IS_SAAS` because on-prem receivers frequently carry self-signed certificates;
- the **dispatch counter** (`WebhookDispatchRateLimiterPort`), because the cap
  has to hold across a fleet and only the process knows what its fleet shares;
- the **escape hatch**, per send, for the endpoints platform's opt-in to
  plain-http internal receivers.

An admission this package cannot evaluate refuses. There is no default address
policy, and a redirect that cannot be re-judged is not followed.
