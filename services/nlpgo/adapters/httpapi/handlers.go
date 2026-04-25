package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/llmexecutor"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

// executeSyncHandler is the entry point for /go/studio/execute_sync.
// Body shape mirrors the Python ExecuteFlowPayload (and Sarah's engine
// accepts the same JSON): { trace_id, workflow, inputs?, origin? }.
// The handler reads the body, hands the workflow to the engine, and
// returns the engine's WorkflowResult as JSON. Errors come back as
// herr-formatted bodies so the TS app gets uniform error shapes.
func executeSyncHandler(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		executor := application.Executor()
		if executor == nil {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, herr.M{
				"reason": "engine_not_wired",
			}, errors.New("workflow executor missing from app")))
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"reason": "read_body",
			}, err))
			return
		}

		req, herrErr := decodeStudioClientEvent(r, body)
		if herrErr != nil {
			herr.WriteHTTP(w, *herrErr)
			return
		}
		ctx := r.Context()
		if req.Origin != "" {
			ctx = withOrigin(ctx, req.Origin)
		}
		result, err := executor.Execute(ctx, *req)
		if err != nil {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"reason": "engine_error",
			}, err))
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(result)
	}
}

// decodeStudioClientEvent parses the inbound body in either of the two
// shapes the Studio client emits:
//
//  1. Discriminated event (preferred — matches the Python
//     StudioClientEvent union sent by langwatch/src/server/workflows/
//     runWorkflow.ts):
//     {"type":"execute_flow"|"execute_component"|"execute_evaluation",
//      "payload":{trace_id, workflow, inputs?, origin?, ...}}
//
//  2. Flat envelope (used by tests + manual curl):
//     {trace_id, workflow, inputs?, origin?, project_id?}
//
// Both decode into the same WorkflowRequest. execute_optimization is
// rejected per the FF-on contract (optimization is dead — see
// specs/nlp-go/feature-flag.feature).
func decodeStudioClientEvent(r *http.Request, body []byte) (*app.WorkflowRequest, *herr.E) {
	// Peek the type field. The discriminated form has a top-level
	// "type" with payload nested under "payload"; the flat form
	// usually has neither but may have just "type" if the caller
	// already produced that shape — we treat absent or empty type as
	// "flat".
	var peek struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(body, &peek); err != nil {
		e := herr.New(r.Context(), domain.ErrBadRequest, herr.M{
			"reason": "parse_envelope",
		}, err)
		return nil, &e
	}

	if peek.Type == "execute_optimization" {
		e := herr.New(r.Context(), domain.ErrUnsupportedNodeKind, herr.M{
			"reason": "optimization_disabled_on_go_path",
		}, errors.New("execute_optimization is unsupported on the Go engine path; the Studio Optimize button is hidden when the FF is on"))
		return nil, &e
	}

	// Use payload bytes if discriminated; otherwise the whole body is
	// the flat shape.
	innerBytes := []byte(peek.Payload)
	if len(innerBytes) == 0 {
		innerBytes = body
	}

	var inner struct {
		TraceID   string          `json:"trace_id"`
		Workflow  json.RawMessage `json:"workflow"`
		Inputs    any             `json:"inputs,omitempty"`
		Origin    string          `json:"origin,omitempty"`
		ProjectID string          `json:"project_id,omitempty"`
	}
	if err := json.Unmarshal(innerBytes, &inner); err != nil {
		e := herr.New(r.Context(), domain.ErrBadRequest, herr.M{
			"reason": "parse_payload",
		}, err)
		return nil, &e
	}
	if len(inner.Workflow) == 0 {
		e := herr.New(r.Context(), domain.ErrBadRequest, herr.M{
			"reason": "missing_workflow",
		}, errors.New("'workflow' field required"))
		return nil, &e
	}

	origin := inner.Origin
	if origin == "" {
		origin = r.Header.Get("X-LangWatch-Origin")
	}
	return &app.WorkflowRequest{
		WorkflowJSON: inner.Workflow,
		Inputs:       normalizeInputs(inner.Inputs),
		Origin:       origin,
		TraceID:      inner.TraceID,
		ProjectID:    inner.ProjectID,
	}, nil
}

// withOrigin is a small wrapper around llmexecutor.WithOrigin so the
// adapter can shed the executor import if we later move origin
// propagation into the engine layer (where it arguably belongs).
func withOrigin(ctx context.Context, origin string) context.Context {
	return llmexecutor.WithOrigin(ctx, origin)
}

