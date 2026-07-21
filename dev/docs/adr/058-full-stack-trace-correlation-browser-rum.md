# ADR-058: Full-stack trace correlation — browser RUM into the internal stack

**Date:** 2026-07-21

**Status:** Draft

> Behavioural contract:
> [browser-rum-trace-correlation.feature](../../../specs/observability/browser-rum-trace-correlation.feature)
>
> Builds on ADR-042 (local observability stack) and ADR-054 (observability as
> code). Does not change ADR-055's customer-facing OTLP ingest in any way.

## Context

We can already follow a request once it reaches the server. We cannot follow it
from where it started. When a user reports that "saving the prompt was slow" or
"the page threw an error", the trace we can find begins at the API boundary —
after DNS, after the bundle parsed, after React decided to fetch, after the
request queued behind five others on the same connection. The part the user
actually experienced is missing, and the part we can see is the part that is
usually fine.

Frontend errors do get captured, via PostHog (`~/utils/posthogErrorCapture`).
But they land in a system that shares no identifier with our traces, so an
exception in PostHog and the request that caused it can only be joined by
eyeballing timestamps. Worse, the utility's `withScope` and
`setPropagationContext` are explicit no-ops and server-side captures use a
constant `distinctId: "server"`, so those events carry neither trace context nor
tenant identity. There is nothing to join on even in principle.

Several things that would normally be hard are already done:

- `src/app/api/middleware/tracer.ts` already extracts W3C trace context from
  inbound headers and injects it onto responses. The REST surface would adopt a
  browser-supplied `traceparent` today, unchanged.
- The app and the API share one origin (`BASE_HOST`), so browser-to-backend
  calls raise no CORS preflight and need no cross-origin header allowances.
- `@opentelemetry/sdk-trace-web` is already a dependency, and
  `src/utils/grafanaLinks.ts` already turns a trace id into a Tempo or Loki
  deep link.

And several constraints are real:

- **Production has no internet-reachable OTLP ingest.** The public OTLP NLB
  exists in infrastructure code but is disabled in prod by deliberate choice.
  Its bearer-token filter guards only the traces pipeline; the logs pipeline
  behind the same listener has no auth filter, so enabling the NLB would expose
  an unauthenticated log sink. Browsers are on the internet.
- **There is no Grafana Alloy**, so `faro.receiver` is not available to us. What
  exists is a plain OpenTelemetry Collector accepting OTLP/HTTP on `:4318`,
  cluster-internal, fanning traces to Tempo and logs to Loki.
- **tRPC batches.** `src/utils/api.tsx` composes `httpBatchLink` under two
  `splitLink`s, plus a WebSocket transport and an SSE transport. Instrumenting
  `fetch` alone would yield one span covering an arbitrary number of unrelated
  procedure calls, and would yield nothing at all for the WS and SSE paths.
- **The tRPC server tracer does not extract context.** `src/server/api/trpc.ts`
  opens a `SpanKind.SERVER` span without consulting inbound headers, so every
  tRPC call starts a fresh root trace. Since most of the product talks tRPC, the
  correlation would silently not happen for the traffic that matters most.
- `@opentelemetry/instrumentation-http` is disabled in
  `src/instrumentation.node.ts`, so the two middleware tracers are the only
  places server-side context extraction can occur. Nothing picks it up
  implicitly.

## Decision

We will instrument the browser with OpenTelemetry and route its telemetry to the
internal collector through the application's own origin, so that a single trace
spans the user's interaction, the network call, and the server work it caused.

**Browser telemetry is platform-internal operations telemetry.** It carries the
`langwatch.origin: platform_internal` resource marker the backend and the Go
services already set, and it never touches the customer OTLP ingest path at
`/api/otel/v1/traces`. The two are separate systems that happen to speak the same
protocol, and conflating them is the failure this marker exists to make
detectable.

**Transport is a same-origin proxy, not a public collector.** The app exposes a
telemetry-ingest route that forwards OTLP/HTTP to the in-cluster collector. We
will not enable the public OTLP NLB. This keeps the browser's request
same-origin (no CORS at all), reuses the rate-limiting and request-size limits
the app already applies, adds no new internet-facing infrastructure, and leaves
the collector's unauthenticated logs pipeline unreachable from outside the VPC.

**Instrumentation is composed, not adopted wholesale.** We take
`@opentelemetry/sdk-trace-web` with document-load and fetch/XHR instrumentation
for the page-level picture, and add three pieces the off-the-shelf bundle cannot
provide for this codebase:

1. **A tRPC link** that opens a client span per *procedure call*, not per HTTP
   request. This is the only seam that is correct across all three transports —
   batched HTTP, WebSocket, and SSE — because it sits above the transport
   split. It injects trace context into the request headers for the HTTP paths
   and into the operation context for the WS and SSE paths, which cannot carry
   per-message headers.
2. **A navigation instrumentation** driven by the React Router 8 router, so a
   route transition is a span and the fetches it triggers are its children.
3. **A session span processor** that stamps `session.id` (per OpenTelemetry
   session semantic conventions) on every span. The web SDK has no session
   concept; without this, "show me everything this user did around the failure"
   is not answerable, and that question is most of the value of RUM.

We will not adopt Grafana Faro. It is the better product for this problem in the
abstract — its React package supplies the router integration, error boundary,
and session handling we are otherwise hand-rolling — but its non-trace signals
require a Faro receiver we do not run, and adopting Alloy to get one is a larger
infrastructure change than the instrumentation it saves. If Alloy arrives for
other reasons, revisiting this is cheap, because the trace half is plain OTLP
either way.

