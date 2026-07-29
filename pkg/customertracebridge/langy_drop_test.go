package customertracebridge

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	"google.golang.org/protobuf/proto"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// exportedTraceIDs decodes every captured body into the hex trace ids of the
// exported spans.
func (c *capturingIngest) exportedTraceIDs(t *testing.T) []string {
	t.Helper()
	c.mu.Lock()
	bodies := append([][]byte(nil), c.body...)
	c.mu.Unlock()

	var ids []string
	for _, body := range bodies {
		var req coltracepb.ExportTraceServiceRequest
		require.NoError(t, proto.Unmarshal(body, &req))
		for _, rs := range req.ResourceSpans {
			for _, ss := range rs.ScopeSpans {
				for _, span := range ss.Spans {
					ids = append(ids, hexTraceID(span.TraceId))
				}
			}
		}
	}
	return ids
}

func hexTraceID(id []byte) string {
	const hexdigits = "0123456789abcdef"
	out := make([]byte, 0, len(id)*2)
	for _, b := range id {
		out = append(out, hexdigits[b>>4], hexdigits[b&0xf])
	}
	return string(out)
}

// emitWith runs one BeginSpan/EndSpan cycle with an optional inbound
// traceparent, against a plain (mirror-off) emitter, and flushes.
func emitWith(t *testing.T, traceparent string, params domain.AITraceParams) *capturingIngest {
	t.Helper()
	ingest := startCapturingIngest(t)

	registry := NewRegistry()
	require.NoError(t, registry.Set("proj-customer", ingest.srv.URL, nil))

	ctx := contexts.SetServiceInfo(context.Background(), contexts.ServiceInfo{
		Service: "langwatch-service-aigateway", Version: "test",
	})
	e, err := NewEmitter(ctx, EmitterOptions{
		Registry:     registry,
		BatchTimeout: 50 * time.Millisecond,
	})
	require.NoError(t, err)
	t.Cleanup(func() { _ = e.Shutdown(context.Background()) })

	if traceparent != "" {
		ctx = WithTraceParent(ctx, traceparent)
	}
	spanCtx, _ := e.BeginSpan(ctx, "proj-customer", domain.RequestTypeChat)
	e.EndSpan(spanCtx, params)
	require.NoError(t, e.tp.ForceFlush(context.Background()))
	return ingest
}

// A Langy turn's model call must land INSIDE the turn's trace, and when the
// turn's trace context did not arrive, the standalone copy that would
// duplicate the turn in the trace explorer is dropped instead of exported.
// Ordinary gateway traffic (playground, customer API keys, no mirror tier)
// keeps its standalone root: that trace is the only one such traffic has.
func TestEndSpan_LangyStandaloneDuplicateIsDropped(t *testing.T) {
	langyParams := func() domain.AITraceParams {
		p := baseParams()
		p.MirrorTier = mirrorTierContent
		return p
	}

	// @scenario "A Langy turn is one trace with the model call inside it"
	t.Run("given a Langy call carrying the turn's traceparent", func(t *testing.T) {
		const turnTrace = "4bf92f3577b34da6a3ce929d0e0e4736"
		ids := emitWith(t, "00-"+turnTrace+"-00f067aa0ba902b7-01", langyParams()).
			exportedTraceIDs(t)

		require.Len(t, ids, 1, "the joined span must be exported")
		assert.Equal(t, turnTrace, ids[0], "the span must continue the turn's trace")
	})

	t.Run("given a Langy call without the turn's traceparent", func(t *testing.T) {
		t.Run("the standalone copy is not exported", func(t *testing.T) {
			ids := emitWith(t, "", langyParams()).exportedTraceIDs(t)
			assert.Empty(t, ids,
				"an unjoinable Langy span duplicates the turn and must be dropped")
		})

		t.Run("a failed call is dropped the same way", func(t *testing.T) {
			p := langyParams()
			p.UpstreamStatusCode = 502
			p.UpstreamErrorType = "provider_error"
			ids := emitWith(t, "", p).exportedTraceIDs(t)
			assert.Empty(t, ids,
				"the turn span carries the failure; the standalone copy still duplicates")
		})

		t.Run("the structural tier is dropped too", func(t *testing.T) {
			p := langyParams()
			p.MirrorTier = mirrorTierStructural
			ids := emitWith(t, "", p).exportedTraceIDs(t)
			assert.Empty(t, ids)
		})
	})

	// @scenario "Gateway traffic outside a Langy turn keeps its own trace"
	t.Run("given ordinary gateway traffic without a traceparent", func(t *testing.T) {
		ids := emitWith(t, "", baseParams()).exportedTraceIDs(t)
		require.Len(t, ids, 1,
			"a standalone root is the ONLY trace plain gateway traffic has; it must survive")
	})
}
