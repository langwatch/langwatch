package customertracebridge

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	"google.golang.org/protobuf/proto"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const (
	mirrorTestPrompt     = `[{"role":"user","content":"the patient is Jane Doe"}]`
	mirrorTestCompletion = "summarized the patient record"
)

// capturingIngest records every OTLP body it receives, keyed by nothing — the
// test decodes them and sorts the copies out by langwatch.project_id.
type capturingIngest struct {
	srv  *httptest.Server
	mu   sync.Mutex
	body [][]byte
}

func startCapturingIngest(t *testing.T) *capturingIngest {
	t.Helper()
	ci := &capturingIngest{}
	ci.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		ci.mu.Lock()
		ci.body = append(ci.body, body)
		ci.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(ci.srv.Close)
	return ci
}

// spansByProject decodes every captured body and buckets spans by their
// langwatch.project_id attribute.
func (c *capturingIngest) spansByProject(t *testing.T) map[string][]map[string]string {
	t.Helper()
	c.mu.Lock()
	bodies := append([][]byte(nil), c.body...)
	c.mu.Unlock()

	out := map[string][]map[string]string{}
	for _, body := range bodies {
		var req coltracepb.ExportTraceServiceRequest
		require.NoError(t, proto.Unmarshal(body, &req))
		for _, rs := range req.ResourceSpans {
			for _, ss := range rs.ScopeSpans {
				for _, span := range ss.Spans {
					attrs := map[string]string{}
					for _, a := range span.Attributes {
						attrs[a.GetKey()] = attrValue(a)
					}
					out[attrs[string(attrProjectID)]] = append(
						out[attrs[string(attrProjectID)]], attrs)
				}
			}
		}
	}
	return out
}

func attrValue(a *commonpb.KeyValue) string {
	v := a.GetValue()
	if s := v.GetStringValue(); s != "" {
		return s
	}
	return v.String()
}

// emitOne runs one full BeginSpan/EndSpan cycle through an emitter wired to the
// given mirror config, and flushes.
func emitOne(t *testing.T, mirror MirrorConfig, params domain.AITraceParams) *capturingIngest {
	t.Helper()
	ingest := startCapturingIngest(t)

	registry := NewRegistry()
	require.NoError(t, registry.Set("proj-customer", ingest.srv.URL, nil))
	if mirror.armed() {
		mirror.Endpoint = ingest.srv.URL
	}

	ctx := contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{
		Service: "langwatch-service-aigateway", Version: "test",
	})
	e, err := NewEmitter(ctx, EmitterOptions{
		Registry:     registry,
		BatchTimeout: 50 * time.Millisecond,
		Policy: Policy{Stamp: []attribute.KeyValue{
			attribute.String("langwatch.origin", "gateway"),
		}},
		Mirror: mirror,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = e.Shutdown(context.Background()) })

	spanCtx, _ := e.BeginSpan(ctx, "proj-customer", domain.RequestTypeChat)
	e.EndSpan(spanCtx, params)
	require.NoError(t, e.tp.ForceFlush(context.Background()))
	return ingest
}

func baseParams() domain.AITraceParams {
	return domain.AITraceParams{
		Model:        "gpt-test",
		Usage:        domain.Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15},
		RequestType:  domain.RequestTypeChat,
		RequestBody:  []byte(`{"messages":` + mirrorTestPrompt + `}`),
		ResponseBody: []byte(`{"choices":[{"message":{"role":"assistant","content":"` + mirrorTestCompletion + `"}}]}`),
	}
}

func armedMirror() MirrorConfig {
	return MirrorConfig{Endpoint: "set-by-emitOne", Key: "sk-mirror", ProjectID: "proj-mirror"}
}

