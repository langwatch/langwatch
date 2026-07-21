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

The platform already has the machinery for (1): the `HandledError`
(`packages/handled-error`, consumed by the app and the other TS surfaces) — an
abstract `Error` subclass carrying a serialisable `code`, `meta`,
`traceId`/`spanId` (captured from the active OTel span), `httpStatus`, and a
`reasons` cause chain, with a `serialize()` producing
`SerializedHandledError`. It is wired into both transports:

- **tRPC** (`src/server/api/trpc.ts`): a `handledErrorMiddleware` converts a
  `HandledError` thrown in a procedure into a correctly-coded `TRPCError` (via
  `handledErrorToTRPCCode`), and the `errorFormatter` calls `.serialize()` and
  attaches the result to the error's `data.error`.
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
   - tRPC: `data.error` is the `SerializedHandledError`, or `null`.
   - Hono: a `HandledError` yields `{ error: code, message, ...meta }`; an
     unhandled error yields a generic internal response.
   - An unhandled error carries **no** `error` payload. Its raw detail is
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
   `src/features/automations/logic/errorExplainer.ts`) lifts `data.error`;
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
package `@langwatch/handled-error` (`packages/handled-error`), which the app,
MCP server, CLI and SDKs all import directly (the app wires its Grafana
trace-link builder via `src/server/handled-error-wiring.ts`, loaded by
`server.mts` and `workers.ts`); the MCP server bundles the package via tsup
`noExternal` and JSON-parses API error bodies to surface `code`/`tips`/`docsUrl`
in tool error text. All remediation copy lives in one registry
(`src/server/app-layer/error-remediation.ts`), with a CI test asserting every
docs link resolves to a real page. SSE error frames
(`server/routes/sse.ts`) carry the serialized handled error alongside
the message; non-handled stream failures now degrade to the generic unknown
message instead of leaking raw error text onto an already-200 stream.
Log levels follow the fault axis on every boundary: tRPC, Hono REST
(`logHttpRequest`), SSE, and the Go telemetry middleware. One asymmetry by
design: TS defaults `fault` to `"customer"`, while Go `herr` leaves it unset
(only explicitly annotated codes get one) — an unset Go fault logs at info,
matching the pre-existing Go behavior for expected control-flow errors.

## Amendment 2026-07-20: the wire message is the code, and one `error` object

The boundary was sanitising the *payload* but not the *message*. A
`HandledError`'s message was treated as vetted user copy and passed straight
through, so `langy.createConversation` returned
`"LW_GATEWAY_BASE_URL is not configured on the control plane."` as the wire
message next to a perfectly clean serialised payload. That message is written
for whoever is reading the logs — it names env vars, hostnames and internal
services — and it was reaching browsers, REST callers and the chat stream.

**A handled error's free-text message never crosses a boundary.** Every
transport sends the stable `code` where a message is required:

- **tRPC** — `message` is the code; `data.error` is the `SerializedHandledError`
  (renamed from `data.domainError`), or `null`.
- **Hono** — `message` is the code; the code, `meta`, `reasons`, `tips`,
  `docsUrl` and `fault` carry everything a caller needs.
- **Streams** (`sse.ts`, `scenario-generate.ts`) — the frame's `message` /
  `error` string is the code, with the serialised payload beside it.
- **Go `herr`** — already correct: `toErrorBody` defaults `Message` to the code,
  and free text appears only when a caller explicitly sets `Meta["message"]`.

`SerializedHandledError` has no `message` field, and that is deliberate — the
structured payload IS the contract, and presentation stays client-side (point 7
above). Consumers with no explainer (CLI, API, MCP, agents) read `tips` and
`docsUrl`, which exist precisely to be safe, authored remediation copy. **If an
error needs prose for those consumers, add tips — never widen the message.**

**`data.zodError` is gone.** A `ZodError` is promoted to the shared
`ValidationError` (mirroring what Hono already did), so validation travels the
one handled-error channel and its issues ride in `meta.fieldErrors` /
`meta.formErrors` like every other domain fact. It had no client consumers.

### Every producer emits both `type` and `code`

Rather than pick a winner, Go and the Hono body now emit **both names with the
same value**: `type` because the AI Gateway's envelope is OpenAI-compatible
(`docs/ai-gateway/api/errors.mdx` — the `openai` and Anthropic SDKs parse it and
must keep raising their usual typed exceptions), and `code` because that is the
name the TypeScript side uses everywhere. Readers resolve `code` → `kind` →
`type`, so a consumer gets the same answer whichever name its transport taught
it, and neither ecosystem has to be broken to satisfy the other. `kind` remains
the deprecated pre-`HandledError` alias.

### Reading a message for display

A handled error carries no message on the wire, so anything rendering one reads,
in order: **`meta.message` → `message` → `code`**.

- `meta.message` is prose the server *deliberately* authored to be shown. It is
  the only channel that carries a sentence, and it is opt-in per error — which
  is what keeps the leak closed: the constructor's `message` stays server-side.
  `herr.FromBody` populates it, so proxied Go errors explain themselves.
- `message` is the code for a handled error, but real copy for a plain
  `TRPCError` a procedure authored — still exactly what to show.
- `code` is the last resort, so a caller never gets an empty string.

`errorDisplayMessage` (`src/utils/trpcError.ts`) implements this for the app; the
CLI does it in `asErrorBody`, and the Python SDK in `extract_api_error_detail`
(which also appends `tips` and `docsUrl`, since those exist to be shown).

