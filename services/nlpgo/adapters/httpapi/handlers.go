package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
			writeHandlerError(r.Context(), w, herr.New(r.Context(), domain.ErrInternal, herr.M{
				"reason": "engine_not_wired",
			}, errors.New("workflow executor missing from app")))
			return
		}
		body, err := readStudioRequestBody(r, stagedPayloadClient)
		if err != nil {
			writeHandlerError(r.Context(), w, herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"reason": "read_body",
			}, err))
			return
		}

		req, herrErr := decodeStudioClientEvent(r, body)
		if herrErr != nil {
			writeHandlerError(r.Context(), w, *herrErr)
			return
		}
		ctx := enrichRequestLogContext(r.Context(), req)
		if req.Origin != "" {
			ctx = withOrigin(ctx, req.Origin)
		}
		ctx = applyInboundCausality(ctx, r)
		ctx, span := startStudioSpan(ctx, req, req.APIKey)
		defer span.End()
		clog.Get(ctx).Info("execute_flow_received")
		result, err := executor.Execute(ctx, *req)
		if err != nil {
			span.RecordError(err)
			// Use the enriched ctx so the request_failed line carries
			// project_id / trace_id / origin for per-customer filtering.
			writeHandlerError(ctx, w, herr.New(ctx, domain.ErrBadRequest, herr.M{
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
//     StudioClientEvent union declared by
//     packages/features/workflow/contract/src/studio-events.ts):
//     {"type":"execute_flow"|"execute_component"|"execute_evaluation",
//     "payload":{trace_id, workflow, inputs?, origin?, ...}}
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
		NodeID string `json:"node_id,omitempty"`
		// UntilNodeID scopes a flow run to the dependency path of the
		// named node — Studio's "Run until here" gesture (Nodes.tsx
		// per-node Play button → startWorkflowExecution({untilNodeId})
		// → useWorkflowExecution.ts sends until_node_id on the event
		// payload). Disconnected siblings + everything downstream of
		// the target are trimmed in the planner (planner.WithUntilNode).
		// Mirrors `ExecuteFlowPayload.until_node_id` on the Python side.
		UntilNodeID string `json:"until_node_id,omitempty"`
		ProjectID   string `json:"project_id,omitempty"`
		// RunID is present only on execute_evaluation envelopes
		// (packages/features/workflow/web/src/ui/sections/optimization_studio/use-evaluation-execution.ts).
		// Plumbed through to the engine so evaluation_state_change events
		// carry the run_id Studio's reducer keys evaluations on.
		RunID string `json:"run_id,omitempty"`
		// Evaluation-only fields (execute_evaluation envelope):
		// langwatch/src/optimization_studio/types/events.ts.
		WorkflowVersionID string `json:"workflow_version_id,omitempty"`
		EvaluateOn        string `json:"evaluate_on,omitempty"`
		DatasetEntry      *int   `json:"dataset_entry,omitempty"`
		// DoNotTrace is set by sub-workflow callers (Python's
		// CustomNode.forward / Go's agentblock.WorkflowRunner inject it
		// on /api/workflows/<id>/run bodies) to suppress trace emission
		// on the inner run, preventing double-counted spans when a
		// parent workflow already owns the trace. Mirrors
		// langwatch_nlp/studio/types/events.py:57 + execute_flow.py:53.
		DoNotTrace bool `json:"do_not_trace,omitempty"`
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
	// Combine envelope-level do_not_trace with the workflow's
	// enable_tracing setting (default true). Either being false
	// suppresses the studio span. Mirrors execute_flow.py:53 logic
	// `not workflow.enable_tracing or event.do_not_trace`.
	doNotTrace := inner.DoNotTrace
	if !peekWorkflowEnableTracing(inner.Workflow) {
		doNotTrace = true
	}

	return &app.WorkflowRequest{
		WorkflowJSON:      inner.Workflow,
		Inputs:            normalizeInputs(inner.Inputs),
		Origin:            origin,
		TraceID:           inner.TraceID,
		ProjectID:         inner.ProjectID,
		ThreadID:          threadID,
		NodeID:            inner.NodeID,
		UntilNodeID:       inner.UntilNodeID,
		APIKey:            peekWorkflowAPIKey(inner.Workflow),
		WorkflowName:      peekWorkflowName(inner.Workflow),
		Type:              peek.Type,
		RunID:             inner.RunID,
		WorkflowVersionID: inner.WorkflowVersionID,
		EvaluateOn:        inner.EvaluateOn,
		DatasetEntry:      inner.DatasetEntry,
		DoNotTrace:        doNotTrace,
	}, nil
}

// peekWorkflowName extracts the user-visible workflow name from raw
// workflow JSON. Used by the OTel root span so operators see "My
// Translation Agent" in the trace drawer instead of a generic
// "execute_flow" — Python parity is `optional_langwatch_trace(name=
// workflow.name)` at execute_flow.py. Falls back to empty on
// missing/malformed input so the caller can use the event-type
// default.
func peekWorkflowName(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var peek struct {
		Name string `json:"name"`
	}
	if err := json.Unmarshal(raw, &peek); err != nil {
		return ""
	}
	return peek.Name
}

// peekWorkflowEnableTracing extracts `enable_tracing` from the raw
// workflow JSON without parsing the full Workflow struct. Default is
// true (parity with Python's pydantic Workflow.enable_tracing default
// at langwatch_nlp/studio/types/dsl.py and the Studio TS DSL where
// the field is optional + defaults to true downstream). Returns true
// on parse error so a malformed workflow doesn't unintentionally
// suppress all observability before the engine even runs.
func peekWorkflowEnableTracing(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return true
	}
	var peek struct {
		EnableTracing *bool `json:"enable_tracing"`
	}
	if err := json.Unmarshal(raw, &peek); err != nil {
		return true
	}
	if peek.EnableTracing == nil {
		return true
	}
	return *peek.EnableTracing
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
		writeHandlerError(context.Background(), w, herr.New(context.Background(), domain.ErrInternal, herr.M{
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

// decodeStudioStreamRequest reads the /go/studio/execute body, answers a
// bare Studio control event in place, and decodes the workflow request.
// Returns nil once the response has been written and the caller must stop.
func decodeStudioStreamRequest(w http.ResponseWriter, r *http.Request) *app.WorkflowRequest {
	body, err := readStudioRequestBody(r, stagedPayloadClient)
	if err != nil {
		writeHandlerError(r.Context(), w, herr.New(r.Context(), domain.ErrBadRequest, herr.M{
			"reason": "read_body",
		}, err))
		return nil
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
		return nil
	}

	req, herrErr := decodeStudioClientEvent(r, body)
	if herrErr != nil {
		writeHandlerError(r.Context(), w, *herrErr)
		return nil
	}
	return req
}

// studioStreamContext folds the decoded request's identity, origin and
// inbound causality into the request context the stream runs under.
func studioStreamContext(r *http.Request, req *app.WorkflowRequest) context.Context {
	ctx := enrichRequestLogContext(r.Context(), req)
	if req.Origin != "" {
		ctx = withOrigin(ctx, req.Origin)
	}
	return applyInboundCausality(ctx, r)
}

// sseStream is the write side of one Server-Sent Events response: the
// writer paired with the flusher that puts each frame on the wire
// immediately. Bundled so the stream loop passes one value instead of
// threading both through every frame-writing helper.
type sseStream struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

// write puts one event frame on the wire and flushes it.
func (s sseStream) write(eventType string, payload map[string]any) {
	writeSSE(s.w, s.flusher, eventType, payload)
}

// beginSSEResponse commits the SSE response headers and returns the stream
// the event loop writes through. The second result is false once a
// structured error has been written instead and the caller must stop.
func beginSSEResponse(ctx context.Context, w http.ResponseWriter) (sseStream, bool) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		// Without flushing the events would buffer indefinitely;
		// surface a structured error rather than silently
		// underperforming. The flusher check has to happen BEFORE
		// any Set/WriteHeader call — once 200 OK is on the wire,
		// herr.WriteHTTP can no longer set a non-2xx status and
		// the client sees mixed signals.
		writeHandlerError(ctx, w, herr.New(ctx, domain.ErrInternal, herr.M{
			"reason": "no_flusher",
		}, errors.New("response writer does not support flushing")))
		return sseStream{}, false
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	return sseStream{w: w, flusher: flusher}, true
}

// drain copies engine events onto the SSE wire until the
// engine closes the channel or goes silent for `idle`.
//
// `idle` is a silence budget, not a wall clock: every event restarts it, so
// a long run that keeps reporting progress is never cut off. Idle detection
// lives here rather than in engine.ExecuteStream because only the handler
// observes whether a frame reached the client (see app/engine/stream.go).
//
// The timer is reset without draining its channel, which is safe from Go
// 1.23 on: a stopped or reset timer never delivers a stale tick.
func (s sseStream) drain(ctx context.Context, events <-chan app.WorkflowStreamEvent, idle time.Duration) {
	timer := time.NewTimer(idle)
	defer timer.Stop()
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return
			}
			s.write(ev.Type, ev.Payload)
			timer.Reset(idle)
		case <-timer.C:
			s.writeIdleTimeout(ctx, idle)
			return
		}
	}
}

// writeIdleTimeout ends a silent stream with the terminal `error`
// frame Studio's parser reads, naming domain.ErrIdleTimeout so the client
// can tell a stalled run from a completed one.
//
// The frame carries the code rather than a 504 because the SSE headers are
// committed before the first event is drained: once 200 OK is on the wire
// the status registered for ErrIdleTimeout (router.go) can no longer be
// sent. Returning ends the handler, which cancels the stream context and
// tears the engine goroutines down.
func (s sseStream) writeIdleTimeout(ctx context.Context, idle time.Duration) {
	message := fmt.Sprintf("%s: no stream event for %s", domain.ErrIdleTimeout, idle)
	clog.Get(ctx).Error("studio_stream_idle_timeout",
		zap.String("fault", "platform"),
		zap.String("code", domain.ErrIdleTimeout.String()),
		zap.Duration("idle", idle))
	s.write("error", map[string]any{"message": message})
}

// executeStreamHandler is the entry point for /go/studio/execute.
// Returns Server-Sent Events: one `execution_state_change` per node
// transition (running → success/error), `is_alive_response` heartbeats every
// NLPGO_ENGINE_STREAM_HEARTBEAT_SECONDS, and a final `done` (or `error`)
// frame when the run completes. Closes when the client disconnects, or when
// the engine emits nothing for NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS.
func executeStreamHandler(application *app.App, configuredHeartbeat, configuredIdle time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		executor := application.Executor()
		if executor == nil {
			writeHandlerError(r.Context(), w, herr.New(r.Context(), domain.ErrInternal, herr.M{
				"reason": "engine_not_wired",
			}, errors.New("workflow executor missing from app")))
			return
		}
		req := decodeStudioStreamRequest(w, r)
		if req == nil {
			return
		}
		ctx, span := startStudioSpan(studioStreamContext(r, req), req, req.APIKey)
		defer span.End()
		clog.Get(ctx).Info("execute_flow_received", zap.Bool("stream", true))

		out, ok := beginSSEResponse(ctx, w)
		if !ok {
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
			Heartbeat: streamHeartbeat(r, configuredHeartbeat),
		})
		if err != nil {
			// The SSE error frame reaches the client; this line is the
			// server-side trail for it (the engine stream failed to start).
			clog.Get(ctx).Error("studio_stream_failed",
				zap.String("fault", "platform"), zap.String("message", err.Error()))
			out.write("error", map[string]any{"message": err.Error()})
			return
		}

		out.drain(ctx, events, streamIdleTimeout(configuredIdle))
	}
}

