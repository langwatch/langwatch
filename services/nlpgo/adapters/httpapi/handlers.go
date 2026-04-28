package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/llmexecutor"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

// enrichRequestLogContext stamps the inbound studio-event identifiers
// onto the context-bound logger so every downstream log line emitted
// during this request carries them. Mirrors langwatch_nlp regression
// ff42237f3 ("add logging and project id to nlp logging") — without
// project_id on log lines, prod logs from nlpgo can't be filtered to
// a single customer's traffic, which makes incident triage and
// per-customer debugging much harder than on the Python path. Trace
// id + origin are the natural correlation siblings (project_id alone
// underspecifies the call) so they ride along.
func enrichRequestLogContext(ctx context.Context, req *app.WorkflowRequest) context.Context {
	fields := make([]zap.Field, 0, 3)
	if req.ProjectID != "" {
		fields = append(fields, zap.String("project_id", req.ProjectID))
	}
	if req.TraceID != "" {
		fields = append(fields, zap.String("trace_id", req.TraceID))
	}
	if req.Origin != "" {
		fields = append(fields, zap.String("origin", req.Origin))
	}
	if len(fields) == 0 {
		return ctx
	}
	return clog.With(ctx, fields...)
}

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
		ctx := enrichRequestLogContext(r.Context(), req)
		if req.Origin != "" {
			ctx = withOrigin(ctx, req.Origin)
		}
		ctx, span := startStudioSpan(ctx, "nlpgo.studio.execute_sync", req, req.APIKey)
		defer span.End()
		clog.Get(ctx).Info("execute_flow_received")
		result, err := executor.Execute(ctx, *req)
		if err != nil {
			span.RecordError(err)
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
		TraceID  string          `json:"trace_id"`
		ThreadID string          `json:"thread_id,omitempty"`
		Workflow json.RawMessage `json:"workflow"`
		Inputs   any             `json:"inputs,omitempty"`
		Origin   string          `json:"origin,omitempty"`
		// NodeID names the single node targeted by execute_component.
		// Studio's "Run with manual input" sends Inputs as the typed
		// values for THIS node, not as Entry-node outputs — see
		// langwatch/src/optimization_studio/hooks/useComponentExecution.ts.
		// Absent for execute_flow / execute_evaluation.
		NodeID    string `json:"node_id,omitempty"`
		ProjectID string `json:"project_id,omitempty"`
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
	threadID := inner.ThreadID
	if threadID == "" {
		threadID = r.Header.Get("X-LangWatch-Thread-Id")
	}
	return &app.WorkflowRequest{
		WorkflowJSON: inner.Workflow,
		Inputs:       normalizeInputs(inner.Inputs),
		Origin:       origin,
		TraceID:      inner.TraceID,
		ProjectID:    inner.ProjectID,
		ThreadID:     threadID,
		NodeID:       inner.NodeID,
		APIKey:       peekWorkflowAPIKey(inner.Workflow),
	}, nil
}

// peekWorkflowAPIKey extracts the `api_key` field from raw workflow
// JSON without parsing the full Workflow struct (a fully-typed parse
// happens later in cmd/engine_adapter). The handler needs the key
// up-front to seed the OTel context for its top-level span — without
// it, the TenantRouter drops the span and the trace is missing the
// root.
func peekWorkflowAPIKey(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var peek struct {
		APIKey string `json:"api_key"`
	}
	if err := json.Unmarshal(raw, &peek); err != nil {
		return ""
	}
	return peek.APIKey
}

// peekStudioControlEventType returns "is_alive" or "stop_execution"
// when the body is one of the bare Studio control envelopes that
// short-circuit before workflow decode. Returns "" for any other type
// (including execute_*) so the caller falls through to the normal
// engine path. Tolerates malformed JSON by returning "" — the regular
// decoder downstream will surface the structured error.
func peekStudioControlEventType(body []byte) string {
	var peek struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(body, &peek); err != nil {
		return ""
	}
	switch peek.Type {
	case "is_alive", "stop_execution":
		return peek.Type
	default:
		return ""
	}
}