### One deliberate asymmetry

**The Hono body stays flat at the root.** Nesting it under an `error` key would
read better, but `error` is already a *string* there, and the Python SDK
(`better_raise_for_status`), the TS SDK's legacy path and `directUpload.ts` all
read it as one. Changing it is a breaking change to published SDKs and needs its
own migration, not a drive-by.

### Known follow-up

`data.cause` is still a parallel channel for `ModelNotConfiguredError`,
`AiCallFailedError`, `ModelProviderDisabledError` and limit info, because those
are plain `Error`s rather than `HandledError`s. Converting them collapses that
channel into `data.error.meta` and deletes the three special cases in
`handledErrorMiddleware`. Worth doing; out of scope here.

Roughly 150 UI sites render a tRPC error's `.message` straight into a toast.
For unhandled errors that is unchanged, but a handled one now shows its code
slug. Each is a missing explainer entry — the fix is copy at the call site, and
never re-widening the wire.

## Amendment 2026-07-21: the client half — one registry, and types that enforce it

§7 said "the client is the single place that decides presentation" and left it
there. In practice the client decided nothing: three independent explainers
existed (automations, Langy, experiments-v3), one of them covering six codes out
of sixty, and ~105 call sites rendered `error.message` directly into a toast.

That was survivable until #5984, which correctly established that **a handled
error's free-text message never crosses the boundary** — it is server copy that
names env vars and internal services — so the wire message became the stable
`code`. Correct for the leak, and it turned every one of those 105 call sites
into a slug renderer: a rejected form now told the customer `validation_error`.

Three decisions close it:

1. **One code-keyed registry owns all customer-facing copy.** Both the title and
   the description are written client-side against the `code`. The server
   contributes only structured fact (`code`, `meta`, `tips`, `docsUrl`, `fault`,
   `traceId`). Where the server genuinely must author dynamic prose, it uses
   `meta.message` — the deliberate opt-in channel, mirroring Go's
   `Meta["message"]`. An unrecognised code degrades on `fault`, never on the
   code slug. A call site may supply a *fallback* title naming the action that
   failed; registry copy outranks it, because it describes the actual failure.

2. **A customer sees message, tips, docs and a copyable error id — nothing
   else.** Raw `meta` and the reason chain are not rendered: they exist for
   agents and logs. This makes `meta` a per-code contract rather than a debug
   dump — the registry reads a field only where its entry declares the shape.
   Correspondingly, the boundary now attaches `data.traceId` for **unhandled**
   errors too. An unhandled error deliberately tells the client nothing about
   what failed, which previously left support with nothing to correlate on; an
   opaque id is not a detail about the failure.

3. **The type system enforces coverage, and tests enforce what it can't.** The
   registry is exhaustive over `AppErrorCode | GoErrorCode`, so an error code
   with no copy fails `pnpm typecheck`. `GoErrorCode` is generated from the
   `herr.Code` declarations in the Go services by `cmd/herrgen`, which means a
   Go engineer adding a code to the gateway breaks the TypeScript build until
   someone writes the customer copy for it — the Go↔TS parity of §5 extended
   from the wire to the words. Two things types cannot see are covered by tests
   that scan source: that the enumerated app codes match the codes subclasses
   actually raise (in both directions — a listed code nothing raises is dead
   copy), and that no call site renders an error's raw message into a toast.

Consequences: `src/features/errors` is the single client entry point
(`readHandledError`, `explainHandledError`, `showErrorToast`,
`HandledErrorAlert`, `applyHandledErrorToForm`); the automations explainer is
deleted and Langy's builds on the shared reader while keeping its own
card/inline/suppress renderer; `showErrorToast` absorbs the
`isHandledByGlobalHandler` dedup that ~137 call sites were copy-pasting; and
server-side validation errors are mapped back onto the fields that caused them
rather than thrown into a toast the user has to translate.

## References

- Code (TS): `packages/handled-error` (`HandledError`,
  `SerializedHandledError`, `NotFoundError`, `ValidationError` — shared
  package, imported directly by the app, MCP server, CLI and SDKs),
  `langwatch/src/server/handled-error-wiring.ts` (Grafana trace-link wiring),
  `langwatch/src/server/app-layer/error-remediation.ts` (tips/docs registry),
  `langwatch/src/server/api/trpc.ts` (`handledErrorMiddleware`, `errorFormatter`),
  `langwatch/src/app/api/middleware/error-handler.ts` (`handleError`),
  `langwatch/src/features/errors` (`readHandledError`, `explainHandledError`,
  the presentation registry, `showErrorToast`, `HandledErrorAlert`,
  `applyHandledErrorToForm`), `tools/herrgen` + `cmd/herrgen` (Go codes →
  `packages/handled-error/src/codes.generated.ts`).
- Code (Go): `pkg/herr/herr.go` (`E`, `New`), `pkg/herr/http.go`
  (`WriteHTTP`, code→status registry).
- Related ADRs: [027](./027-typed-dispatcherror-contract.md) (typed
  `DispatchError` contract — a domain-specific precedent for this pattern).
- Specs: `specs/features/domain-error-contract.feature` (the boundary),
  `specs/features/handled-error-presentation.feature` (what the customer reads),
  `specs/ci/herr-codes-generation.feature` (Go code generation).
