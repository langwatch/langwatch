# ADR-045: Handled errors as the handled-error boundary (TS `HandledError` ⇔ Go `herr`)

**Date:** 2026-07-10

**Status:** Accepted

## Context

An error crossing an API boundary is one of two things, and the difference is
the whole point:

1. **Handled** — we understand what happened and the caller can act on it. "That
   evaluator doesn't exist." "You don't own this conversation." "The query timed
   out." "That model isn't configured." These have a stable identity, a
   user-relevant message, and structured context worth putting in front of a
   person.
2. **Unhandled** — something we did not anticipate. A Postgres connection drop, a
   nil dereference, a ClickHouse OOM, a bug. These have no user-relevant meaning.
   The caller cannot act on the raw detail, and presenting it as if they could is
   both a poor experience and a leak surface.

The platform already has the machinery for (1): the app-layer `HandledError`
(`src/server/app-layer/handled-error.ts`) — an abstract `Error` subclass carrying
a serialisable `code`, `meta`, `traceId`/`spanId` (captured from the active OTel
span), `httpStatus`, and a `reasons` cause chain, with a `serialize()` producing
`SerializedHandledError`. It is wired into both transports:

- **tRPC** (`src/server/api/trpc.ts`): a `handledErrorMiddleware` converts a
  `HandledError` thrown in a procedure into a correctly-coded `TRPCError` (via
  `handledErrorToTRPCCode`), and the `errorFormatter` calls `.serialize()` and
  attaches the result to the error's `data.domainError`.
- **Hono** (`src/app/api/middleware/error-handler.ts`, wired by every
  `createServiceApp` at `SecuredApp.onError`): a `HandledError` becomes
  `{ error: code, message, ...meta }` at its `httpStatus`.

The Go services have the exact same split in `pkg/herr`: a handled error is an
`herr.E{ Code, Meta, TraceID, SpanID, Reasons }` created deliberately via
`herr.New(ctx, code, meta, reasons...)`; anything else is a plain `error`.
`herr.WriteHTTP` serialises the handled shape and **strips the stack and any
non-`herr` reasons** before they leave the process.

What is missing is not machinery but **discipline and reach**. Large parts of the
codebase — the Langy route is the clearest offender — hand-roll
`c.json({ error: "..." }, { status })` with generic strings, or wrap unknown
failures in ad-hoc `extends Error` classes, bypassing the `HandledError` path
entirely. The result is opaque, inconsistent errors: the same "not found" is a
typed 404 in one place and a bare string in another, and an internal crash can
surface its raw message as though it were an actionable API error. We also have
no stated rule for **when** to reach for a `HandledError` versus a plain `Error`,
so the two get used interchangeably.

## Decision

**We adopt one error convention everywhere, in both TypeScript and Go: only
handled errors cross an API boundary with meaning; everything else is reported as
an unknown/internal error.**

Concretely:

1. **Throw a `HandledError` (Go: return an `herr.E`) only when the cause is both
   known and user-relevant.** Not-found, forbidden, not-owned, validation,
   conflict, timeout, rate-limited, precondition-not-met, quota-exceeded — the
   failures we can name and a caller can respond to. Give each a stable `code`
   (Go: `Code`) and put the identifying context in `meta`.

2. **For anything internal or unanticipated, use a plain JavaScript `Error` (Go:
   a plain `error`).** A database crash, an infra timeout we don't model, a bug.
   Do **not** invent a `HandledError` to dress it up. It will correctly degrade to
   "unknown" at the boundary.

3. **The boundary only serialises handled errors.** The presence of a serialised
   domain payload IS the signal of "handled":
   - tRPC: `data.domainError` is the `SerializedHandledError`, or `null`.
   - Hono: a `HandledError` yields `{ error: code, message, ...meta }`; an
     unhandled error yields a generic internal response.
   - An unhandled error carries **no** `domainError` payload. Its raw detail is
     **logged server-side with the trace id**, never presented to the client as
     an actionable error. Clients render it as a single generic "something went
     wrong" plus the trace id for support (`HandledError.toUserMessage` already
     returns `"An unknown error occurred"` for non-handled errors and hands the
     original to a log callback).