// writeSSE serializes one event frame as
//
//	data: {"type":"<type>","payload":{...}}\n\n
//
// matching the Python /studio/execute SSE contract that Studio's TS
// parser expects (packages/features/workflow/server/src/adapters/
// workflow-studio-stream.adapter.ts reads only `data:` lines and JSON.parses
// the rest). An optional
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

// DefaultStreamHeartbeat is the is_alive_response cadence applied when
// neither the request header nor the operator config names one. Matches
// specs/nlp-go/_shared/contract.md §6; clients detect a dead stream by
// missed heartbeats, so changing it is a contract change.
const DefaultStreamHeartbeat = 15 * time.Second

// streamHeartbeat returns the heartbeat interval for one stream. The
// per-request header wins (tests use a tiny interval to verify
// ticking), then the operator's configured cadence, then the default.
//
// A non-positive `configured` falls through to DefaultStreamHeartbeat
// rather than reaching the engine: engine.ExecuteStream only starts the
// heartbeat goroutine when the interval is positive, so passing zero
// through would silently disable heartbeats entirely and let idle
// proxies tear healthy streams down.
func streamHeartbeat(r *http.Request, configured time.Duration) time.Duration {
	if v := r.Header.Get("X-LangWatch-NLPGO-Heartbeat-MS"); v != "" {
		var ms int
		if _, err := fmt.Sscanf(v, "%d", &ms); err == nil && ms > 0 {
			return time.Duration(ms) * time.Millisecond
		}
	}
	if configured > 0 {
		return configured
	}
	return DefaultStreamHeartbeat
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
			writeHandlerError(r.Context(), w, herr.New(r.Context(), domain.ErrInternal, herr.M{
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

// DefaultStreamIdleTimeout closes an SSE stream that has emitted nothing
// for this long when the operator names no budget. Matches
// httpblock.DefaultTimeout: the stream must outlive the slowest single
// agent HTTP call, or a customer running a long agent backend loses the
// inbound stream mid-call.
//
// Counterpart: NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_DEFAULT_SECONDS in
// platform/app/src/server/nlpgo/timeouts.ts, which bounds every code-block
// ceiling the platform will accept. Change both together.
const DefaultStreamIdleTimeout = 720 * time.Second

// streamIdleTimeout returns the silence budget for one stream. A
// non-positive `configured` falls through to DefaultStreamIdleTimeout
// rather than traveling on: zero would arm a timer that fires before the
// first engine event and cut every healthy stream off immediately.
func streamIdleTimeout(configured time.Duration) time.Duration {
	if configured > 0 {
		return configured
	}
	return DefaultStreamIdleTimeout
}
