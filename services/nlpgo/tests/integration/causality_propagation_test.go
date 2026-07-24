// Component integration test for W3C trace-context + causality-depth
// propagation INSIDE nlpgo.
//
// Scope: this is NOT an e2e test. It runs nlpgo's router + engine +
// evaluator-block IN-PROCESS via httptest, stamps the production OTel
// stack onto the global tracer/propagator, captures spans via a
// SpanRecorder, and asserts on the propagation chain WITHIN nlpgo's
// process boundary. The downstream half — OTLP roundtrip into
// langwatch's event-sourcing pipeline, ClickHouse persistence,
// evaluationTrigger reactor block — is covered by the langwatch-side
// e2e test, not here.
//
// What this test DOES prove (all internal to nlpgo):
//   1. POSTing /go/studio/execute_sync with `traceparent` makes the
//      emitted spans share the inbound trace_id within the process.
//   2. The studio root span's parent_span_id equals the inbound
//      traceparent's span_id (parent linkage, not a fresh root).
//   3. EVERY in-process span emitted during the run — root, children
//      across goroutines — carries `langwatch.reserved.causality_depth`
//      stamped from baggage by BaggageAttributeProcessor.
//   4. The outbound HTTP call from evaluatorblock to the (fake)
//      LangWatch app carries `traceparent` + `baggage` +
//      `X-LangWatch-Causality-Depth` headers, with the same trace_id
//      we started with.
//
// What this test does NOT prove (handled by the langwatch-side e2e):
//   - Spans survive OTLP serialization and reach a real collector.
//   - ClickHouse stores the depth attribute on the span row.
//   - The TS evaluationTrigger reactor actually reads it and blocks
//     re-dispatch on the real pipeline.
//
// Wiring matches production (NewBaggageAttributeProcessor from
// pkg/otelsetup, the TraceContext+Baggage composite propagator), so a
// regression in any of: applyInboundCausality, startStudioSpan,
// BaggageAttributeProcessor, or the evaluatorblock propagator inject
// will still surface here.

package integration_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/agentblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/evaluatorblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)

// installProductionTracerStack swaps in the same SpanProcessor +
// TextMapPropagator combo that pkg/otelsetup configures on prod boot,
// using a SpanRecorder as the underlying exporter so tests can observe
// emitted spans. The previous global tracer/propagator is restored on
// t.Cleanup so concurrent test files don't leak state into each other.
func installProductionTracerStack(t *testing.T) *tracetest.SpanRecorder {
	t.Helper()

	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(
		// The BaggageAttributeProcessor is the LOAD-BEARING piece for
		// loop prevention: it stamps every span at OnStart with the
		// causality_depth value carried via context baggage. Without
		// this, only the root span set by startStudioSpan would have the
		// attribute, and child spans emitted from goroutines would slip
		// through the reactor's depth check.
		sdktrace.WithSpanProcessor(otelsetup.NewBaggageAttributeProcessor(
			otelsetup.AutoStampedBaggageKeys...,
		)),
		sdktrace.WithSpanProcessor(rec),
		// The context-aware IDGenerator is what lets startStudioSpan
		// preserve the body-supplied trace_id when there's no inbound
		// W3C traceparent header — the 2026-05-15 "Parent not in trace"
		// fix. Production wires this in pkg/otelsetup/otelsetup.go;
		// mirror it here so tests exercise the production wiring.
		sdktrace.WithIDGenerator(otelsetup.NewIDGenerator()),
	)
	prevTP := otelapi.GetTracerProvider()
	otelapi.SetTracerProvider(tp)

	// The composite TraceContext + Baggage propagator is what makes
	// applyInboundCausality see the inbound `traceparent` AND lets the
	// evaluator-block outbound HTTP inject both headers on egress.
	prevProp := otelapi.GetTextMapPropagator()
	otelapi.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
		propagation.Baggage{},
	))

	t.Cleanup(func() {
		otelapi.SetTracerProvider(prevTP)
		otelapi.SetTextMapPropagator(prevProp)
	})
	return rec
}

// capturedRequest is what setupCausalityStack records about each
// outbound call the evaluator-block makes to the (fake) LangWatch app.
// We snapshot exactly what we'll assert against — header values and the
// body — so the test stays decoupled from the http.Request lifecycle.
type capturedRequest struct {
	path              string
	traceparent       string
	baggage           string
	depthHeader       string
	xLangwatchTraceID string
}

