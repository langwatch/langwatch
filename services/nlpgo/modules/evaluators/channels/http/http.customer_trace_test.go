package http_test

import (
	"bytes"
	"context"
	"encoding/hex"
	"io"
	nethttp "net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	"google.golang.org/protobuf/proto"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	evalhttp "github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/http"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

const (
	acmeTraceID   = "4bf92f3577b34da6a3ce929d0e0e4736"
	globexTraceID = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
	callerSpanID  = "00f067aa0ba902b7"
	droppedMetric = "langwatch.nlpgo.evaluators.customer_trace.spans_dropped"
)

func traceparent(traceID string) string { return "00-" + traceID + "-" + callerSpanID + "-01" }

type receivedSpan struct {
	name, traceID, spanID, parentSpanID string
	attrs                               map[string]string
}

// otlpReceiver stands in for LangWatch's OTLP ingest, which decides the
// project from the token: spans are filed under the X-Auth-Token they came with.
type otlpReceiver struct {
	srv     *httptest.Server
	mu      sync.Mutex
	byToken map[string][]receivedSpan
	bodies  [][]byte
}

func newOTLPReceiver(t *testing.T) *otlpReceiver {
	t.Helper()
	rx := &otlpReceiver{byToken: map[string][]receivedSpan{}}
	rx.srv = httptest.NewServer(nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			nethttp.Error(w, "read body", nethttp.StatusBadRequest)
			return
		}
		var req coltracepb.ExportTraceServiceRequest
		if err := proto.Unmarshal(body, &req); err != nil {
			nethttp.Error(w, "decode body", nethttp.StatusBadRequest)
			return
		}
		token := r.Header.Get("X-Auth-Token")
		rx.mu.Lock()
		defer rx.mu.Unlock()
		rx.bodies = append(rx.bodies, body)
		for _, rs := range req.ResourceSpans {
			for _, ss := range rs.ScopeSpans {
				for _, s := range ss.Spans {
					attrs := map[string]string{}
					for _, kv := range s.Attributes {
						attrs[kv.Key] = anyString(kv.Value)
					}
					rx.byToken[token] = append(rx.byToken[token], receivedSpan{
						name: s.Name, traceID: hex.EncodeToString(s.TraceId),
						spanID: hex.EncodeToString(s.SpanId), parentSpanID: hex.EncodeToString(s.ParentSpanId),
						attrs: attrs,
					})
				}
			}
		}
		w.WriteHeader(nethttp.StatusOK)
	}))
	t.Cleanup(rx.srv.Close)
	return rx
}

func anyString(v *commonpb.AnyValue) string {
	switch x := v.GetValue().(type) {
	case *commonpb.AnyValue_StringValue:
		return x.StringValue
	case *commonpb.AnyValue_IntValue:
		return strconv.FormatInt(x.IntValue, 10)
	case *commonpb.AnyValue_BoolValue:
		return strconv.FormatBool(x.BoolValue)
	case *commonpb.AnyValue_DoubleValue:
		return strconv.FormatFloat(x.DoubleValue, 'g', -1, 64)
	}
	return v.String()
}

func (rx *otlpReceiver) spans(token string) []receivedSpan {
	rx.mu.Lock()
	defer rx.mu.Unlock()
	return append([]receivedSpan(nil), rx.byToken[token]...)
}

func (rx *otlpReceiver) total() int {
	rx.mu.Lock()
	defer rx.mu.Unlock()
	n := 0
	for _, spans := range rx.byToken {
		n += len(spans)
	}
	return n
}

func (rx *otlpReceiver) rawBodies() [][]byte {
	rx.mu.Lock()
	defer rx.mu.Unlock()
	return append([][]byte(nil), rx.bodies...)
}

func serviceCtx() context.Context {
	return contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{Service: "langwatch-nlpgo", Version: "test"})
}

func newChannel(t *testing.T, endpoint string) (*evalhttp.CustomerTrace, *sdkmetric.ManualReader) {
	t.Helper()
	reader := sdkmetric.NewManualReader()
	ct, err := evalhttp.NewCustomerTrace(serviceCtx(), evalhttp.CustomerTraceOptions{
		Endpoint:      endpoint,
		MeterProvider: sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)),
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = ct.Shutdown(context.Background()) })
	return ct, reader
}

func droppedNoToken(t *testing.T, reader *sdkmetric.ManualReader) int64 {
	t.Helper()
	var rm metricdata.ResourceMetrics
	require.NoError(t, reader.Collect(context.Background(), &rm))
	var total int64
	for _, sm := range rm.ScopeMetrics {
		for _, m := range sm.Metrics {
			sum, ok := m.Data.(metricdata.Sum[int64])
			if !ok || m.Name != droppedMetric {
				continue
			}
			for _, dp := range sum.DataPoints {
				if v, ok := dp.Attributes.Value("reason"); ok && v.AsString() == "no_token" {
					total += dp.Value
				}
			}
		}
	}
	return total
}

var (
	judgeRequest  = []byte(`{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Is the answer faithful?"}]}`)
	judgeResponse = []byte(`{"choices":[{"message":{"role":"assistant","content":"verdict-yes"}}]}`)
)