// emitStudioControlEvent writes the SSE response for a Studio control
// event. Mirrors the Python sidecar contract:
//   - is_alive       → `is_alive_response` then `done`
//   - stop_execution → `done` only
//
// We write the SSE headers and a 200 ourselves rather than going
// through the full executeStreamHandler boilerplate so the control
// path stays cheap (no engine, no heartbeat goroutine, no streamCtx)
// and so the response shape can't accidentally diverge from the bare
// frames Studio's TS reducer expects.
func emitStudioControlEvent(w http.ResponseWriter, eventType string) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		// Same flusher constraint as the main path; surface a
		// structured error before any 200 OK lands on the wire.
		herr.WriteHTTP(w, herr.New(context.Background(), domain.ErrInternal, herr.M{
			"reason": "no_flusher",
		}, errors.New("response writer does not support flushing")))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	if eventType == "is_alive" {
		writeSSE(w, flusher, "is_alive_response", nil)
	}
	writeSSE(w, flusher, "done", nil)
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
// transition (running → success/error), `is_alive_response` heartbeats every
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
		// Studio fires `is_alive` (every ~7s) and `stop_execution` (on
		// user-initiated stop) as bare control events with no workflow
		// body. Pre-fix these went to the legacy `/studio/execute` path
		// and broke Studio UX whenever the Python sidecar wasn't running
		// (the post-100% target topology) — see PR #3483 dogfood
		// finding. Short-circuit before workflow decode and answer with
		// the same SSE frames the Python sidecar emits today: an
		// `is_alive_response` (the heartbeat pong Studio's
		// usePostEvent.tsx switches on) followed by `done`. For
		// `stop_execution` we emit `done` only — there's no in-process
		// execution to cancel since each request is independent; the
		// real cancel happens on the next /go/studio/execute via
		// client-context disconnection.
		if peeked := peekStudioControlEventType(body); peeked != "" {
			emitStudioControlEvent(w, peeked)
			return
		}

		req, herrErr := decodeStudioClientEvent(r, body)
		if herrErr != nil {
			herr.WriteHTTP(w, *herrErr)
			return
		}
		ctx := enrichRequestLogContext(r.Context(), req)
		if req.Origin != "" {
			ctx = withOrigin(ctx, req.Origin)
		}
		ctx, span := startStudioSpan(ctx, "nlpgo.studio.execute_stream", req, req.APIKey)
		defer span.End()
		clog.Get(ctx).Info("execute_flow_received", zap.Bool("stream", true))

		flusher, ok := w.(http.Flusher)
		if !ok {
			// Without flushing the events would buffer indefinitely;
			// surface a structured error rather than silently
			// underperforming. The flusher check has to happen BEFORE
			// any Set/WriteHeader call — once 200 OK is on the wire,
			// herr.WriteHTTP can no longer set a non-2xx status and
			// the client sees mixed signals.
			herr.WriteHTTP(w, herr.New(ctx, domain.ErrInternal, herr.M{
				"reason": "no_flusher",
			}, errors.New("response writer does not support flushing")))
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(http.StatusOK)

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

// PlaygroundProxy is the dispatcher surface the playground-proxy
// handler needs. The real implementation is *dispatcher.Dispatcher
// (services/aigateway/dispatcher); the interface lets tests pass a
// fake without spinning up a real Bifrost.
type PlaygroundProxy interface {
	Dispatch(ctx context.Context, req playgroundProxyRequest) (*playgroundProxyResponse, error)
	DispatchStream(ctx context.Context, req playgroundProxyRequest) (playgroundProxyStream, error)
}

// proxyPassthroughHandler implements /go/proxy/v1/* — the OpenAI-shape
// playground proxy. Reads x-litellm-* credential headers, builds a
// dispatcher request, forwards via the in-process aigateway dispatcher,
// streams the response back.
//
// Wire shape:
//   - Path -> RequestType: /chat/completions = chat, /messages = messages,
//     /embeddings = embeddings, /responses = responses, anything else
//     under /v1beta/* = passthrough.
//   - body.stream=true picks DispatchStream; default DispatchMutex.
//   - body.model lets us infer the bare model id when the request has
//     a provider-prefixed model (`openai/gpt-5-mini` → `gpt-5-mini`).
//
// Returns:
//   - 200 + verbatim provider response body for non-streaming.
//   - 200 + Server-Sent Events for streaming, mirroring the SSE wire
//     shape the playground UI expects today (text/event-stream
//     newline-delimited frames).
//   - 400 on missing-provider/bad-body input errors.
//   - 502 when the upstream provider returns an error or the
//     dispatcher errors mid-stream.
func proxyPassthroughHandler(proxy PlaygroundProxy) http.HandlerFunc {
	if proxy == nil {
		// Fall back to the original 501 stub when the dispatcher isn't
		// wired (eg. in tests that don't exercise the playground path).
		return func(w http.ResponseWriter, r *http.Request) {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, herr.M{
				"reason": "gateway_proxy_not_wired",
				"path":   r.URL.Path,
			}, errors.New("playground proxy not wired")))
		}
	}
	return playgroundProxyDispatch(proxy)
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
