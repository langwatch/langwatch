# ADR-180: Short-lived credentials for the documentation playground

**Status:** Draft, awaiting product-owner approval. App operations below are proposals only.
**Date:** 2026-10-11

## Context

The static docs site must not receive a browser session cookie, refresh token or
long-lived API key when a signed-in user opens its playground. REST currently
uses API-key authentication; tRPC uses the browser session. Auth owns session
resolution and revocation, while api-key owns credential minting and verification.
See [ARCHITECTURE §8](../ARCHITECTURE.md),
[AuthApi](../../../modules/auth/contract/src/auth.api.ts),
[ApiKeyApi](../../../modules/api-key/contract/src/api-key.api.ts) and
[session ceilings](../../../modules/api-key/contract/src/api-key.session-ceiling.ts).

Existing CLI sessions include refresh tokens; run keys have a different lifetime
and reuse policy. Neither is handed to the docs. “Virtual token” here means an
expiring docs credential, not an Enterprise gateway virtual key.

## Proposed flow

1. A click on **Use my LangWatch session** opens the configured app's `/docs/connect`
   page. The docs create a cryptographically random 256-bit, single-use state value in tab
   memory, valid for two minutes, and retain the popup reference. Only exact configured HTTPS app/docs
   origins are accepted. No caller-supplied arbitrary return URL is followed.
2. The app signs in normally if necessary, resolves its existing browser session,
   and shows the docs origin, one selectable project, permitted actions and expiry.
   Consent is explicit. An impersonated session cannot mint a credential.
3. An app-origin, session-authenticated tRPC mutation mints a key limited to the
   selected project and a server-owned capability preset. Initially this is
   `traces:view` for the trace-reading playground. Other operations remain manual
   until separately approved. The grant ceiling is the intersection of the
   preset and the caller's current grants, including own-only trace restrictions.
4. The popup sends `{type, version, state, credential}` to the exact docs origin
   with `postMessage`, never `*`. The docs accept only the expected app
   `event.origin`, that exact popup as `event.source`, the unused state, and a
   schema-valid payload. They consume the state once, remove the listener, and
   close the popup. A spoofed, replayed, late or malformed message is ignored.
5. The credential lives only in memory. It never enters a URL, storage, example,
   clipboard, analytics payload or log. Requests use `X-Auth-Token`, omit cookies,
   and refuse redirects. The destination must match the configured API origin and
   approved operation. Client checks are defence in depth; the API independently
   verifies the credential, project and current permissions on every request.

The token's expiry is the earliest of five minutes, browser-session expiry and
organisation session ceilings. No refresh token or silent renewal reaches the
docs. Expiry, a 401, disconnect, page exit or a project change clears the credential
and cancels pending work. Reconnection requires another explicit consent flow.
A 403 reports insufficient scope without widening permissions or retrying under a
manual key. A blocked/closed popup, denial or timeout leaves the manual-key option
available. A full-page redirect variant is deferred; tokens must not be put in its
URL if that variant is later approved.

## Tab association and sandbox scope

A random tab-flow identifier correlates consent and a grant; it does not make a
bearer credential non-transferable. Memory-only storage and a five-minute ceiling
limit exposure, but a copied credential can still be used until expiry or server
revocation. Cryptographic tab binding would require a separately designed
proof-of-possession protocol using a per-tab non-exportable key and API-side
request-proof validation. The current proposal does not claim that guarantee.

Sandbox access is a separate product decision. A sandbox must be an explicitly
selected, isolated project with its own grants and lifecycle; the playground must
not silently turn a production request into a sandbox request or widen a read
preset into write access. No sandbox provisioning is included in this proposal.

## Ownership, CSRF and revocation

Minting declares `.mintsCredential(...)`, project-scoped permissions and verified
`browserSessionContext` at the tRPC door. The exact preset's permissions must be
approved before implementation. Do not add a session-authenticated REST mint or
use `anyAuthenticated` followed by a handler permission check. Services retain the
existing impersonation guard for non-transport callers. No permission supplied
by the docs is trusted as authority.

App mutations retain the existing session CSRF protections and require an exact
app Origin. The popup GET has no minting side effect. The app also validates the
docs-origin allowlist and binds consent/state to its own session. Consent and
handoff pages use `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
Popup opener isolation must be configured deliberately for this one flow; do not
weaken the whole app's policy. Origin checks do not prevent theft by an XSS on a
trusted origin, nor make a bearer token proof of origin outside a browser.

The API enables CORS only for explicitly registered docs origins and the required
headers/methods, without credentialed cookies or wildcard origins. A docs-purpose
and parent-browser-session association are new server work, not properties that
existing `ApiKey.create` already guarantees. Persist only a hashed credential,
owner, project, effective grants, audience/purpose, expiry and parent session id.

App logout/session revocation must revoke the linked docs credentials through
api-key before completing its normal revocation flow. Reuse api-key's existing
revocation/cache semantics (normally immediate; at most five seconds on the
documented cache-failure path). Membership or permission loss must also refuse
subsequent calls. The popup can notify an open docs tab, but server revocation is
the authority because a popup may already be closed. Docs disconnect clears local
state immediately and requests revocation through an app-owned flow; failed
revocation leaves the short expiry as a bound and reports that disconnection is
local. Never claim to sign the user out of the app by clearing docs memory.

## Proposed app-side operations, not implemented

- **`ApiKeyApi.mintDocsSessionKey`**: takes the verified caller/session context,
  selected project, registered docs origin and approved capability preset. Mints
  a fresh, parent-session-bound, narrowed credential with the capped expiry and
  returns its one-time secret plus public grant metadata. Proposed tRPC procedure:
  `apiKey.mintDocsSessionKey`, used only by the app consent page.
- **`ApiKeyApi.revokeDocsSessionKeys`**: revokes one docs grant owned by the caller,
  or every docs grant linked to a browser session during logout/revocation.
  Idempotent; no cross-user revocation or existence disclosure. Proposed tRPC
  procedure: `apiKey.revokeDocsSessionKeys` for the caller's disconnect flow.
  Auth's existing logout operations call the same peer operation internally.

No new AuthApi operation is proposed: reuse its session resolution and logout
operations. The app consent page, tRPC declarations, API verification changes and
revocation wiring all require approval and are absent from this change.

## Self-hosting and later Langy access

Self-hosted installs opt in with explicit app, API and docs origins; no SaaS host
is inferred from the current URL. Unsupported or unconfigured installs show the
manual-key flow. Development localhost exceptions must be explicit, never suffix
or substring matches. A hosted docs site connecting to a private install requires
operator consent and browser network reachability; it is not enabled by default.
Langy gets a separately approved capability/audience and consent prompt later;
the trace preset must not silently grow into agent execution or write access.

## Implemented docs seam

The default flag is off. `VITE_DOCS_SESSION_AUTH=mock` exposes the provider slot,
connection, expiry and disconnect states with a demo project and simulated trace
response. The mock credential lasts one minute and cannot authorise a real API
request. No popup adapter, message listener or real server operation is implemented.
See [docs feature scenarios](../../../docs/site/specs/shared-auth.feature).