// runEvaluation traces one evaluation making one judge call.
func runEvaluation(ct *evalhttp.CustomerTrace, projectID, token, tp string) {
	ctx, end := ct.StartEvaluation(context.Background(), channels.EvaluationSpan{
		Tenant:    contract.Tenant{ProjectID: projectID},
		Evaluator: "langevals/llm_boolean",
		Trace:     contract.TraceRequest{Traceparent: tp, Token: token},
	})
	ct.StartCall(ctx, channels.CallSpan{Kind: "chat", Model: "openai/gpt-4o-mini"})(channels.CallOutcome{
		RequestBody: judgeRequest, ResponseBody: judgeResponse,
		Usage: channels.Usage{PromptTokens: 12, CompletionTokens: 3},
	})
	end(channels.EvaluationOutcome{Results: []contract.Result{{Status: contract.StatusProcessed}}})
}

// @scenario "The evaluator's model calls are traced into the tenant's own project"
func TestCustomerTrace_ModelCallsLandInTheTenantsOwnProject(t *testing.T) {
	rx := newOTLPReceiver(t)
	ct, _ := newChannel(t, rx.srv.URL)
	cost := 0.0004

	ctx, endEval := ct.StartEvaluation(context.Background(), channels.EvaluationSpan{
		Tenant:    contract.Tenant{ProjectID: "proj-acme"},
		Evaluator: "ragas/faithfulness",
		Trace:     contract.TraceRequest{Traceparent: traceparent(acmeTraceID), Token: "tok-acme"},
	})
	ct.StartCall(ctx, channels.CallSpan{Kind: "chat", Model: "openai/gpt-4o-mini"})(channels.CallOutcome{
		RequestBody: judgeRequest, ResponseBody: judgeResponse,
		Usage: channels.Usage{PromptTokens: 12, CompletionTokens: 3}, CostUSD: &cost,
	})
	// A tool-only judge answer: no text, no usage, no cost. Not a probe here.
	ct.StartCall(ctx, channels.CallSpan{Kind: "chat", Model: "openai/gpt-4o-mini"})(channels.CallOutcome{
		RequestBody: judgeRequest, ResponseBody: []byte(`{"choices":[]}`),
	})
	ct.StartCall(ctx, channels.CallSpan{Kind: "embeddings", Model: "openai/text-embedding-3-small"})(channels.CallOutcome{
		Usage: channels.Usage{PromptTokens: 4},
	})
	endEval(channels.EvaluationOutcome{Results: []contract.Result{{Status: contract.StatusProcessed}}})
	runEvaluation(ct, "proj-globex", "tok-globex", traceparent(globexTraceID))
	require.NoError(t, ct.Shutdown(context.Background()))

	acme := rx.spans("tok-acme")
	require.Len(t, acme, 4, "one evaluation span and one span per model call")
	var eval receivedSpan
	var calls []receivedSpan
	for _, s := range acme {
		if s.name == "evaluation.ragas/faithfulness" {
			eval = s
		} else {
			calls = append(calls, s)
		}
		assert.Equal(t, acmeTraceID, s.traceID, "every span continues the caller's trace")
		assert.Equal(t, "1", s.attrs["langwatch.reserved.causality_depth"], "evaluation traces never trigger evaluations")
		assert.NotContains(t, s.attrs, "langwatch.route_key")
	}
	require.NotEmpty(t, eval.spanID, "the evaluation span was exported")
	assert.Equal(t, callerSpanID, eval.parentSpanID)
	assert.NotContains(t, eval.attrs, "gen_ai.input.messages", "content rides on the call spans only")

	names := map[string]int{}
	for _, c := range calls {
		names[c.name]++
		assert.Equal(t, eval.spanID, c.parentSpanID, "each call is a child of the evaluation span")
	}
	assert.Equal(t, map[string]int{"gen_ai.chat": 2, "gen_ai.embeddings": 1}, names)
	var answered bool
	for _, c := range calls {
		if c.attrs["gen_ai.output.messages"] != "" {
			answered = true
			assert.Contains(t, c.attrs["gen_ai.input.messages"], "Is the answer faithful?")
			assert.Contains(t, c.attrs["gen_ai.output.messages"], "verdict-yes")
		}
	}
	assert.True(t, answered, "the judge's messages reach the tenant")

	globex := rx.spans("tok-globex")
	require.Len(t, globex, 2)
	for _, s := range globex {
		assert.Equal(t, globexTraceID, s.traceID, "no acme span reaches globex")
	}
}