4. **A handled error may wrap an unhandled cause without leaking it.**
   `serialize()` walks `reasons` and masks any non-`HandledError` link as
   `{ code: "unknown" }`. So `new EvaluationNotFoundError(..., { reasons: [pgError] })`
   keeps the useful top and hides the internal bottom. Use this when a known
   failure was ultimately triggered by an internal one.

5. **Handled-ness is preserved across the Go↔TS boundary.** When the control
   plane proxies a Go service, an `herr` envelope is adapted into a
   `HandledError` (`Code → code`, `meta → meta`, `trace_id/span_id →
   traceId/spanId`, `reasons → reasons`); a plain Go `error` stays unhandled and
   becomes "unknown." A handled error in Go is a handled error in the browser.

6. **Non-tRPC/Hono transports carry the same shape.** Streamed responses (e.g.
   the Langy chat NDJSON stream) that today emit `{ type: "error", error:
   string }` must instead emit the `SerializedHandledError` on their error event,
   so the client's handled/unknown logic is identical regardless of transport.

7. **The client is the single place that decides presentation.** A shared reader
   (`readHandledError`, already used by
   `src/features/automations/logic/errorExplainer.ts`) lifts `data.domainError`;
   an `explain*`-style mapping keyed on `code` turns it into user-facing copy and
   an optional action/render choice. The server never dictates UI; it emits the
   typed fact, the client renders it. Absence of a domain payload → the generic
   unknown treatment. *(Amended 2026-07-18 — see below: remediation facts now
   travel with the error for consumers that have no client explainer.)*

`code` (Go: `Code`) is a **serialisable string discriminant** and is the correct
check across process, worker, and serialisation boundaries — use
`err.code === "evaluation_not_found"`, not `instanceof`, in those cases
(`instanceof` is same-process only and breaks across module boundaries — a
bundler can load two copies of the same module, which is why the Hono handler
checks `"code" in error`).

## Rationale / Trade-offs

The alternative — let every route decide its own error shape — is what we have,
and it produces exactly the opacity described above. Centralising on
`HandledError`/`herr` costs each domain a small `errors.ts` of typed subclasses
and the discipline to throw them instead of returning strings, but it buys a
single, predictable contract: a client (human or agent) can always tell a "you
did something we understand, here's what and why" from a "we broke, sorry,"
without parsing prose.

The deliberate asymmetry — rich detail for handled, opaque "unknown" for
unhandled — is a security and UX position, not an oversight. Unhandled internal
detail is not actionable to a caller and is a leak surface; masking it (and
masking unhandled *reasons* inside handled errors) keeps the blast radius of a
bug to the server logs, where the trace id ties it back for whoever is on call.
The one accepted cost is that debugging an unhandled failure requires the trace
id and the server logs rather than reading the client response — which is the
correct place for internal detail to live.

We accept that this is a convention that must be applied by hand at each throw
site; there is no compiler that forces "was this cause knowable?" The
mitigations are the shared base classes (so the easy path is the right one),
lint/review attention on new `c.json({ error })` in service apps, and this ADR as
the reference.

## Consequences

- **New per-domain `errors.ts` modules** of `HandledError` subclasses, each with a
  stable `code` and a sensible `httpStatus`. Existing ad-hoc `extends Error`
  classes (e.g. Langy's `LangyCredentialResolutionError`,
  `LangyConversationNotOwnedError`) become `HandledError` subclasses with a `code`.
- **Service routes stop hand-rolling `c.json({ error: string })`.** They throw a
  `HandledError`; `createServiceApp`'s `onError` already serialises it. A generic
  string response becomes a code smell.
- **Streamed transports gain a structured error event** carrying
  `SerializedHandledError`. The Langy chat stream is the first adopter.
- **The control plane grows a small `herr → HandledError` adapter** used wherever
  it proxies a Go service (Langy agent, NLP, gateway), so cross-language handled
  errors stay handled.
- **The client standardises on `readHandledError` + a `code`-keyed explainer.**
  Features render handled errors usefully and unhandled errors as one calm
  generic state plus a trace id. Langy's `<LangyError>` is a richer instance of
  this pattern (card / inline / suppress).
