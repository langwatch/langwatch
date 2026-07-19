package customertracebridge

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/ptrace"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// ingest is a stand-in for a project's OTLP ingest. It records the auth token
// on every request it receives, which is what actually decides the tenant the
// spans are stored under.
type ingest struct {
	*httptest.Server
	mu       sync.Mutex
	tokens   []string
	projects []string
}

func newIngest(t *testing.T) *ingest {
	t.Helper()
	in := &ingest{}
	in.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("read OTLP body: %v", err)
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}
		traces, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(body)
		if err != nil {
			t.Errorf("unmarshal OTLP body: %v", err)
			http.Error(w, "unmarshal body", http.StatusBadRequest)
			return
		}

		in.mu.Lock()
		in.tokens = append(in.tokens, r.Header.Get("X-Auth-Token"))
		resources := traces.ResourceSpans()
		for i := 0; i < resources.Len(); i++ {
			scopes := resources.At(i).ScopeSpans()
			for j := 0; j < scopes.Len(); j++ {
				spans := scopes.At(j).Spans()
				for k := 0; k < spans.Len(); k++ {
					projectID := ""
					if value, ok := spans.At(k).Attributes().Get(string(attrProjectID)); ok {
						projectID = value.Str()
					}
					in.projects = append(in.projects, projectID)
				}
			}
		}
		in.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(in.Close)
	return in
}

func (i *ingest) receivedProjects() []string {
	i.mu.Lock()
	defer i.mu.Unlock()
	return append([]string(nil), i.projects...)
}

func (i *ingest) received() []string {
	i.mu.Lock()
	defer i.mu.Unlock()
	return append([]string(nil), i.tokens...)
}

// captureExporter collects finished spans so tests can hand real
// ReadOnlySpans to the router.
type captureExporter struct{ spans []sdktrace.ReadOnlySpan }

func (c *captureExporter) ExportSpans(_ context.Context, s []sdktrace.ReadOnlySpan) error {
	c.spans = append(c.spans, s...)
	return nil
}
func (c *captureExporter) Shutdown(context.Context) error { return nil }

// spansFor builds one finished span per project id. An empty id produces a span
// with no langwatch.project_id attribute at all.
func spansFor(t *testing.T, projectIDs ...string) []sdktrace.ReadOnlySpan {
	t.Helper()
	collector := &captureExporter{}
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithSyncer(collector),
		sdktrace.WithSampler(sdktrace.AlwaysSample()),
	)
	tr := tp.Tracer("test")
	for _, pid := range projectIDs {
		_, span := tr.Start(context.Background(), "gen_ai.chat")
		if pid != "" {
			span.SetAttributes(attrProjectID.String(pid))
		}
		span.End()
	}
	require.NoError(t, tp.Shutdown(context.Background()))
	return collector.spans
}

func TestRouterExporter_RoutesEachProjectToItsOwnIngestOnly(t *testing.T) {
	alpha, beta := newIngest(t), newIngest(t)
	reg := NewRegistry()
	require.NoError(t, reg.Set("proj-alpha", alpha.URL, map[string]string{"X-Auth-Token": "tok-alpha"}))
	require.NoError(t, reg.Set("proj-beta", beta.URL, map[string]string{"X-Auth-Token": "tok-beta"}))

	router := newRouterExporter(context.Background(), reg)
	require.NoError(t, router.ExportSpans(context.Background(),
		spansFor(t, "proj-alpha", "proj-beta", "proj-alpha")))

	assert.Equal(t, []string{"tok-alpha"}, alpha.received(),
		"alpha's ingest must only ever be handed alpha's token")
	assert.Equal(t, []string{"tok-beta"}, beta.received(),
		"beta's ingest must only ever be handed beta's token")
	assert.Equal(t, []string{"proj-alpha", "proj-alpha"}, alpha.receivedProjects(),
		"alpha must receive only alpha's span bodies")
	assert.Equal(t, []string{"proj-beta"}, beta.receivedProjects(),
		"beta must receive only beta's span bodies")
}

// The regression that matters: before this, exporterFor returned the cached
// exporter without consulting the registry, so a rotated token kept shipping
// under the old credential for the lifetime of the process.
func TestRouterExporter_RebuildsAfterTokenRotation(t *testing.T) {
	in := newIngest(t)
	reg := NewRegistry()
	require.NoError(t, reg.Set("proj-1", in.URL, map[string]string{"X-Auth-Token": "old-token"}))

	router := newRouterExporter(context.Background(), reg)
	require.NoError(t, router.ExportSpans(context.Background(), spansFor(t, "proj-1")))

	require.NoError(t, reg.Set("proj-1", in.URL, map[string]string{"X-Auth-Token": "new-token"}))
	require.NoError(t, router.ExportSpans(context.Background(), spansFor(t, "proj-1")))

	assert.Equal(t, []string{"old-token", "new-token"}, in.received(),
		"the export after rotation must carry the new token, not the cached one")
}

