package otel

import (
	"context"
	"net/http"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// SpanKey is the context key used to stash the gateway span so
// handlers can add attributes / set status without re-deriving it from
// context. SpanFromContext is the standard OTel API; we keep this
// explicit because dispatcher.go wants to end the span with custom
// usage attributes that aren't known until after the bifrost call.
type spanKey struct{}

// StartFromRequest starts the gateway span with the incoming request's
// traceparent as parent (when present) and stamps route-level
// attributes. It returns a new context bound to the span, a
// [ResponseRecorder] wrapper that writes traceparent / X-LangWatch-*
// headers onto the response before it's flushed, and a finish fn that
// ends the span. Typical use:
//
//	ctx, rec, finish := prov.StartFromRequest(w, r, "lw_gateway.chat_completions")
//	defer finish()
//	// ... handler body ...
//	rec.SetStatus(http.StatusOK) // before WriteHeader
func (p *Provider) StartFromRequest(w http.ResponseWriter, r *http.Request, spanName string) (context.Context, *ResponseRecorder, func()) {
	if p == nil {
		rec := wrapResponse(w, nil, p)
		return r.Context(), rec, func() {}
	}
	parentCtx := p.ExtractParent(r.Context(), propagation.HeaderCarrier(r.Header))
	ctx, span := p.tracer.Start(parentCtx, spanName,
		trace.WithSpanKind(trace.SpanKindServer),
		trace.WithAttributes(
			attribute.String("http.request.method", r.Method),
			attribute.String("url.path", r.URL.Path),
			attribute.String("network.protocol.name", "http"),
			attribute.String("user_agent.original", r.UserAgent()),
		),
	)
	ctx = context.WithValue(ctx, spanKey{}, span)
	rec := wrapResponse(w, span, p)
	// Stamp the outbound traceparent onto the response BEFORE any body
	// bytes so clients can parse it on the first chunk of a streamed
	// response as well as on non-streaming JSON. The header carrier is
	// the recorder so we can guard against WriteHeader race: once the
	// handler calls Write/WriteHeader the headers freeze, but we're
	// before that here.
	carrier := propagation.HeaderCarrier(w.Header())
	p.propagator.Inject(ctx, carrier)
	sc := span.SpanContext()
	if sc.IsValid() {
		w.Header().Set(HeaderTraceID, sc.TraceID().String())
		w.Header().Set(HeaderSpanID, sc.SpanID().String())
	}

	finish := func() {
		status := rec.Status()
		if status >= 500 {
			span.SetStatus(codes.Error, http.StatusText(status))
		} else if status >= 400 {
			span.SetStatus(codes.Error, http.StatusText(status))
		} else {
			span.SetStatus(codes.Ok, "")
		}
		span.SetAttributes(attribute.Int("http.response.status_code", status))
		span.End()
	}
	return ctx, rec, finish
}

// SpanFromContext returns the gateway span attached to ctx by
// StartFromRequest, or a no-op span if none.
func SpanFromContext(ctx context.Context) trace.Span {
	if s, ok := ctx.Value(spanKey{}).(trace.Span); ok && s != nil {
		return s
	}
	return trace.SpanFromContext(ctx)
}

// Middleware returns a chi-compatible middleware that wraps every
// request in a gateway span. The span's parent is the incoming W3C
// traceparent (when present); otherwise a new trace is started.
// `spanNamer` lets the caller turn the request into a verb-shaped
// span name like `lw_gateway.chat_completions`.
func Middleware(prov *Provider, spanNamer func(*http.Request) string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			name := "lw_gateway.request"
			if spanNamer != nil {
				if n := spanNamer(r); n != "" {
					name = n
				}
			}
			ctx, rec, finish := prov.StartFromRequest(w, r, name)
			defer finish()
			next.ServeHTTP(rec, r.WithContext(ctx))
		})
	}
}