// @scenario "A project id paired with another project's key cannot move spans"
func TestCustomerTrace_MispairedProjectAndKeyCannotMoveSpans(t *testing.T) {
	rx := newOTLPReceiver(t)
	ct, _ := newChannel(t, rx.srv.URL)
	const mispairedTraceID = "0badc0ffee0ddf00d0000000000000aa"
	const laterGlobexTraceID = "b1b2c3d4e5f60718293a4b5c6d7e8f90"

	runEvaluation(ct, "proj-globex", "tok-globex", traceparent(globexTraceID))
	runEvaluation(ct, "proj-globex", "tok-acme", traceparent(mispairedTraceID))
	runEvaluation(ct, "proj-globex", "tok-globex", traceparent(laterGlobexTraceID))
	require.NoError(t, ct.Shutdown(context.Background()))

	acme := rx.spans("tok-acme")
	require.Len(t, acme, 2)
	for _, s := range acme {
		assert.Equal(t, mispairedTraceID, s.traceID, "only the mispaired request reaches acme")
	}
	globex := rx.spans("tok-globex")
	require.Len(t, globex, 4, "globex's spans keep reaching globex, before and after")
	for _, s := range globex {
		assert.Contains(t, []string{globexTraceID, laterGlobexTraceID}, s.traceID)
	}
}

// @scenario "An evaluation that continues no trace is not traced"
func TestCustomerTrace_NoTraceparentTracesNothing(t *testing.T) {
	rx := newOTLPReceiver(t)
	ct, reader := newChannel(t, rx.srv.URL)

	runEvaluation(ct, "proj-acme", "tok-acme", "")
	require.NoError(t, ct.Shutdown(context.Background()))

	assert.Zero(t, rx.total(), "no span, so nothing that could trigger an evaluation")
	assert.Zero(t, droppedNoToken(t, reader))
}

// @scenario "An evaluation without a project key traces nothing to the tenant"
func TestCustomerTrace_NoTokenDropsAndCounts(t *testing.T) {
	rx := newOTLPReceiver(t)
	ct, reader := newChannel(t, rx.srv.URL)

	ctx, end := ct.StartEvaluation(context.Background(), channels.EvaluationSpan{
		Tenant:    contract.Tenant{ProjectID: "proj-acme"},
		Evaluator: "langevals/llm_boolean",
		Trace:     contract.TraceRequest{Traceparent: traceparent(acmeTraceID)},
	})
	require.NotNil(t, ctx, "the evaluation still runs")
	for range 2 {
		ct.StartCall(ctx, channels.CallSpan{Kind: "chat", Model: "openai/gpt-4o-mini"})(channels.CallOutcome{
			RequestBody: judgeRequest, ResponseBody: judgeResponse,
		})
	}
	end(channels.EvaluationOutcome{Results: []contract.Result{{Status: contract.StatusProcessed}}})
	require.NoError(t, ct.Shutdown(context.Background()))

	assert.Zero(t, rx.total())
	assert.Equal(t, int64(3), droppedNoToken(t, reader), "the evaluation span and both call spans")
}

// @scenario "Credentials never appear in exported spans"
func TestCustomerTrace_CredentialsNeverExported(t *testing.T) {
	rx := newOTLPReceiver(t)
	ct, _ := newChannel(t, rx.srv.URL)
	const providerKey = "sk-canary-provider-key"
	const projectKey = "tok-canary-project-key"

	ctx, end := ct.StartEvaluation(context.Background(), channels.EvaluationSpan{
		Tenant: contract.Tenant{ProjectID: "proj-acme", Env: map[string]string{
			"X_LITELLM_api_key": providerKey,
		}},
		Evaluator: "langevals/llm_boolean",
		Trace:     contract.TraceRequest{Traceparent: traceparent(acmeTraceID), Token: projectKey},
	})
	ct.StartCall(ctx, channels.CallSpan{Kind: "chat", Model: "openai/gpt-4o-mini"})(channels.CallOutcome{
		RequestBody: []byte(`{"model":"gpt-4o-mini","api_key":"` + providerKey +
			`","messages":[{"role":"user","content":"Is the answer faithful?"}]}`),
		ResponseBody: judgeResponse,
		Usage:        channels.Usage{PromptTokens: 12, CompletionTokens: 3},
	})
	end(channels.EvaluationOutcome{})
	require.NoError(t, ct.Shutdown(context.Background()))

	require.Len(t, rx.spans(projectKey), 2, "the spans were exported")
	fingerprint := strings.TrimPrefix(customertracebridge.RouteKey("proj-acme", projectKey), "proj-acme:")
	for _, body := range rx.rawBodies() {
		for _, secret := range []string{providerKey, projectKey, fingerprint, "langwatch.route_key"} {
			assert.False(t, bytes.Contains(body, []byte(secret)), "exported spans carry %q", secret)
		}
	}
}

func TestCustomerTrace_EmptyEndpointExportsNothing(t *testing.T) {
	ct, reader := newChannel(t, "")
	runEvaluation(ct, "proj-acme", "tok-acme", traceparent(acmeTraceID))
	require.NoError(t, ct.Shutdown(context.Background()))
	assert.Zero(t, droppedNoToken(t, reader))
}

func TestNewCustomerTrace_RejectsNonHTTPEndpoint(t *testing.T) {
	_, err := evalhttp.NewCustomerTrace(serviceCtx(), evalhttp.CustomerTraceOptions{Endpoint: "file:///etc/passwd"})
	require.ErrorIs(t, err, customertracebridge.ErrInvalidEndpoint)
}
