package otel

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sync"
	"testing"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func quiet() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

// testProvider constructs a Provider wired to an in-memory recorder
// without touching the global tracer provider.
func testProvider(t *testing.T) (*Provider, *tracetest.SpanRecorder) {
	t.Helper()
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	prop := propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{})
	return &Provider{tp: tp, propagator: prop, tracer: tp.Tracer("test"), logger: quiet()}, rec
}

// TestTraceparentBecomesParent asserts that when a W3C `traceparent`
// header is supplied by the caller (as an SDK does when it already
// started a trace), the gateway span uses that trace_id and parent
// span_id — so customer traces don't double-count gateway cost.
func TestTraceparentBecomesParent(t *testing.T) {
	prov, rec := testProvider(t)

	const incoming = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, _, finish := prov.StartFromRequest(w, r, "lw_gateway.chat_completions")
		defer finish()
		SpanFromContext(ctx).SetAttributes(attribute.String(AttrProjectID, "proj_123"))
		w.WriteHeader(200)
	})
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	req.Header.Set("traceparent", incoming)
	w := httptest.NewRecorder()
	srv(w, req)

	spans := rec.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected 1 span, got %d", len(spans))
	}
	got := spans[0]
	if got.SpanContext().TraceID().String() != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Errorf("trace_id mismatch: %s", got.SpanContext().TraceID())
	}
	if got.Parent().SpanID().String() != "00f067aa0ba902b7" {
		t.Errorf("parent span_id mismatch: %s", got.Parent().SpanID())
	}
	resp := w.Result()
	if tp := resp.Header.Get("traceparent"); tp == "" {
		t.Error("expected traceparent on response")
	}
	if tid := resp.Header.Get(HeaderTraceID); tid != "4bf92f3577b34da6a3ce929d0e0e4736" {
		t.Errorf("X-LangWatch-Trace-Id: want matching trace id, got %q", tid)
	}
}

// TestNoTraceparent_CreatesNewTrace asserts that when no traceparent is
// supplied, the gateway starts a fresh trace (no parent) and still
// emits X-LangWatch-Trace-Id so CLIs can correlate without parsing OTel.
func TestNoTraceparent_CreatesNewTrace(t *testing.T) {
	prov, rec := testProvider(t)

	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _, finish := prov.StartFromRequest(w, r, "lw_gateway.chat_completions")
		defer finish()
		w.WriteHeader(200)
	})
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	w := httptest.NewRecorder()
	srv(w, req)

	spans := rec.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected 1 span")
	}
	if spans[0].Parent().IsValid() {
		t.Error("expected no parent span when traceparent absent")
	}
	if tid := w.Result().Header.Get(HeaderTraceID); !regexp.MustCompile(`^[0-9a-f]{32}$`).MatchString(tid) {
		t.Errorf("expected 32-hex trace id, got %q", tid)
	}
}

// TestEnrichFromBundle stamps VK identity attrs onto the span.
func TestEnrichFromBundle(t *testing.T) {
	prov, rec := testProvider(t)

	srv := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, _, finish := prov.StartFromRequest(w, r, "lw_gateway.chat_completions")
		defer finish()
		EnrichFromBundle(ctx, &testBundle{
			vk: "vk_01", proj: "proj_01", team: "team_01", org: "org_01", prin: "prin_01", prefix: "lw_vk_live_abcd",
		})
		AddStringAttr(ctx, AttrModel, "gpt-5-mini")
		AddStringAttr(ctx, AttrProvider, "openai")
		AddInt64Attr(ctx, AttrUsageIn, 123)
		AddInt64Attr(ctx, AttrUsageOut, 45)
		AddFloatAttr(ctx, AttrCostUSD, 0.00042)
		w.WriteHeader(200)
	})
	w := httptest.NewRecorder()
	srv(w, httptest.NewRequest("POST", "/v1/chat/completions", nil))

	spans := rec.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected 1 span")
	}
	attrs := attrsMap(spans[0].Attributes())
	wantStrings := map[string]string{
		AttrProjectID:     "proj_01",
		AttrTeamID:        "team_01",
		AttrOrgID:         "org_01",
		AttrVirtualKeyID:  "vk_01",
		AttrPrincipalID:   "prin_01",
		AttrDisplayPrefix: "lw_vk_live_abcd",
		AttrModel:         "gpt-5-mini",
		AttrProvider:      "openai",
	}
	for k, want := range wantStrings {
		if got := attrs[k]; got != want {
			t.Errorf("attr %s: want %q got %q", k, want, got)
		}
	}
	if attrs[AttrUsageIn] != "123" || attrs[AttrUsageOut] != "45" {
		t.Errorf("usage attrs wrong: in=%q out=%q", attrs[AttrUsageIn], attrs[AttrUsageOut])
	}
}

// TestRouterSplitsByProject asserts that spans with different
// project_ids land in different per-project OTLP endpoints, and spans
// without one go to the default.
func TestRouterSplitsByProject(t *testing.T) {
	mu := sync.Mutex{}
	proj1Hits, proj2Hits, defaultHits := 0, 0, 0

	proj1 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		proj1Hits++
		mu.Unlock()
		w.WriteHeader(200)
	}))
	defer proj1.Close()
	proj2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		proj2Hits++
		mu.Unlock()
		w.WriteHeader(200)
	}))
	defer proj2.Close()
	defaultSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defaultHits++
		mu.Unlock()
		w.WriteHeader(200)
	}))
	defer defaultSrv.Close()

	resolver := func(pid string) (string, map[string]string, bool) {
		switch pid {
		case "proj_01":
			return proj1.URL, nil, true
		case "proj_02":
			return proj2.URL, nil, true
		}
		return "", nil, false
	}
	router, err := NewRouterExporter(context.Background(), RouterOptions{
		DefaultEndpoint: defaultSrv.URL,
		Resolver:        resolver,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer router.Shutdown(context.Background())

	tp := sdktrace.NewTracerProvider(sdktrace.WithSyncer(router))
	tr := tp.Tracer("test")
	_, s := tr.Start(context.Background(), "gateway.a")
	s.SetAttributes(attribute.String(AttrProjectID, "proj_01"))
	s.End()
	_, s = tr.Start(context.Background(), "gateway.b")
	s.SetAttributes(attribute.String(AttrProjectID, "proj_02"))
	s.End()
	_, s = tr.Start(context.Background(), "gateway.c")
	s.End()
	_ = tp.ForceFlush(context.Background())
	_ = tp.Shutdown(context.Background())

	mu.Lock()
	defer mu.Unlock()
	if proj1Hits < 1 || proj2Hits < 1 || defaultHits < 1 {
		t.Errorf("expected each bucket to receive >=1 span; got proj1=%d proj2=%d default=%d",
			proj1Hits, proj2Hits, defaultHits)
	}
}

// ---- helpers ----

type testBundle struct{ vk, proj, team, org, prin, prefix string }

func (t *testBundle) VirtualKeyID() string     { return t.vk }
func (t *testBundle) ProjectID() string        { return t.proj }
func (t *testBundle) TeamID() string           { return t.team }
func (t *testBundle) OrganizationID() string   { return t.org }
func (t *testBundle) PrincipalID() string      { return t.prin }
func (t *testBundle) DisplayPrefixStr() string { return t.prefix }

func attrsMap(kvs []attribute.KeyValue) map[string]string {
	m := make(map[string]string, len(kvs))
	for _, kv := range kvs {
		m[string(kv.Key)] = kv.Value.Emit()
	}
	return m
}