// A project reassigned to a different destination must stop being delivered to
// the previous one — the shape a mispaired registry entry takes once corrected.
func TestRouterExporter_RebuildsAfterEndpointChange(t *testing.T) {
	first, second := newIngest(t), newIngest(t)
	reg := NewRegistry()
	require.NoError(t, reg.Set("proj-1", first.URL, map[string]string{"X-Auth-Token": "tok"}))

	router := newRouterExporter(context.Background(), reg)
	require.NoError(t, router.ExportSpans(context.Background(), spansFor(t, "proj-1")))

	require.NoError(t, reg.Set("proj-1", second.URL, map[string]string{"X-Auth-Token": "tok"}))
	require.NoError(t, router.ExportSpans(context.Background(), spansFor(t, "proj-1")))

	assert.Len(t, first.received(), 1, "the retired endpoint must receive nothing further")
	assert.Len(t, second.received(), 1, "the new endpoint must receive the later batch")
}

// Fail closed: a span with no project id has no provable owner, so it must not
// be delivered to anyone rather than being routed to a default.
func TestRouterExporter_DropsSpansWithoutProjectID(t *testing.T) {
	in := newIngest(t)
	reg := NewRegistry()
	require.NoError(t, reg.Set("proj-1", in.URL, map[string]string{"X-Auth-Token": "tok"}))

	router := newRouterExporter(context.Background(), reg)
	require.NoError(t, router.ExportSpans(context.Background(), spansFor(t, "")))

	assert.Empty(t, in.received(), "an unattributed span must not reach any project")
}

func TestRouterExporter_DropsSpansForUnregisteredProject(t *testing.T) {
	in := newIngest(t)
	reg := NewRegistry()
	require.NoError(t, reg.Set("proj-1", in.URL, map[string]string{"X-Auth-Token": "tok"}))

	router := newRouterExporter(context.Background(), reg)
	require.NoError(t, router.ExportSpans(context.Background(), spansFor(t, "proj-unknown")))

	assert.Empty(t, in.received(), "a project with no registry entry must not borrow another's exporter")
}

// Clearing a project's entry must take effect immediately, not at LRU eviction.
func TestRouterExporter_StopsExportingAfterRegistryCleared(t *testing.T) {
	in := newIngest(t)
	reg := NewRegistry()
	require.NoError(t, reg.Set("proj-1", in.URL, map[string]string{"X-Auth-Token": "tok"}))

	router := newRouterExporter(context.Background(), reg)
	require.NoError(t, router.ExportSpans(context.Background(), spansFor(t, "proj-1")))

	require.NoError(t, reg.Set("proj-1", "", nil))
	require.NoError(t, router.ExportSpans(context.Background(), spansFor(t, "proj-1")))

	assert.Len(t, in.received(), 1, "no export may follow a cleared registry entry")
}

func TestRouterExporter_SurfacesExportFailure(t *testing.T) {
	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	t.Cleanup(failing.Close)

	reg := NewRegistry()
	require.NoError(t, reg.Set("proj-1", failing.URL, map[string]string{"X-Auth-Token": "revoked"}))

	router := newRouterExporter(context.Background(), reg)
	err := router.ExportSpans(context.Background(), spansFor(t, "proj-1"))

	assert.Error(t, err, "a rejected export must not be silently discarded")
}

func TestRouterExporter_SurfacesExporterBuildFailure(t *testing.T) {
	in := newIngest(t)
	reg := NewRegistry()
	require.NoError(t, reg.Set("proj-1", in.URL, map[string]string{"X-Auth-Token": "tok"}))
	router := newRouterExporter(context.Background(), reg)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := router.ExportSpans(ctx, spansFor(t, "proj-1"))

	require.Error(t, err)
	require.ErrorIs(t, err, context.Canceled)
	assert.Empty(t, in.received(), "a failed exporter build must not report a successful delivery")
}

func TestHeadersEqual(t *testing.T) {
	assert.True(t, headersEqual(map[string]string{"a": "1"}, map[string]string{"a": "1"}))
	assert.False(t, headersEqual(map[string]string{"a": "1"}, map[string]string{"a": "2"}))
	assert.False(t, headersEqual(map[string]string{"a": "1"}, map[string]string{"a": "1", "b": "2"}))
	assert.True(t, headersEqual(nil, nil))
}
