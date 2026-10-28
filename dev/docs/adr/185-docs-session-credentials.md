# ADR-185: Short-lived credentials for the documentation playground

**Status:** Accepted
**Date:** 2026-10-11, accepted 2026-10-26

## Context

The docs playground sends real requests to the LangWatch REST API. Until now a reader
had to paste an API key. A signed-in reader should be able to use their own access
instead, without the static docs site ever holding a browser session cookie, a refresh
token or a long-lived key.

REST authenticates with API keys; tRPC uses the browser session. Auth owns session
resolution and revocation, and api-key owns minting and verifying credentials
([ARCHITECTURE §8](../ARCHITECTURE.md), [AuthApi](../../../modules/auth/contract/src/auth.api.ts),
[ApiKeyApi](../../../modules/api-key/contract/src/api-key.api.ts),
[session ceilings](../../../modules/api-key/contract/src/api-key.session-ceiling.ts)).
CLI login keys carry refresh tokens and run keys are reused across a run; neither is
given to the docs. "Docs session key" below means an expiring key minted for this flow
only, not an Enterprise gateway virtual key.

## Decision

### Scope

A docs session key acts as the signed-in member in **one project they choose**, with
**everything that member may do there**. It holds no permission of its own: every
request is authorised against the member's current grants in that project, so a
permission or membership the member loses is lost by the key on the next request,
including own-only trace restrictions. It never reaches another project or the
organisation's settings.

### Flow

1. The reader presses **Use my LangWatch account** in the playground. The docs open the
   configured app's `/connect/docs` page in a popup, passing a fresh 256-bit random
   `state` (single use, valid for two minutes, held in tab memory) and the docs origin.
   The docs keep the popup reference.
2. The app signs the reader in if needed. The consent page shows the requesting docs
   origin, a project picker over the member's projects, what the key may do ("anything
   you can do in this project"), and its expiry. It refuses an impersonated session, and
   it refuses an origin that is not registered for docs (see Origins).
3. On **Allow**, the page calls the session-authenticated tRPC mutation
   `apiKey.mintDocsSessionKey`, which mints the key for the chosen project. On **Deny**,
   it mints nothing.
4. The popup posts the result to the exact docs origin with `postMessage` (never `*`):
   `{ type: "langwatch:docs-session", version: 1, state, outcome: "granted", token,
expiresAt, expiresIn, project: { id, name } }`, or `outcome: "denied"`. It then closes.
   The docs time the key from `expiresIn` (seconds) on the page's monotonic clock, so a
   reader's wrong clock cannot stretch or cut it; `expiresAt` is for the app's own records.
5. The docs accept a message only when `event.origin` is the configured app origin,
   `event.source` is that popup, `state` is the unused value, and the payload parses.
   They consume the state, drop the listener and forget the popup. A spoofed, replayed,
   late or malformed message is ignored.
6. The key lives only in memory. It never enters a URL, storage, a generated example,
   the clipboard, analytics or a log. Requests send it as `X-Auth-Token`, omit
   cookies, refuse redirects, and go only to the configured app origin's `/api`.

### Lifetime and failure

The key expires at the earliest of **five minutes**, the browser session's expiry and the
organisation's session ceiling. There is no refresh and no silent renewal: reconnecting
asks for consent again.

- Expiry, a 401 response, **Disconnect**, leaving the page or changing project clears the
  key and cancels pending requests.
- A 403 response reports that the member's access does not allow the request, without
  retrying or switching to a pasted key.
- A blocked or closed popup, a denial or a two-minute timeout leaves the pasted-key path
  available, and says which happened.

### Storage and revocation

A docs session key is an `ApiKey` row with `isSystemManaged` set (hidden from the
API-keys page, refused to customer edits), the member as owner, the one project, an
expiry, and the id of the browser session that minted it. Only the hashed secret is
stored.

- **Disconnect** clears the key in the tab at once and asks the REST API to revoke it,
  authenticated by the key itself (`DELETE /api/docs-session`): a docs session key may
  always revoke itself and nothing else. If revocation fails, the docs say the
  disconnection was local and the key still expires within five minutes.
- Signing out of the app, or revoking the browser session, revokes every docs session
  key that session minted, through `ApiKeyApi.revokeDocsSessionKeys`, before the normal
  revocation completes. It reuses api-key's revocation cache semantics: normally
  immediate, at most five seconds on the documented cache-failure path.
- Clearing the docs tab never claims to sign the reader out of the app.

### Origins

- The app keeps an exact allowlist of docs origins. LangWatch Cloud registers
  `https://langwatch.ai`. A self-hosted install registers its own through configuration;
  without one, only the app's own origin is accepted, which is where haven and a
  same-host install serve the docs (`/docs`). No suffix, substring or wildcard match,
  and no localhost exception unless configured.
- The docs know the app origin from their build configuration (default
  `https://app.langwatch.ai`), never from the current URL. A build without one shows
  only the pasted-key path.