func setupCausalityStack(t *testing.T) (url string, captured *[]capturedRequest) {
	t.Helper()
	requests := []capturedRequest{}
	out := &requests

	// Fake LangWatch evaluator server — receives the outbound call from
	// evaluatorblock. We capture the propagation headers as they
	// arrive on the wire.
	lwSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, capturedRequest{
			path:              r.URL.Path,
			traceparent:       r.Header.Get("traceparent"),
			baggage:           r.Header.Get("baggage"),
			depthHeader:       r.Header.Get(httpapi.CausalityDepthHeader),
			xLangwatchTraceID: r.Header.Get("X-LangWatch-Trace-Id"),
		})
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": "processed",
			"score":  1.0,
			"passed": true,
		})
	}))
	t.Cleanup(lwSrv.Close)

	httpExec := httpblock.New(httpblock.Options{})
	codeExec, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)
	evalExec := evaluatorblock.New(evaluatorblock.Options{})
	agentRunner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{})

	eng := engine.New(engine.Options{
		HTTP:             httpExec,
		Code:             codeExec,
		Evaluator:        evalExec,
		AgentWorkflow:    agentRunner,
		LangWatchBaseURL: lwSrv.URL,
	})

	application := app.New(app.WithWorkflowExecutor(executorAdapter{eng: eng}))
	probes := health.New("test")
	probes.MarkStarted()
	router := httpapi.NewRouter(httpapi.RouterDeps{
		App:     application,
		Health:  probes,
		Version: "test",
	})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)

	return srv.URL, out
}

// minimalEvaluatorWorkflow — entry → evaluator → end with one record.
// Re-used across the propagation scenarios; the workflow itself isn't
// the SUT, the trace propagation through it is.
const minimalEvaluatorWorkflow = `{
  "trace_id": "trace_existing_from_body",
  "origin": "evaluation",
  "workflow": {
    "workflow_id":"wf","api_key":"sk-test","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
    "template_adapter":"default",
    "nodes":[
      {"id":"entry","type":"entry","data":{"train_size":1.0,"test_size":0.0,"seed":1,
        "outputs":[{"identifier":"input","type":"str"},{"identifier":"output","type":"str"}],
        "dataset":{"inline":{"records":{"input":["hello"],"output":["hello"]},"count":1}}}},
      {"id":"eval","type":"evaluator","data":{
        "parameters":[
          {"identifier":"evaluator","type":"str","value":"langevals/exact_match"}
        ]}},
      {"id":"end","type":"end","data":{}}
    ],
    "edges":[
      {"id":"e1","source":"entry","sourceHandle":"input","target":"eval","targetHandle":"input","type":"default"},
      {"id":"e2","source":"entry","sourceHandle":"output","target":"eval","targetHandle":"output","type":"default"},
      {"id":"e3","source":"eval","sourceHandle":"any","target":"end","targetHandle":"any","type":"default"}
    ],
    "state":{}
  }
}`

// postWithTraceContext POSTs the request carrying a W3C traceparent +
// X-LangWatch-Causality-Depth header. Returns nothing — assertions are
// done against the SpanRecorder and captured outbound requests.
func postWithTraceContext(
	t *testing.T,
	url, body, inboundTraceID, inboundSpanID string,
	inboundDepth int,
) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, url+"/go/studio/execute_sync", bytes.NewBufferString(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-LangWatch-Origin", "evaluation")
	req.Header.Set("traceparent", "00-"+inboundTraceID+"-"+inboundSpanID+"-01")
	req.Header.Set(httpapi.CausalityDepthHeader, itoaTest(inboundDepth))

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	require.Equal(t, http.StatusOK, resp.StatusCode, "body: %s", string(respBody))
}

// itoaTest avoids a strconv import just to format depth values in this
// one helper. Hand-rolling keeps the import surface minimal so future
// refactors don't have to think about it.
func itoaTest(n int) string {
	if n == 0 {
		return "0"
	}
	if n == 1 {
		return "1"
	}
	// We only ever pass 0/1 in this test today. Defensive: fall through
	// to a single-digit decimal so a future caller doesn't silently
	// stringify garbage.
	return string(rune('0' + (n % 10)))
}

/** @scenario nlpgo handler extracts traceparent header and continues parent trace */
func TestCausalityPropagation_RootSpanContinuesParentTrace(t *testing.T) {
	rec := installProductionTracerStack(t)
	url, _ := setupCausalityStack(t)

	const inboundTraceID = "0af7651916cd43dd8448eb211c80319c"
	const inboundSpanID = "b7ad6b7169203331"
	postWithTraceContext(t, url, minimalEvaluatorWorkflow, inboundTraceID, inboundSpanID, 0)

	ended := rec.Ended()
	require.NotEmpty(t, ended, "expected at least one span recorded; got 0")

	// Find the studio root span by name. startStudioSpan calls
	// tracer.Start with kind=SpanKindServer; identify it by parent
	// (its parent should be the REMOTE inbound span context).
	var rootStudioSpan sdktrace.ReadOnlySpan
	for _, s := range ended {
		if s.SpanKind() == trace.SpanKindServer && s.Parent().IsValid() && s.Parent().IsRemote() {
			rootStudioSpan = s
			break
		}
	}
	require.NotNil(t, rootStudioSpan,
		"no studio root span found with a remote parent — applyInboundCausality "+
			"did not extract the inbound traceparent into ctx, or startStudioSpan "+
			"started a fresh trace instead of continuing the inbound one")

	assert.Equal(t, inboundTraceID, rootStudioSpan.SpanContext().TraceID().String(),
		"studio root span trace_id must equal inbound traceparent's trace-id")
	assert.Equal(t, inboundSpanID, rootStudioSpan.Parent().SpanID().String(),
		"studio root span's parent span_id must equal inbound traceparent's span-id")
}

