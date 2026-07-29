# ADR-057: Token-gated trace sharing (ShareLink)

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
authorization onto **possession of a secret token, presented to a single public
aggregate endpoint**.

**Model.** `ShareLink` gains: a secret `token` (unique, indexed), an optional
`threadId` (reserved for sharing a trace with its surrounding conversation, and
left unpopulated while that is parked — see Consequences), a `visibility`
(`PUBLIC | ORGANIZATION | PROJECT`), an optional `expiresAt` (null = never), an
optional `maxViews` (null = unlimited, 1 = single view) and a `viewCount`. The
one-share-per-resource unique constraint is dropped so a trace can carry several
links with different audiences/expiries.

**Token.** A bare 32-char nanoid (~190 bits) — deliberately unprefixed, unlike
the `xx-lw-` credentials, because its only home is the `/share/<token>` URL
where a prefix would stutter and buy nothing. Stored in plaintext,
indexed and unique — consistent with the pre-existing behaviour (the old id was
already a plaintext capability in the URL and DB), and required for backwards
compat (see below) and for re-displaying a link in the management UI. Hashing at
rest (HMAC, as VirtualKey/API keys do) is a possible future hardening; it is
deferred because it would break link re-display and cannot be backfilled for
legacy rows in raw SQL (no pepper in Postgres).

**One public read.** A single `sharedTrace.get({ token })` query is the entire
anonymous surface. It validates the token via `ShareService.resolveForViewer`
(exists, sharing enabled, not expired, view available, and for
`ORGANIZATION`/`PROJECT` visibility that the caller's session is a member),
consumes one view, and returns everything the read-only page renders —
project chrome, trace header, span waterfall, full span detail, signals,
resources, events, evaluator verdicts — as one explicit `SharedTraceDto` the
router builds field by field. Failures are typed share `HandledError`s
(`share_link_not_found` / `expired` / `exhausted` / `forbidden`) mapped to wire
codes by `handledErrorMiddleware`; a bad token and a link behind the sharing
kill switch are deliberately indistinguishable.

**Authorization.** Every internal read (`tracesV2.*`, `traces.*`, `spans.*`,
`annotation.*`, `project.*`) is `protectedProcedure` again;
`checkPermissionOrPubliclyShared`, the resource-existence lookup, and the
whole grant/cookie layer are deleted. Authorization for anonymous viewers
happens exactly once, in `resolveForViewer` — this is what closes the
trace-ID-guessing hole.

The payload is bounded in two independent ways. Its **shape** comes from
`sharedTrace.schemas.ts`, which builds each section as an explicit `.pick()`
from the corresponding internal read schema and is applied as the procedure's
tRPC `.output()` parser: Zod strips keys the schema does not name, server-side,
so a new column on an internal read is dropped at the share boundary instead of
silently published. Two fields are *pinned* rather than omitted — `header.userId`
to `null` and evaluator `error.stacktrace` to empty — because for those an
omission would be indistinguishable from a legitimately absent field, and a
redaction regression should fail loudly (a parse error) rather than quietly. The
trade is deliberate: the parser fails closed, so schema drift surfaces as a
broken share page rather than an unreviewed disclosure, and the blast radius is
the anonymous share surface only.

Its **values** come from the share gates (`gateHeaderCost`, `gateTreeCost`,
`gateResources`, `gateEvaluations`, `applyDerivedTraceEventProtections`), which
redact per viewer. Both halves are unit-tested as a leak-prevention contract
(`sharedTrace.shareSafe` for values, `sharedTrace.outputSchema` for shape), and
a public-surface allowlist test walks the real router map so adding any new
`publicProcedure` fails the suite.

**Single view.** Every resolve consumes exactly one view, atomically: the
consume is a conditional `UPDATE … WHERE viewCount < maxViews`, so two
simultaneous opens of a single-view link admit at most one viewer. A page load
counts once because the page, the layout chrome and every drawer hook share one
React Query key (`sharedTrace.get({ token })`) and dedupe onto a single request.

A view is a *viewing*, not an HTTP request. Within a 30-minute window the same
viewer re-opening a link — a refresh, a restored tab — does not consume another,
via a Redis `SET NX` keyed on the share id and a hash of the viewer's IP and
user agent (`ShareViewDedupeService`, mirroring the span-dedupe service). Without
this a single-view link dies the moment its recipient presses refresh, which is
not what an operator means by "one view". This is accounting only: authorization
is re-evaluated in full on every request, so a revoked, expired or kill-switched
link stops resolving immediately, and no cookie, session or grant is introduced.
The dedupe fails toward consuming — a Redis outage must not become a way to read
a single-view link repeatedly. The viewer hash is held only for the window and
is never stored or logged.

**Cost of the anonymous surface.** `sharedTrace.get` is the one trace read the
open internet can drive, and each call costs five ClickHouse reads plus a view
write, so it is bounded three ways. It is rate limited per token *and* per IP
(via the existing `rateLimit` helper) — per-token alone would let one host
spread load across many leaked tokens, per-IP alone would let a distributed
caller hammer one link. The assembled payload is cached for 60s, keyed by token
plus a fingerprint of the viewer's `protections` so two viewers with different
redactions can never share an entry; the cache is consulted only *after* the
token resolves, so it can never serve a revoked link, and a hit is re-parsed
through the output schema so a stale entry from an older deploy is stripped to
today's contract. And `spansFull` is capped at `SHARE_MAX_FULL_SPANS`: the
waterfall stays complete, per-span detail stops, and the payload flags it
(`isSpanDetailTruncated`) so the viewer says so rather than silently showing an
empty detail pane. Lifting that cap properly means a token-validated
`sharedTrace.spanDetail` — a follow-up.

**UI.** The share **creation/management** experience moves to the new Trace
Explorer (traces v2), replacing the disabled "Share — soon" placeholder in the
overflow menu. The legacy trace drawer's Share button is removed.

The anonymous **viewer** at `/share/<token>` renders that same Trace Explorer
surface, full-page. The drawer body is extracted into `TraceDrawerContent`,
shared by the drawer shell (inside `Drawer.Root`) and the share page (inside a
plain flex column) — the shell keeps only chrome: width, resize rail, dock,
keyboard help, close.

Three mechanisms make that safe. `SharedTraceProvider` carries the one
`sharedTrace.get` payload; the drawer's per-trace hooks (`useTraceHeader`,
`useSpanTree`, …) read their slice from that context instead of firing their
own (now protected) reads. `TraceViewerContext` supplies the `traceId`,
overriding the drawer store so the app-wide `GlobalTraceV2DrawerMount` stays
inert and no drawer opens over the page. The same context carries `readOnly`,
which unmounts every affordance that mutates or needs a session (rename,
refresh, maximize, dock, close, overflow menu, share dialog, back-history) and
disables the queries behind them (`pinnedTrace.getPin`, `share.listForResource`,
`scenarios.getRunState`, `prompts.getByIdOrHandle`, `traces.getEvaluationInputs`,
`ops.getScope`, presence SSE + cursor broadcast). `readOnly` is a *rendering*
concern, never a security boundary — the anonymous payload is authorized and
gated once, server-side.

