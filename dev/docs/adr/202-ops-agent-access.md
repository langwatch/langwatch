# ADR-202: Ops agent access through passkey-approved, one-hour keys

**Date:** 2026-11-02

**Status:** Accepted

## Context

Operators answer production questions with standing database access (`tools/prod/pg.sh`,
`ch.sh`, kubectl exec). That access is broad, reads are not audited, and customers cannot see
it. Coding agents now do much of this work, and they follow instructions from whatever they read,
including trace content written by a customer's end users.

## Decision

We will give an operator's coding agent access only through the public REST API and the
`langwatch` CLI, approved per use:

- An operator with a passkey enrols an agent on `/ops/agents` and gets a 90-day requester key.
  The requester key can create approval requests, poll their status, redeem them and end its own
  sessions, and nothing else. Revoking the agent ends its live sessions and undecided requests.
- The agent asks for scopes, at most one organization and a reason, binding a PKCE S256
  challenge. A request lasts 10 minutes; a requester may make 5 an hour.
- Only the requester's owner can open the approval page. The page shows organization, scopes,
  reason, machine and IP. The WebAuthn challenge is the SHA-256 of exactly those fields plus the
  spend tick and expiry, verified with user verification required. `org:content` and
  `org:support` need the organization name typed, with or without spend.
- The agent redeems once with the verifier and its requester key, from the same address the
  request came from and the operator saw. A request or redeem with no address is refused. That
  address is pinned. The agent gets a 1-hour key with no refresh.
- Organization reach is an ownerless, system-managed, restricted API key: "LangWatch Staff Read"
  (`staff-reader`) or "LangWatch Support" (`staff-support`). The bags exclude credentials,
  members, SSO, roles, keys, billing and every delete or manage permission. Prompt text
  (`prompts:view`) is in the content bag. The support bag holds no prompt or trigger write. No
  impersonation and no fake user.
- Cross-organization reads are an allowlist on a separate `staff_access` door answering the new
  platform-tier permission `opsRead:view`, never `ops:view`.
- Every request by such a key passes a staff access gate in the REST runtime, bound by the
  `staff-access` module the way Langy binds its confirmation gate. The gate writes a trail row
  before the handler and refuses the request when that write fails. Writes also land in the
  customer's audit log with the approver and the reason.
- The gate fails closed. A route's kind comes from its declaration (`routeWrites`): GET, HEAD and
  OPTIONS are reads, and so is a POST declared `withoutAudit("read sent as a POST")`; every other
  route is a write, whatever permissions it asks.
- A write passes only when the session was approved with the spend tick, or when every
  permission it asks is in `STAFF_WRITES_WITHOUT_SPEND` (`datasets:create`, `datasets:update`).
  Otherwise it is refused with `staff_spend_not_approved`, including a write that asks no
  permission. A route with a confirmation (`.withConfirmation`) is always refused with
  `staff_write_not_allowed`, even with spend.
- A route that starts a run (`withoutAudit("run, not a change")`) must declare `.spends()` or
  `.withoutSpend("<reason>")`; the declaration throws otherwise. A `.spends()` route is refused
  without the spend tick.
- A route that serves customer content under a metadata permission declares `.servesContent()`
  and is refused with `staff_content_not_approved` unless the session has `org:content`.
- Every refusal of a staff key with a known session writes a trail row with its status and error
  code: the gate's own refusals, and those before it (door permission, scope, plan, second
  factor), which the runtime reports through `gate.refused`.
- LangWatchQL `eval()` functions are off for a staff key whose session has no spend approval.
  Public health probes treat a staff key as no key.
- An approval is claimed as `approving`, written to the customer's audit log, and only then
  confirmed as `approved`. An `approving` request is never redeemable, so a failed write or a
  crash leaves no approval without its row.
- Approval, revoke and natural expiry each write a customer audit row, naming the approver and,
  on a revoke, the operator who revoked. An end is marked audited only after its row is written;
  a scheduled sweep retries every end not yet written, including a key revoke that failed.
- Every enrolment, approval, redeem and agent revoke emails the other platform operators. The
  emails inform; they do not hold anything back.
- A kill switch ends every live session and undecided request, and answers how many ended and
  how many failed.
- The feature is off unless cloud ops and the `ops_agent_access_enabled` flag are both on.

## Rationale / Trade-offs

Impersonation was rejected: it is always one person's full reach, writes included, and
browser-only by design. A fake support member would count as a seat and hide who acted. An
API key already has hashing, expiry, grants, revocation and CLI support.

The approval is a signature over one request, not a fresher session, so it does not reopen the
no-step-up rule of `specs/identity/mfa-and-session-shape.feature`.

The `opsRead:view` answer for the `staff_access` door comes from the approved session row rather
than an authz grant, because authz platform grants are per person. Moving it into authz would let
platform grants name a key principal; that is a larger change left open.

The request, status, redeem and end routes use the `staff_access` door, which accepts only a
requester key or an ops token and nothing else. No other door accepts a requester key, so it
cannot reach any customer route.

## Consequences

- What a customer's audit log shows depends on the scope. `ops:read` reaches no single
  organization and writes no customer row. `org:metadata` and `org:content` write the approval and
  the end; their reads stay in our own trail, not in the customer's log. `org:support` also writes
  a `staffAccess.write` row for each change. The audit log page is an Enterprise feature, so other
  plans do not see these rows in the product.
- Spend control on run routes is enforced at declaration. Content control depends on routes
  declaring `.servesContent()`; a new content route under a metadata permission without it is
  open to an `org:metadata` key. Route review must check this. A missed write is refused, not
  let through.
- Customer-facing creator fields on evaluators, monitors, datasets and triggers do not exist, so
  "LangWatch Support" shows in the audit log rather than on every object.
- The standing database paths are a gap: an agent running on a machine that holds production
  database credentials can skip this flow. Until agents run without those credentials,
  `org:content` and `org:support` stay off in production and only `ops:read` and `org:metadata`
  are used. Closing that path has its own follow-up issue.

## References

- Specs: `modules/staff-access/specs/`
- ADR-161 (impersonation scope), ADR-185 (docs session keys)
