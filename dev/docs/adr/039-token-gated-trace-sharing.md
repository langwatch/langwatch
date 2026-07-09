# ADR-039: Token-gated trace sharing (ShareLink)

**Date:** 2026-07-08

**Status:** Accepted

## Context

Trace sharing let an operator publish a public read-only view of a trace at
`/share/<id>`. The `<id>` was a 21-char nanoid — already brute-force-proof — but
it was **not the thing that granted access**. The anonymous data endpoints
(`traces.getById`, `traces.getEvaluations`, `traces.getTracesByThreadId`,
`spans.getAll`, `annotation.getByTraceId`) were gated by
`checkPermissionOrPubliclyShared`, which authorized a read whenever a
`PublicShare` **row existed** for `(projectId, resourceType, resourceId)`. The
caller never presented the share id.

Because trace IDs are caller-supplied (SDK/user), can be sequential, and leak
into logs, webhooks and metadata, anyone who learned a shared trace's ID +
projectId could read the full trace, spans, evaluations and annotations without
ever holding the share link. PR #4692 scoped that lookup to `projectId`, closing
a cross-tenant collision, but the core weakness — authorization by resource
existence rather than secret possession — remained.

Operators also had no control over sharing: every share was public forever, one
share per resource, with no audience scoping and no expiry.

## Decision

We rename `PublicShare` to `ShareLink` (single in-place migration) and move
authorization onto **possession of a secret token plus a signed viewing grant**.

**Model.** `ShareLink` gains: a secret `token` (unique, indexed), an optional
`threadId` (share a trace with its surrounding conversation), a `visibility`
(`PUBLIC | ORGANIZATION | PROJECT`), an optional `expiresAt` (null = never), an
optional `maxViews` (null = unlimited, 1 = single view) and a `viewCount`. The
one-share-per-resource unique constraint is dropped so a trace can carry several
links with different audiences/expiries.

**Token.** `share-lw-` prefix + 32-char nanoid (~190 bits). Stored in plaintext,
indexed and unique — consistent with the pre-existing behaviour (the old id was
already a plaintext capability in the URL and DB), and required for backwards
compat (see below) and for re-displaying a link in the management UI. Hashing at
rest (HMAC, as VirtualKey/API keys do) is a possible future hardening; it is
deferred because it would break link re-display and cannot be backfilled for
legacy rows in raw SQL (no pepper in Postgres).

**Grant exchange.** A new `share.resolve({ token })` mutation validates the token
(exists, not expired, `viewCount < maxViews`, and for `ORGANIZATION`/`PROJECT`
visibility that the caller's session is a member), consumes one view, and issues
a short-lived HS256 JWT (mirroring `gatewayJwt.ts`, signed with
`NEXTAUTH_SECRET`) scoped to that single resource. The grant rides as an
httpOnly, SameSite=Lax cookie, so every subsequent tRPC call from the share page
carries it with zero data-plumbing through the shared `TraceDetails` component.

The HTTP transport is the tRPC fetch adapter behind Hono, which passes no `res`
and whose request shim exposes only raw headers. The cookie is therefore written
via the adapter's mutable `resHeaders` and read by parsing the `Cookie` header —
not via `res.setHeader` / `req.cookies`, both of which are silently absent there.
`share.resolve` fails loudly if it cannot set the grant, rather than returning a
200 that grants nothing.

**Authorization.** `checkPermissionOrPubliclyShared` is reworked: authenticated
users pass on their own permission; otherwise the middleware requires a valid
grant cookie whose claims cover the requested `projectId` + resource. The
resource-existence lookup is removed entirely — this is what closes the
trace-ID-guessing hole. `getTracesByThreadId` reads the grant's `thread_id`: a
thread-scoped share reveals the whole conversation, a trace-scoped one reveals
only the granted trace within it.

**Single view.** One view = one grant issuance. `resolve` is idempotent within
the grant's lifetime (a still-valid grant for the same share re-resolves without
re-incrementing), so a page load's several data calls and in-window refreshes
count once. Re-opening the link after the grant expires re-resolves, which is
denied once the cap is reached.

**UI split.** The share **creation/management** experience moves to the new Trace
Explorer (traces v2), replacing the disabled "Share — soon" placeholder in the
overflow menu. The legacy trace drawer's Share button is removed. The anonymous
**viewer** at `/share/<id>` keeps rendering the existing `TraceDetails`; making
the viewer itself render via traces-v2 would require making ~8 `tracesV2`
endpoints public-share-aware and is left as follow-up.

## Rationale / Trade-offs

A cookie-carried grant was chosen over threading the token as an input param on
every anonymous endpoint because it closes the guessing hole *and* enforces
real single-view (the raw token alone cannot fetch data — only a grant can, and
a grant requires a view-consuming `resolve`) while touching no frontend data
code. The cost is one new small JWT helper and a few lines in
`createTRPCContext` to read the cookie. A single active share-view per browser is
accepted (opening share B overwrites share A's grant cookie); simultaneous
shares in separate tabs is an accepted edge case.

Plaintext token storage is a deliberate, scoped concession (revocable, expiring,
audience-limited capabilities; matches prior behaviour; enables re-display and
trivial legacy backfill) rather than an oversight.

## Consequences

- The trace-ID-guessing and cross-tenant read holes are closed: anonymous reads
  require a signed grant, not a known resource id.
- Operators get audience scoping, timed and single-view expiry, and multiple
  links per trace with a management surface.
- Legacy `/share/<id>` URLs keep working: the migration backfills `token = id`,
  `visibility = PUBLIC`, `expiresAt = null`, and the page resolves by token.
- The plan visibility window and content redaction continue to apply to shared
  views (unchanged — sharing was never a bypass).
- The project kill switch (`traceSharingEnabled` + `revokeAllTraceShares`) is
  preserved.
- The `share.getSharedState` and `share.unshareItem` tRPC endpoints are removed —
  their only caller was the deleted legacy Share button. `ShareService.unshare`
  survives; the legacy trace-delete REST route still calls it.
- Follow-ups: hash tokens at rest; render the shared viewer via traces-v2; offer
  "revoke all links for this trace" in the management UI.

## References

- Spec: `specs/traces-v2/sharing.feature`
- Prior fix: PR #4692 (scope public-share authorization to projectId)
- Templates: `src/server/gateway/gatewayJwt.ts`, `src/server/api-key/api-key-token.utils.ts`