// normalizeInputs accepts either a single object or a one-element
// array (per the Python ExecuteFlowPayload.inputs shape). Returns nil
// to signal "use dataset materialization" when neither shape matches.
func normalizeInputs(v any) map[string]any {
	switch x := v.(type) {
	case map[string]any:
		return x
	case []any:
		if len(x) == 0 {
			return nil
		}
		if first, ok := x[0].(map[string]any); ok {
			return first
		}
		return nil
	}
	return nil
}

// executeStreamHandler is the entry point for /go/studio/execute.
// Returns Server-Sent Events: one `execution_state_change` per node
// transition (running → success/error), `is_alive` heartbeats every
// NLP_STREAM_HEARTBEAT_SECONDS, and a final `done` (or `error`) frame
// when the run completes. Closes when the client disconnects.
func executeStreamHandler(application *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		executor := application.Executor()
		if executor == nil {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, herr.M{
				"reason": "engine_not_wired",
			}, errors.New("workflow executor missing from app")))
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"reason": "read_body",
			}, err))
			return
		}
		req, herrErr := decodeStudioClientEvent(r, body)
		if herrErr != nil {
			herr.WriteHTTP(w, *herrErr)
			return
		}
		ctx := r.Context()
		if req.Origin != "" {
			ctx = withOrigin(ctx, req.Origin)
		}

		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)
		flusher, ok := w.(http.Flusher)
		if !ok {
			// Without flushing the events buffer indefinitely; surface
			// a structured error rather than silently underperforming.
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrInternal, herr.M{
				"reason": "no_flusher",
			}, errors.New("response writer does not support flushing")))
			return
		}

		streamCtx, cancel := context.WithCancel(ctx)
		defer cancel()
		// Watch the underlying connection. When the client closes, we
		// cancel streamCtx so engine + heartbeat goroutines exit.
		go func() {
			<-r.Context().Done()
			cancel()
		}()

		events, err := executor.ExecuteStream(streamCtx, *req, app.WorkflowStreamOptions{
			Heartbeat: streamHeartbeat(r),
		})
		if err != nil {
			writeSSE(w, flusher, "error", map[string]any{"message": err.Error()})
			return
		}

		for ev := range events {
			writeSSE(w, flusher, ev.Type, ev.Payload)
		}
	}
}

// writeSSE serializes one event frame as
//
//	data: {"type":"<type>","payload":{...}}\n\n
//
// matching the Python /studio/execute SSE contract that Studio's TS
// parser expects (langwatch/src/app/api/workflows/post_event/post-event.ts
// reads only `data:` lines and JSON.parses the rest). An optional
// `event:` line is intentionally omitted — the TS parser ignores it
// today and emitting it confused early SSE rounds-tripping. The
// `payload` key is omitted entirely when the event has no payload
// (e.g. is_alive_response, done — Python's bare events).
func writeSSE(w http.ResponseWriter, flusher http.Flusher, eventType string, payload map[string]any) {
	frame := map[string]any{"type": eventType}
	if len(payload) > 0 {
		frame["payload"] = payload
	}
	b, err := json.Marshal(frame)
	if err != nil {
		b = []byte(`{"type":"error","payload":{"message":"marshal_failed"}}`)
	}
	_, _ = w.Write([]byte("data: "))
	_, _ = w.Write(b)
	_, _ = w.Write([]byte("\n\n"))
	flusher.Flush()
}

// streamHeartbeat returns the heartbeat interval, defaulting to 15s
// when the request didn't override it via header. Tests use a tiny
// interval to verify ticking.
func streamHeartbeat(r *http.Request) time.Duration {
	if v := r.Header.Get("X-LangWatch-NLPGO-Heartbeat-MS"); v != "" {
		var ms int
		if _, err := fmt.Sscanf(v, "%d", &ms); err == nil && ms > 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}
	return 15 * time.Second
}

// proxyPassthroughHandler reverse-proxies /go/proxy/v1/* into the AI
// Gateway. Scaffold returns 501; the real implementation forwards via
// httputil.ReverseProxy after authenticating with the gateway internal
// secret.
func proxyPassthroughHandler(_ *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, herr.M{
			"reason": "gateway_proxy_not_implemented",
			"path":   r.URL.Path,
		}))
	}
}

// versionHandler echoes basic identity so callers can verify they're
// talking to nlpgo and not the Python upstream by accident.
func versionHandler(version string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"service": "nlpgo",
			"version": version,
		})
	}
}