- The API answers CORS preflights for registered docs origins only, for the methods
  the REST API uses and the `X-Auth-Token`, `Authorization`, `Content-Type` and
  `Idempotency-Key` headers (a pasted bearer key and the declared header parameter),
  without credentials. Same-origin docs need no CORS at all.
- The docs offer the session only on operations that take `X-Auth-Token`; an operation
  on another scheme keeps the pasted key, so a project key never meets another door.

### Ownership and authorisation

- `ApiKeyApi.mintDocsSessionKey` takes the verified caller and browser session, the
  chosen project and the docs origin, and returns the one-time token, its expiry and the
  project's name. The tRPC procedure declares its permission on the chosen project at
  the door (`.withPermission(...)`) and requires the browser session; it is not
  reachable by an API key. The service keeps the impersonation guard for every caller.
- `ApiKeyApi.revokeDocsSessionKeys` revokes one docs key (the presenting key, for
  Disconnect), or every docs key minted by a browser session (for sign-out). It is
  idempotent and discloses nothing about other keys. Auth's logout and session
  revocation call it.
- No AuthApi operation is added. The consent page and its handoff use
  `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. The popup GET has no
  side effect; minting is the tRPC mutation, under the existing session CSRF checks.

## Consequences

- A signed-in reader tries any endpoint they may call, against their own data, with a
  key that dies in five minutes and with their session.
- A copied key is still a bearer token until it expires or is revoked; this design does
  not bind it to the tab cryptographically. That would need a proof-of-possession
  scheme, which is out of scope.
- An XSS on the app or a registered docs origin could take a key; origin checks do not
  prevent that. The five-minute life and session revocation bound it.
- Sandbox projects and Langy access are separate decisions and are not part of this.

## Rejected

- **Sending the session cookie from the docs:** the docs would hold app authority, and
  CSRF protection on REST would have to change.
- **A trace-reading preset only:** the playground covers the whole API, and a member's
  own grants already bound what the key can do.
- **A full-page redirect carrying the token:** tokens must never enter a URL.
- **A device code (RFC 8628), alone or as a fallback (2026-10-28):** whoever starts a grant
  receives the key that the approver approves, so anyone who gets a reader to approve a code
  holds a key acting as that reader. The popup returns the key only to the frame that opened
  it, and storage partitioning leaves no way to bind a device approval to the reader's browser.

## Amendment, 2026-10-28: the key stays on the app's origin

### Context

The docs carry analytics on purpose: Google Tag Manager and PostHog run on
`https://langwatch.ai`, the marketing site and the docs alike. Whoever can publish a tag or
change the PostHog project can run code on that origin, and code on the docs' origin reads
whatever the docs page holds. A key posted to the docs page therefore belongs to every tag
vendor too. No handoff fixes that, a device code included: the page that polls for the token
holds it. What fixes it is that the token never enters the docs page.

### Decision

- **A frame on the app's origin holds the key.** The playground embeds
  `/connect/docs/frame?origin=<docs origin>`, a small document the API host serves on the
  app's origin. Its policy allows only its own nonce'd script, requests to its own origin and
  framing by the one docs origin its `origin` names, which must be registered. An unregistered
  origin gets a refusal page that nothing may frame. The frame runs no analytics.
- **The connect button is inside the frame.** The frame opens the consent popup; the popup
  posts its answer to the frame at the app's own origin, with the same message, state and
  checks as before. A script on the docs page cannot press the button or receive the answer.
- **The frame sends the requests.** The docs page asks the frame to send a request to a path
  under `/api`, and the frame adds `X-Auth-Token` and answers with the response. It accepts a
  request only from its parent at the docs origin. A request that is not a `GET` waits for the
  reader to press Send inside the frame, which names the method, the path and the project.
- **What stays.** The mint, the five-minute life, the consent page, revocation on sign-out and
  `DELETE /api/docs-session` are unchanged; the frame calls them on its own origin. Expiry, a
  401, Disconnect and the frame unloading still clear the key. REST keeps its CORS allowance
  for registered docs origins, because a pasted key is still sent from the docs page.

### Consequences

- A tag or any other script on the docs' origin can no longer read or copy a docs session key.
- While the frame is connected, such a script can still ask it for reads and see the answers
  the page shows. It cannot change anything without the reader pressing Send in the frame.
  A script that also restyles the frame could trick that press; the frame counts only a press
  that begins after a short delay, never focuses Send itself, and does not otherwise defend
  against it.
- The docs' Tag Manager refuses Custom HTML and custom JavaScript tags before the container
  loads, so publishing a tag cannot add arbitrary code there; vendor tags run as gallery
  templates, each limited to the hosts it declares. The Meta pixel and Reo.dev, which the
  container runs as Custom HTML, are loaded by the page itself instead. All of it loads only
  after the reader accepted cookies.
- Supersedes steps 4 to 6 of the Flow, and the XSS consequence above for the docs' origin. An
  XSS on the app's origin still takes the key.