Conversation view is suppressed for read-only viewers because it is backed by
`tracesV2.list`, the traces-table query with arbitrary filters, which must never
open to anonymous callers. Rendering a thread-share's conversation from the
aggregate payload is the follow-up.

## Rationale / Trade-offs

One aggregate endpoint was chosen over a grant cookie + per-endpoint checks
(an earlier iteration of this ADR) because scattering share-awareness across
~11 read endpoints is exactly how the original leak happened: every new read
is a new place to forget the check. With a single public read there is one
authorization point, one explicit DTO to review, and a tripwire test on the
public surface. The costs: the share page renders from a context payload
instead of live queries (no SSE/live updates on a share — fine for a
read-only snapshot), and the payload is assembled server-side in one shot
(five ClickHouse reads, partition-pruned via the summary's timestamp).

Plaintext token storage is a deliberate, scoped concession (revocable, expiring,
audience-limited capabilities; matches prior behaviour; enables re-display and
trivial legacy backfill) rather than an oversight.

## Consequences

- The trace-ID-guessing and cross-tenant read holes are closed: the only
  anonymous read requires the secret token, not a known resource id.
- Content protections apply to every share-payload field: costs follow the
  caller's own `cost:view`, event/exception attributes and evaluator
  `details`/error text follow content visibility, stacktraces and evaluator
  `inputs` are never shared, restricted attributes are redacted.
- Operators get audience scoping, timed and single-view expiry, and multiple
  links per trace with a management surface.
- Legacy `/share/<id>` URLs keep working: the migration backfills `token = id`,
  `visibility = PUBLIC`, `expiresAt = null`, and the page resolves by token.
- The plan visibility window and content redaction continue to apply to shared
  views (unchanged — sharing was never a bypass).
- The sharing kill switch is two-level, mirroring `presenceEnabled`:
  `Organization.traceSharingEnabled` is the org-wide switch and
  `Project.traceSharingEnabled` scopes the kill to one project. Effective
  sharing is `org AND project` — checked both at create time
  (`ShareService.isTraceSharingEnabled`, via `getTraceSharingConfig`) and at
  resolve time (`resolveForViewer` reads the org flag through the share's
  project→team→organization relation). Disabling at either level revokes the
  existing links (`revokeAllTraceShares`, fanned across every project in the org
  when the switch is org-level) so re-enabling never resurrects old links. A
  link behind a disabled switch resolves like a bad token (indistinguishable).
- The `share.getSharedState` and `share.unshareItem` tRPC endpoints are removed —
  their only caller was the deleted legacy Share button. `ShareService.unshare`
  survives; the legacy trace-delete REST route still calls it.
- `TraceDrawerContent` is now the seam any future full-page trace surface should
  reuse; the shell is chrome only.
- Thread sharing is **parked**, not half-built: `createShare` accepts `TRACE`
  only and nothing binds a link to a conversation, so the system cannot mint a
  capability the viewer is unable to redeem. The `ShareLink.threadId` column
  stays, unpopulated, for when the aggregate can carry the surrounding turns.
- Follow-ups: hash tokens at rest; carry the surrounding conversation in the
  aggregate for thread shares, then re-introduce thread-typed links and the
  "Include the conversation" option; a token-validated `sharedTrace.spanDetail`
  so large traces keep full detail instead of being capped, which would also
  carry per-span events (and the llm ancestor-prompt enrichment) so shared span
  detail matches `tracesV2.spanDetail`; offer "revoke all links for this
  trace" in the management UI; a purpose-built public page shell instead of
  `DashboardLayout publicPage`.

## References

- Spec: `specs/traces-v2/sharing.feature`
- Prior fix: PR #4692 (scope public-share authorization to projectId)
- Templates: `src/server/gateway/gatewayJwt.ts`, `src/server/api-key/api-key-token.utils.ts`