/** @scenario Every span emitted during an nlpgo evaluator run carries causality_depth via SpanProcessor */
func TestCausalityPropagation_AllSpansShareTraceIDAndCarryDepth(t *testing.T) {
	rec := installProductionTracerStack(t)
	url, _ := setupCausalityStack(t)

	const inboundTraceID = "11112222333344445555666677778888"
	const inboundSpanID = "aaaabbbbccccdddd"
	postWithTraceContext(t, url, minimalEvaluatorWorkflow, inboundTraceID, inboundSpanID, 0)

	ended := rec.Ended()
	require.GreaterOrEqual(t, len(ended), 2,
		"expected the studio root span and at least one child span (eval node); got %d",
		len(ended))

	// Every recorded span must share the inbound trace_id.
	for _, s := range ended {
		if got := s.SpanContext().TraceID().String(); got != inboundTraceID {
			t.Errorf("span %q has trace_id %s, want %s — trace context did not propagate through engine goroutines",
				s.Name(), got, inboundTraceID)
		}
	}

	// Every recorded span must carry langwatch.reserved.causality_depth = "1"
	// (inbound was 0 → handler stamps incoming+1 onto baggage; the
	// BaggageAttributeProcessor stamps the attribute on every span via
	// OnStart, not just root).
	for _, s := range ended {
		var found bool
		var value string
		for _, attr := range s.Attributes() {
			if string(attr.Key) == otelsetup.BaggageKeyCausalityDepth {
				found = true
				value = attr.Value.AsString()
				break
			}
		}
		if !found {
			t.Errorf("span %q missing %s attribute — BaggageAttributeProcessor did not stamp it",
				s.Name(), otelsetup.BaggageKeyCausalityDepth)
			continue
		}
		if value != "1" {
			t.Errorf("span %q has %s=%s, want \"1\" (inbound 0 + 1)",
				s.Name(), otelsetup.BaggageKeyCausalityDepth, value)
		}
	}
}

/** @scenario Outbound HTTP from nlpgo evaluator block carries traceparent + baggage + depth header */
func TestCausalityPropagation_OutboundHTTPInjectsTraceparentAndDepth(t *testing.T) {
	_ = installProductionTracerStack(t)
	url, captured := setupCausalityStack(t)

	const inboundTraceID = "0123456789abcdef0123456789abcdef"
	const inboundSpanID = "0011223344556677"
	postWithTraceContext(t, url, minimalEvaluatorWorkflow, inboundTraceID, inboundSpanID, 0)

	require.Len(t, *captured, 1,
		"expected exactly one outbound call to the fake LangWatch app, got %d", len(*captured))
	rec := (*captured)[0]

	// 1. traceparent must be set and share the inbound trace_id.
	require.NotEmpty(t, rec.traceparent,
		"evaluatorblock did not inject traceparent on the outbound request — "+
			"OTel propagator was not invoked or context lost the span")
	// W3C format: 00-<32-hex tid>-<16-hex sid>-<flags>
	parts := strings.Split(rec.traceparent, "-")
	require.Len(t, parts, 4, "malformed traceparent %q", rec.traceparent)
	assert.Equal(t, inboundTraceID, parts[1],
		"outbound traceparent trace-id must equal the inbound trace-id we started with")

	// 2. baggage header must contain the causality_depth member.
	require.NotEmpty(t, rec.baggage, "baggage header missing on outbound request")
	assert.Contains(t, rec.baggage, otelsetup.BaggageKeyCausalityDepth,
		"baggage header is missing the causality_depth member — Baggage propagator not applied")

	// 3. X-LangWatch-Causality-Depth header set to current (1) for
	//    non-OTel consumers (the langwatch app's collector reads this
	//    plain header to feed the dispatcher's reactor).
	assert.Equal(t, "1", rec.depthHeader,
		"X-LangWatch-Causality-Depth header must be \"1\" — incoming 0 + 1")
}