**The server will extract trace context in the tRPC tracer**, using the same
`propagation.extract` treatment `tracer.ts` already applies, and falling back to
the operation context for calls that arrive over WebSocket or SSE.

**Browser-supplied trace context is untrusted input.** Anyone can post spans at
a public route and assert any trace id. We accept this — the blast radius of a
polluted trace is a confusing Tempo query, not a security boundary — but we
bound it: the ingest route is rate-limited per session and per IP, caps body
size below the collector's 32MB limit, and rejects payloads whose resource
attributes claim to be a service other than the browser app.

**Sampling decisions are made in the browser and respected by the backend.**
This is the consequence of head-based sampling that most often surprises people:
an unsampled browser trace discards the backend spans too. We therefore start
at always-on, and when volume requires it, bias retention toward sessions that
errored or were slow rather than applying a flat ratio.

Separately and independently of RUM, **PostHog exception events will carry
`trace_id` and `span_id`** read from the active span. This is a few lines in
`posthogErrorCapture.ts`, it is useful whether or not any of the above ships,
and it is what makes a PostHog error one click from its trace.

## Rationale / Trade-offs

The central choice is the proxy route over a public collector. A public OTLP
endpoint is the conventional answer and would be less code. It was rejected
because it inverts a deliberate production posture and because the collector's
auth filter does not cover the logs pipeline, so "just turn on the NLB" is not
actually one change — it is one change plus a collector hardening we would be
doing under time pressure. The proxy costs us an app route and a hop, and buys
same-origin simplicity, existing middleware, and no new attack surface.

Choosing a tRPC link over `fetch` instrumentation is the difference between
telemetry that looks complete and telemetry that is. With `httpBatchLink`, a
single fetch span attributed to `POST /api/trpc` tells you a batch was slow but
not which procedure in it, which is precisely the question. The cost is that we
own a link, and links are load-bearing code in a request path — a bug there
degrades the product, not just its telemetry. The link must therefore be
fail-open: any error inside it passes the operation through untouched.

Declining Faro is the decision most likely to be revisited, and it is worth
being honest that we are choosing more of our own code over an infrastructure
dependency. The judgement is that Alloy is a component we would then run,
monitor, and upgrade forever, to replace perhaps three hundred lines we
understand.

## Consequences

A trace becomes a single object spanning click, navigation, request, and server
work. The Grafana deep links we already generate start landing on traces that
contain the frontend, so an error surfaced in the UI can be followed backwards
without changing tools.

We take on frontend telemetry volume, which is larger and spikier than backend
telemetry and is paid for in Tempo storage and collector CPU. The sampling
posture above is the lever, and we should expect to pull it.

We take on a request-path dependency in the tRPC link. This is the main new
risk and is mitigated by fail-open behaviour and by the link being inert when
telemetry is disabled.

Alerting needs no new machinery. Rules carrying `contact_point=prod-alerts` and
a severity label already reach `#alerting` through the existing root route, and
alert content is published from JSON rather than Terraform. Note that the
authoritative alerting JSON does not live on the main checkout — editing the
stale copy silently reverts work.

For the PostHog-into-Grafana question that prompted this: with the Infinity
datasource installed, PostHog's HogQL query API can back dashboard panels
directly, and no export pipeline is needed for visualisation. Infinity is a poor
*alert* source — alerting requires its JSONata or JQ backend parser returning
numeric frames, against a rate-limited multi-second query API — so alert
thresholds should read a Prometheus counter instead. Note also that the
fluent-bit path into Loki is documented as deliberately lossy under pressure,
which is correct for search and wrong for an alert that must not miss.

Once frontend errors carry trace context and land in Tempo natively, PostHog's
role in error tracking becomes a question worth asking rather than an assumption.
This ADR does not answer it.

## Rollout

The phases are independently valuable and independently revertible, and the
first two are worth doing even if the rest is deferred.

1. **Trace context on PostHog captures.** `posthogErrorCapture.ts` reads the
   active span. No infrastructure.
2. **tRPC server-side context extraction.** `src/server/api/trpc.ts` gains the
   extraction `tracer.ts` already performs. Inert until something sends context.
3. **Telemetry ingest proxy route**, rate-limited and size-capped, forwarding to
   the in-cluster collector. Verifiable by posting OTLP by hand.
4. **Browser SDK**: provider, resource, batch processor, session processor,
   document-load and fetch instrumentation, behind a flag, default off.
5. **tRPC client link**, fail-open, carrying context across all three
   transports.
6. **Router navigation spans.**
7. **Dashboards and alert rules**, published through the existing JSON pipeline
   with `contact_point=prod-alerts`.
8. **Infinity datasource** and PostHog-backed panels — independent of 1–7 and
   can proceed in parallel.

## References

- Related ADRs: ADR-042 (local observability stack), ADR-054 (observability as
  code), ADR-055 (canonical OTLP pipelines), ADR-003 (logging)
- [OpenTelemetry session semantic conventions](https://opentelemetry.io/docs/specs/semconv/general/session/)
- [Grafana Infinity datasource](https://grafana.com/docs/plugins/yesoreyeram-infinity-datasource/latest/)
- [Grafana Faro Web SDK](https://github.com/grafana/faro-web-sdk) (considered, not adopted)
