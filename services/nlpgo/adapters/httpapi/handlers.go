package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"

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

		// Decode into a permissive envelope first so we can extract
		// trace_id / inputs / origin without parsing the whole workflow
		// twice. The workflow itself stays as raw JSON until the engine
		// (which holds the dsl package) decodes it.
		var env struct {
			TraceID  string         `json:"trace_id"`
			Workflow json.RawMessage `json:"workflow"`
			Inputs   any            `json:"inputs,omitempty"`
			Origin   string         `json:"origin,omitempty"`
			ProjectID string        `json:"project_id,omitempty"`
		}
		if err := json.Unmarshal(body, &env); err != nil {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"reason": "parse_envelope",
			}, err))
			return
		}
		if len(env.Workflow) == 0 {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"reason": "missing_workflow",
			}, errors.New("'workflow' field required")))
			return
		}

		// Origin: prefer explicit body field, fall back to header. The
		// header path is what the TS app uses by default; the body
		// field is for tests + manual invocation.
		origin := env.Origin
		if origin == "" {
			origin = r.Header.Get("X-LangWatch-Origin")
		}

		// Inputs: Python accepts either a single dict (component
		// execution) or a list of dicts (flow execution). For sync the
		// most common shape is a single dict; if a list arrives we use
		// the first element. Multi-record streaming is the SSE path.
		inputs := normalizeInputs(env.Inputs)

		// Attach origin to ctx so the LLM executor (and gateway HTTP
		// calls underneath) propagate X-LangWatch-Origin downstream.
		// Without this every Studio LLM call lands on the gateway
		// untagged and origin-based attribution breaks.
		ctx := r.Context()
		if origin != "" {
			ctx = withOrigin(ctx, origin)
		}
		result, err := executor.Execute(ctx, app.WorkflowRequest{
			WorkflowJSON: env.Workflow,
			Inputs:       inputs,
			Origin:       origin,
			TraceID:      env.TraceID,
			ProjectID:    env.ProjectID,
		})
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

// executeStreamHandler is the entry point for /go/studio/execute (SSE).
// Scaffold returns 501.
func executeStreamHandler(_ *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, herr.M{
			"reason": "engine_not_implemented",
			"path":   r.URL.Path,
		}))
	}
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