- **Observability improves for free:** every `HandledError` captures the active
  span's trace/span id, and tRPC already logs `handledErrorCode`, so handled
  failures are queryable by code and joinable to their trace.
- **"Unknown" is a first-class, intended outcome.** An unhandled error producing
  a generic client response with a trace id is the system working as designed,
  not a gap to be filled by inventing a handled error for it.
- **The `kind` → `code` rename ships non-breaking.** Renaming the wire
  discriminant from the old `DomainError.kind` to `HandledError.code` would break
  any client still reading `kind` during a rolling deploy. To avoid that,
  serialisation emits **both**: `code` plus a deprecated `kind` alias holding the
  same value (top-level and in nested `reasons`), and the client readers resolve
  the discriminant from `code ?? kind`. This makes both rollout directions safe
  (old client ↔ new server, new client ↔ old server). The `kind` alias is
  transitional — remove it once no consumer reads `kind`.

## Amendment 2026-07-18: remediation channel (`tips`/`docsUrl`) and the fault axis

Two additions, both fully additive on the wire (older clients and the Python SDK
ignore unknown keys; the REST envelope shape is unchanged):

1. **Handled errors now carry self-diagnosis data.** `HandledError` (and
   `SerializedHandledError`) gained optional `tips` (short, actionable
   remediation lines) and `docsUrl` (a canonical docs.langwatch.ai link to the
   relevant markdown page). This revises §7's "the server never dictates UI":
   the server still never dictates *presentation*, but it now emits *remediation
   facts* because the most important consumers — agents driving the CLI, API and
   MCP server — have no client-side `explain*` mapping to fall back on. The UI's
   `code`-keyed explainers may still override or ignore these fields; agents
   render them verbatim. On the Go side, `herr` carries them as reserved `Meta`
   keys (`tips`, `docs_url`) promoted to first-class `ErrorBody` fields on the
   wire — the same mechanism as `Meta["message"]`, so `Body`/`FromBody`
   round-trips stay lossless.
2. **Log level is driven by fault attribution, not handled-ness or status
   alone.** Handled-ness decides only what the *client* sees. The new `fault`
   field (`"customer" | "platform" | "provider"`, default `"customer"`) says who
   can act: customer-fault errors are expected and log at **warn** (tracked by
   `handledErrorCode` for spike alerts); platform/provider failures are
   incidents and keep logging at **error**. PostHog exception capture is now
   reserved for *unhandled* errors — a handled error is by definition not a
   bug. This mirrors the existing classification in
   `services/aigateway/adapters/httpapi/faults.go`. Subclasses with 5xx
   statuses must be audited and annotated `platform`/`provider` explicitly,
   since the default is `customer`.

Supporting changes: the TS `HandledError` core moved into the shared source-only
package `@langwatch/handled-error` (`packages/handled-error`), consumed by the
app (via the `src/server/app-layer/handled-error.ts` shim, which wires the
Grafana trace-link builder), the MCP server (bundled via tsup `noExternal`),
and available to the CLI and SDKs. The MCP server now JSON-parses API error
bodies and surfaces `code`/`tips`/`docsUrl` in tool error text. SSE error
frames (`server/routes/sse.ts`) carry the serialized `domainError` alongside
the message; non-handled stream failures now degrade to the generic unknown
message instead of leaking raw error text onto an already-200 stream.

## References

- Code (TS): `src/server/app-layer/handled-error.ts` (`HandledError`,
  `SerializedHandledError`, `NotFoundError`, `ValidationError`),
  `src/server/api/trpc.ts` (`handledErrorMiddleware`, `errorFormatter`),
  `src/app/api/middleware/error-handler.ts` (`handleError`),
  `src/features/automations/logic/errorExplainer.ts`
  (`readHandledError`/`explainHandledError`).
- Code (Go): `pkg/herr/herr.go` (`E`, `New`), `pkg/herr/http.go`
  (`WriteHTTP`, code→status registry).
- Related ADRs: [027](./027-typed-dispatcherror-contract.md) (typed
  `DispatchError` contract — a domain-specific precedent for this pattern).
- Spec: `specs/features/domain-error-contract.feature`.