// EnrichFromBundle stamps the VK identity attrs onto the active span.
// Call this from dispatch-level code right after the auth bundle is
// read so every downstream operation sees project_id / team_id /
// org_id / vk_id / principal_id on the span.
type BundleLike interface {
	VirtualKeyID() string
	ProjectID() string
	TeamID() string
	OrganizationID() string
	PrincipalID() string
	DisplayPrefixStr() string
}

// EnrichFromBundle stamps the VK attrs from any BundleLike onto the
// active span.
func EnrichFromBundle(ctx context.Context, b BundleLike) {
	if b == nil {
		return
	}
	s := SpanFromContext(ctx)
	s.SetAttributes(
		attribute.String(AttrVirtualKeyID, b.VirtualKeyID()),
		attribute.String(AttrProjectID, b.ProjectID()),
		attribute.String(AttrTeamID, b.TeamID()),
		attribute.String(AttrOrgID, b.OrganizationID()),
		attribute.String(AttrPrincipalID, b.PrincipalID()),
		attribute.String(AttrDisplayPrefix, b.DisplayPrefixStr()),
	)
}

// DefaultSpanName maps the common gateway routes to canonical verb
// names. Unknown routes fall back to `lw_gateway.request`.
func DefaultSpanName(r *http.Request) string {
	switch r.URL.Path {
	case "/v1/chat/completions":
		return "lw_gateway.chat_completions"
	case "/v1/messages":
		return "lw_gateway.messages"
	case "/v1/embeddings":
		return "lw_gateway.embeddings"
	case "/v1/models":
		return "lw_gateway.models"
	}
	return "lw_gateway.request"
}

// AddStringAttr is a tiny convenience so callers don't have to import
// go.opentelemetry.io/otel/attribute directly.
func AddStringAttr(ctx context.Context, key, val string) {
	if val == "" {
		return
	}
	SpanFromContext(ctx).SetAttributes(attribute.String(key, val))
}

// AddInt64Attr adds an int64 attribute to the active span.
func AddInt64Attr(ctx context.Context, key string, val int64) {
	SpanFromContext(ctx).SetAttributes(attribute.Int64(key, val))
}

// AddFloatAttr adds a float attribute to the active span.
func AddFloatAttr(ctx context.Context, key string, val float64) {
	SpanFromContext(ctx).SetAttributes(attribute.Float64(key, val))
}

// AddBoolAttr adds a bool attribute to the active span.
func AddBoolAttr(ctx context.Context, key string, val bool) {
	SpanFromContext(ctx).SetAttributes(attribute.Bool(key, val))
}

// ResponseRecorder wraps http.ResponseWriter to capture the status
// code so the gateway span can record it on End. It preserves
// http.Flusher if the underlying writer supports it (critical for SSE
// streams).
type ResponseRecorder struct {
	http.ResponseWriter
	status  int
	written bool
	span    trace.Span
	prov    *Provider
}

func wrapResponse(w http.ResponseWriter, span trace.Span, p *Provider) *ResponseRecorder {
	return &ResponseRecorder{ResponseWriter: w, status: 200, span: span, prov: p}
}

// Status returns the HTTP status that was written, or 200 if nothing
// was ever written (implicit 200 from net/http).
func (r *ResponseRecorder) Status() int { return r.status }

// SetStatus marks the status that WILL be written. Useful for handlers
// that want to set it before WriteHeader (e.g. to enrich the span).
func (r *ResponseRecorder) SetStatus(s int) { r.status = s }

// WriteHeader captures the status then delegates.
func (r *ResponseRecorder) WriteHeader(s int) {
	r.status = s
	r.written = true
	r.ResponseWriter.WriteHeader(s)
}

// Write captures an implicit 200 if WriteHeader wasn't called.
func (r *ResponseRecorder) Write(b []byte) (int, error) {
	if !r.written {
		r.written = true
	}
	return r.ResponseWriter.Write(b)
}

// Flush forwards to the underlying writer when it supports it. SSE
// handlers rely on this for byte-for-byte chunk forwarding.
func (r *ResponseRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