func TestMirrorLeg(t *testing.T) {
	t.Run("when the tier is content", func(t *testing.T) {
		p := baseParams()
		p.MirrorTier = mirrorTierContent
		p.MirrorSourceOrgID = "org-acme"
		byProject := emitOne(t, armedMirror(), p).spansByProject(t)

		t.Run("the customer still receives their own span with content", func(t *testing.T) {
			spans := byProject["proj-customer"]
			require.Len(t, spans, 1)
			assert.Contains(t, spans[0][string(attrInputMessages)], "Jane Doe")
			assert.Contains(t, spans[0][string(attrOutputMessages)], mirrorTestCompletion)
		})

		t.Run("the mirror receives a copy carrying the content", func(t *testing.T) {
			spans := byProject["proj-mirror"]
			require.Len(t, spans, 1, "exactly one mirror copy")
			assert.Contains(t, spans[0][string(attrInputMessages)], "Jane Doe")
			assert.Contains(t, spans[0][string(attrOutputMessages)], mirrorTestCompletion)
		})

		t.Run("the mirror copy attributes the source organization", func(t *testing.T) {
			assert.Equal(t, "org-acme", byProject["proj-mirror"][0][string(attrOrgID)])
		})

		t.Run("the source organization never rides the customer's copy", func(t *testing.T) {
			_, present := byProject["proj-customer"][0][string(attrOrgID)]
			assert.False(t, present,
				"source-tenant attribution is mirror-only")
		})

		t.Run("neither copy carries the reserved mirror markers", func(t *testing.T) {
			for project, spans := range byProject {
				for _, attrs := range spans {
					_, hasTier := attrs[string(attrMirrorTier)]
					_, hasOrgMarker := attrs[string(attrMirrorSourceOrg)]
					assert.False(t, hasTier, "%s carries the reserved tier marker", project)
					assert.False(t, hasOrgMarker, "%s carries the reserved source marker", project)
				}
			}
		})
	})

	t.Run("when the tier is structural", func(t *testing.T) {
		p := baseParams()
		p.MirrorTier = mirrorTierStructural
		p.MirrorSourceOrgID = "org-acme"
		byProject := emitOne(t, armedMirror(), p).spansByProject(t)

		t.Run("the mirror copy carries no message bodies", func(t *testing.T) {
			spans := byProject["proj-mirror"]
			require.Len(t, spans, 1)
			_, hasIn := spans[0][string(attrInputMessages)]
			_, hasOut := spans[0][string(attrOutputMessages)]
			assert.False(t, hasIn, "structural must not carry the prompt")
			assert.False(t, hasOut, "structural must not carry the completion")
		})

		t.Run("the mirror copy keeps usage, model and attribution", func(t *testing.T) {
			attrs := byProject["proj-mirror"][0]
			assert.Equal(t, "org-acme", attrs[string(attrOrgID)])
			assert.NotEmpty(t, attrs["gen_ai.request.model"])
		})

		t.Run("the customer's own copy still carries their content", func(t *testing.T) {
			attrs := byProject["proj-customer"][0]
			assert.Contains(t, attrs[string(attrInputMessages)], "Jane Doe")
			assert.Contains(t, attrs[string(attrOutputMessages)], mirrorTestCompletion)
		})
	})

	t.Run("when the tier is skip", func(t *testing.T) {
		p := baseParams()
		p.MirrorTier = mirrorTierSkip
		byProject := emitOne(t, armedMirror(), p).spansByProject(t)

		assert.Len(t, byProject["proj-customer"], 1)
		assert.Empty(t, byProject["proj-mirror"], "skip must produce no mirror copy")
	})

	// Ordinary customer traffic carries no tier at all — the materialiser only
	// sets one for Langy virtual keys. It must never be mirrored.
	t.Run("when the bundle carries no tier", func(t *testing.T) {
		byProject := emitOne(t, armedMirror(), baseParams()).spansByProject(t)

		assert.Len(t, byProject["proj-customer"], 1)
		assert.Empty(t, byProject["proj-mirror"],
			"a VK with no mirror tier must never be mirrored")
	})

	// With no mirror configured (the self-hosted default) the leg is dormant and
	// the customer path is byte-for-byte what it always was.
	t.Run("when no mirror is configured", func(t *testing.T) {
		p := baseParams()
		p.MirrorTier = mirrorTierContent
		byProject := emitOne(t, MirrorConfig{}, p).spansByProject(t)

		require.Len(t, byProject["proj-customer"], 1)
		assert.Empty(t, byProject["proj-mirror"])
		assert.Contains(t, byProject["proj-customer"][0][string(attrInputMessages)], "Jane Doe")
	})
}

// A partially-configured mirror must not arm — an endpoint with no key would
// POST unauthenticated forever, and a key with no project id has nowhere to go.
func TestMirrorConfigArmedRequiresEveryField(t *testing.T) {
	for name, cfg := range map[string]MirrorConfig{
		"all set":       {Endpoint: "https://x", Key: "k", ProjectID: "p"},
		"no endpoint":   {Key: "k", ProjectID: "p"},
		"no key":        {Endpoint: "https://x", ProjectID: "p"},
		"no project id": {Endpoint: "https://x", Key: "k"},
	} {
		want := name == "all set"
		assert.Equal(t, want, cfg.armed(), name)
	}
}

// The mirror exporter must never mutate the batch it was handed — the batch's
// backing array belongs to the span processor.
func TestMirrorExporterDoesNotMutateBatch(t *testing.T) {
	stub := tracetest.SpanStub{
		Name: "gen_ai.chat",
		Attributes: []attribute.KeyValue{
			attrProjectID.String("proj-customer"),
			attrMirrorTier.String(mirrorTierContent),
			attrInputMessages.String(mirrorTestPrompt),
		},
	}
	original := stub.Snapshot()
	recorder := &recordingExporter{}
	m := mirrorExporter{inner: recorder, mirrorProjectID: "proj-mirror"}

	require.NoError(t, m.ExportSpans(context.Background(), []sdktrace.ReadOnlySpan{original}))

	// The span handed in still carries its marker and its original project.
	got := map[string]string{}
	for _, a := range original.Attributes() {
		got[string(a.Key)] = a.Value.AsString()
	}
	assert.Equal(t, "proj-customer", got[string(attrProjectID)])
	assert.Equal(t, mirrorTierContent, got[string(attrMirrorTier)],
		"the exporter must not strip markers from the caller's span")
	assert.Len(t, recorder.spans, 2, "customer copy + mirror copy")
}

type recordingExporter struct{ spans []sdktrace.ReadOnlySpan }

func (r *recordingExporter) ExportSpans(_ context.Context, spans []sdktrace.ReadOnlySpan) error {
	r.spans = append(r.spans, spans...)
	return nil
}
func (r *recordingExporter) Shutdown(context.Context) error { return nil }