// Confirm Span.SpanContextConfig.Remote → ReadOnlySpan.Parent().IsRemote()
// is the property we expect to use as the "this is the root continuing a
// remote trace" heuristic. Trivial sanity test; cheap to keep so a
// refactor in tracetest can't silently invalidate the bigger tests.
func TestCausalityPropagation_SanityCheckParentIsRemoteFlag(t *testing.T) {
	rec := installProductionTracerStack(t)

	tracer := otelapi.Tracer("sanity")
	ctx := trace.ContextWithSpanContext(t.Context(), trace.NewSpanContext(trace.SpanContextConfig{
		TraceID:    trace.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16},
		SpanID:     trace.SpanID{1, 2, 3, 4, 5, 6, 7, 8},
		TraceFlags: trace.FlagsSampled,
		Remote:     true,
	}))
	_, span := tracer.Start(ctx, "child-of-remote")
	span.End()

	ended := rec.Ended()
	require.Len(t, ended, 1)
	assert.True(t, ended[0].Parent().IsRemote(),
		"sanity: a span started under a remote SpanContext must report Parent().IsRemote() = true")
}

// 2026-05-15 prod regression. Studio's playground frontend mints a
// trace_id and posts it in the request BODY only — no W3C traceparent
// header. startStudioSpan's pre-fix path synthesized a remote
// SpanContext with a freshly-minted random SpanID as the "parent" so
// the engine's children inherited the body trace_id. The studio root
// then ended up with parent_span_id = <random phantom> — a span that
// is never emitted anywhere. The LangWatch UI surfaces this as
// "Parent not in trace" against every workflow root, with a different
// random parent per invocation.
//
// Fix: when there's no inbound traceparent header, the studio root
// MUST be a true OTel root span (parent context invalid → parent_span_id
// is the zero SpanID in OTLP), with trace_id preserved via a
// context-aware IDGenerator.
/** @scenario Studio playground request with body trace_id but no traceparent header creates a true root span */
func TestCausalityPropagation_BodyTraceIDOnlyProducesTrueRootSpan(t *testing.T) {
	rec := installProductionTracerStack(t)
	url, _ := setupCausalityStack(t)

	const bodyTraceID = "deadbeefdeadbeefdeadbeefdeadbeef"

	body := `{
  "trace_id": "` + bodyTraceID + `",
  "origin": "workflow",
  "workflow": {
    "workflow_id":"wf","api_key":"sk-test","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
    "template_adapter":"default",
    "nodes":[
      {"id":"entry","type":"entry","data":{"train_size":1.0,"test_size":0.0,"seed":1,
        "outputs":[{"identifier":"input","type":"str"}],
        "dataset":{"inline":{"records":{"input":["hello"]},"count":1}}}},
      {"id":"end","type":"end","data":{}}
    ],
    "edges":[
      {"id":"e1","source":"entry","sourceHandle":"input","target":"end","targetHandle":"any","type":"default"}
    ],
    "state":{}
  }
}`

	req, err := http.NewRequest(http.MethodPost, url+"/go/studio/execute_sync", bytes.NewBufferString(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	// Deliberately NO traceparent header — this is what the playground
	// frontend ships today.

	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	require.Equal(t, http.StatusOK, resp.StatusCode, "body: %s", string(respBody))

	ended := rec.Ended()
	require.NotEmpty(t, ended, "expected at least one span recorded; got 0")

	// Find the studio root span. It's the SpanKindServer span started
	// by startStudioSpan. With the fix in place it must be a TRUE root:
	// parent SpanContext invalid, parent_span_id all-zeros in OTLP.
	var rootStudioSpan sdktrace.ReadOnlySpan
	for _, s := range ended {
		if s.SpanKind() == trace.SpanKindServer {
			rootStudioSpan = s
			break
		}
	}
	require.NotNil(t, rootStudioSpan,
		"no SpanKindServer span emitted — startStudioSpan didn't run")

	// Critical assertion: the studio root has NO valid parent. Before
	// the fix this was a valid-but-phantom span_id; the UI flagged it as
	// "Parent not in trace" on every playground invocation.
	assert.False(t, rootStudioSpan.Parent().IsValid(),
		"studio root must be a true root (no parent_span_id) when there's no inbound traceparent — "+
			"otherwise the LangWatch UI shows 'Parent not in trace' on every playground run. "+
			"Parent SpanContext: %s", rootStudioSpan.Parent().SpanID())

	// And trace_id continuity — the studio root must adopt the body
	// trace_id so the LangWatch "Full Trace" drawer can pivot on it.
	assert.Equal(t, bodyTraceID, rootStudioSpan.SpanContext().TraceID().String(),
		"studio root must preserve the body-supplied trace_id even when there's no inbound parent context")
}
