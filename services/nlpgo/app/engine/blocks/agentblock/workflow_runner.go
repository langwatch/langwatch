// Package agentblock executes the Studio "agent" node kind.
//
// Agent nodes carry an `agent_type` parameter that selects one of three
// concrete executors:
//
//   - `agent_type=http`     → delegates to the HTTP-block executor.
//   - `agent_type=code`     → delegates to the code-block executor.
//   - `agent_type=workflow` → POST {api_host}/api/workflows/{workflow_id}/run
//                             (this file). Mirrors langwatch_nlp's
//                             dspy/custom_node.py CustomNode.
//
// HTTP and code modes are thin re-uses of existing block executors and
// will be wired by the engine's block dispatcher; this file owns only the
// novel "run another workflow as a sub-workflow" path because it adds a
// new HTTP surface to the LangWatch app.
package agentblock

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// WorkflowRunner runs an agent node configured with `agent_type=workflow`
// by POSTing to the LangWatch app's `/api/workflows/<id>/run` (or
// `/api/workflows/<id>/<version_id>/run` when a version is pinned)
// endpoint.
type WorkflowRunner struct {
	client      *http.Client
	defaultTime time.Duration
}

// WorkflowRunnerOptions configures a WorkflowRunner.
type WorkflowRunnerOptions struct {
	Client         *http.Client  // nil → default client
	DefaultTimeout time.Duration // 0 → 12 min (Lambda max is 15 min; we leave a 3-min margin)
}

// NewWorkflowRunner builds a runner.
//
// Default timeout is 12 minutes — customer agents can run long
// (multi-step LLM chains, slow tools) and the Python side's
// NLP_DSPY_CUSTOM_NODE_TIMEOUT_SECONDS=600 was too tight in practice.
// Lambda's hard ceiling is 15 minutes; 12 leaves a 3-minute margin
// for clean shutdown + response writing.
func NewWorkflowRunner(opts WorkflowRunnerOptions) *WorkflowRunner {
	if opts.Client == nil {
		opts.Client = &http.Client{}
	}
	if opts.DefaultTimeout == 0 {
		opts.DefaultTimeout = 12 * time.Minute
	}
	return &WorkflowRunner{
		client:      opts.Client,
		defaultTime: opts.DefaultTimeout,
	}
}

// WorkflowRunRequest is the per-invocation payload.
type WorkflowRunRequest struct {
	// BaseURL is the LangWatch app base URL (no trailing slash). Required.
	BaseURL string
	// APIKey is the project apiKey (X-Auth-Token header). Required.
	APIKey string
	// WorkflowID is the target workflow id. Required.
	WorkflowID string
	// VersionID pins a specific version. Optional — when "", the
	// currently-published version is used (server-side default).
	VersionID string
	// Inputs are the kwargs passed into the workflow. Required.
	// `do_not_trace=true` is added automatically (matches CustomNode.forward).
	Inputs map[string]any
	// TraceID propagates the parent Studio trace for span linking.
	TraceID string
	// Origin is the X-LangWatch-Origin attribution.
	Origin string
	// TimeoutMS overrides the runner's default. 0 → default.
	TimeoutMS int
}

// WorkflowRunResult is the parsed response.
//
// The /run endpoint returns `{"result": <whatever the workflow output is>}`
// on success, or a non-2xx with an error envelope on failure. We surface
// the unwrapped Result so callers don't have to know about the wrapper.
type WorkflowRunResult struct {
	Result   any           // workflow's output payload, type-unconstrained
	Duration time.Duration // wall-clock measured client-side
	Raw      json.RawMessage
}

// HTTPError signals a non-2xx response from the LangWatch app.
type HTTPError struct {
	StatusCode int
	URL        string
	Body       string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("agentblock: %s returned %d: %s", e.URL, e.StatusCode, e.Body)
}

// MissingResultError signals that the upstream returned 200 but the body
// did not contain a `result` field. Mirrors CustomNode.forward's:
//   if "result" not in result: raise Exception(json.dumps(result))
// — preserving the Python behavior where any unexpected upstream shape
// surfaces as an error rather than a silently-empty success.
type MissingResultError struct {
	URL  string
	Body string
}

func (e *MissingResultError) Error() string {
	return fmt.Sprintf("agentblock: %s returned 200 with no 'result' key: %s", e.URL, e.Body)
}

// Execute posts the run request and returns the unwrapped result.
func (r *WorkflowRunner) Execute(ctx context.Context, req WorkflowRunRequest) (*WorkflowRunResult, error) {
	if req.BaseURL == "" {
		return nil, errors.New("agentblock: BaseURL required")
	}
	if req.APIKey == "" {
		return nil, errors.New("agentblock: APIKey required")
	}
	if req.WorkflowID == "" {
		return nil, errors.New("agentblock: WorkflowID required")
	}
	if req.Inputs == nil {
		// An agent invocation with zero inputs is allowed; we just
		// don't want a nil map to confuse the encoder later.
		req.Inputs = map[string]any{}
	}

	endpoint := buildRunEndpoint(req.BaseURL, req.WorkflowID, req.VersionID)

	// Mirror CustomNode.forward: do_not_trace=true on every sub-workflow
	// invocation so traces don't double-count when the parent workflow
	// already owns the span.
	body := make(map[string]any, len(req.Inputs)+1)
	for k, v := range req.Inputs {
		body[k] = v
	}
	body["do_not_trace"] = true

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("agentblock: marshal body: %w", err)
	}

	timeout := r.defaultTime
	if req.TimeoutMS > 0 {
		timeout = time.Duration(req.TimeoutMS) * time.Millisecond
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("agentblock: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Auth-Token", req.APIKey)
	if req.TraceID != "" {
		httpReq.Header.Set("X-LangWatch-Trace-Id", req.TraceID)
	}
	if req.Origin != "" {
		httpReq.Header.Set("X-LangWatch-Origin", req.Origin)
	}

	start := time.Now()
	resp, err := r.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("agentblock: send: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 16*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("agentblock: read body: %w", err)
	}
	duration := time.Since(start)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		preview := string(respBody)
		if len(preview) > 4096 {
			preview = preview[:4096] + "…"
		}
		return nil, &HTTPError{StatusCode: resp.StatusCode, URL: endpoint, Body: preview}
	}

	var parsed map[string]any
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("agentblock: parse response: %w (body=%q)", err, truncate(respBody, 1024))
	}
	result, ok := parsed["result"]
	if !ok {
		return nil, &MissingResultError{URL: endpoint, Body: truncate(respBody, 1024)}
	}

	return &WorkflowRunResult{
		Result:   result,
		Duration: duration,
		Raw:      respBody,
	}, nil
}

func buildRunEndpoint(base, workflowID, versionID string) string {
	base = strings.TrimRight(base, "/")
	if versionID != "" {
		return base + "/api/workflows/" + workflowID + "/" + versionID + "/run"
	}
	return base + "/api/workflows/" + workflowID + "/run"
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "…"
}
