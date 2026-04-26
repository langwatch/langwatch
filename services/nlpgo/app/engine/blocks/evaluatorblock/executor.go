// Package evaluatorblock executes a Studio "evaluator" node by calling
// the LangWatch evaluator HTTP API back at the calling app
// (POST /api/evaluations/<slug>/evaluate).
//
// Why HTTP and not in-process: the LangWatch app runs in a separate
// pod/process and owns the evaluator dispatch logic (saved evaluators,
// monitors, workflow evaluators, langevals routing). Mirroring the
// Python SDK's `langwatch.evaluations.evaluate(...)` keeps wire-shape
// parity with today's behavior; only the caller (Go vs Python) changes.
//
// Auth: the project's API key, passed as `X-Auth-Token`. The workflow
// envelope already carries this through from the TS app — see the
// `api_key` field on `dsl.Workflow`. The base URL comes from the
// envelope's `api_host` (or whatever the parent service plumbs in via
// the executor's BaseURL).
package evaluatorblock

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Executor runs a single evaluator block invocation.
type Executor struct {
	client      *http.Client
	defaultTime time.Duration
}

// Options configures an Executor.
type Options struct {
	Client         *http.Client  // nil → http.DefaultClient
	DefaultTimeout time.Duration // 0 → 12min (Lambda max 15min; we leave 3min margin)
}

// New builds an Executor with the given options.
//
// Default timeout is 12 minutes — customer evaluators can chain LLM
// calls (ragas's answer_correctness etc.) and time out under load.
// Lambda's hard ceiling is 15 minutes; 12 leaves a 3-minute margin
// for clean shutdown + response writing.
func New(opts Options) *Executor {
	if opts.Client == nil {
		opts.Client = &http.Client{}
	}
	if opts.DefaultTimeout == 0 {
		opts.DefaultTimeout = 12 * time.Minute
	}
	return &Executor{
		client:      opts.Client,
		defaultTime: opts.DefaultTimeout,
	}
}

// Request is what the engine hands to the executor per node invocation.
type Request struct {
	// BaseURL is the LangWatch app URL (no trailing slash). Required.
	BaseURL string
	// APIKey is the project apiKey (sent as X-Auth-Token). Required.
	APIKey string
	// EvaluatorSlug is the evaluator identifier (e.g. "langevals/exact_match"
	// or "ragas/answer_correctness"). Path-joined into the request URL.
	// Required.
	EvaluatorSlug string
	// Name is the human-readable evaluator name (optional, propagated to
	// the response trace).
	Name string
	// Settings is the evaluator-specific config dict (e.g. ragas's
	// model id, threshold). Optional.
	Settings map[string]any
	// Data is the resolved input payload — typically
	// {input, output, expected_output, contexts, expected_contexts}
	// depending on the evaluator's required signature. Required.
	Data map[string]any
	// TraceID is the parent Studio trace id for span linking (optional).
	TraceID string
	// Origin is the X-LangWatch-Origin attribution (workflow/evaluation/...).
	Origin string
	// ThreadID groups Studio runs into a single conversation in trace
	// metadata. Mirrors langwatch_nlp commit ac986cc3c. Optional.
	ThreadID string
	// TimeoutMS overrides the executor default timeout. 0 → default.
	TimeoutMS int
}

// Result is the executor's parsed output. Mirrors the Python
// EvaluationResultWithMetadata shape so engine output is consumer-stable.
type Result struct {
	Status   string         // "processed" | "skipped" | "error"
	Score    *float64       // nil when not produced
	Passed   *bool          // nil when not produced
	Details  string         // free-text explanation; non-empty on skipped/error
	Label    string         // optional category label
	Cost     *Money         // nil when not produced
	Inputs   map[string]any // echo of Data, useful for trace surfacing
	Duration time.Duration  // wall-clock; sender-side measurement
	Raw      json.RawMessage // full upstream body for diagnostics
}

// Money mirrors langwatch_nlp's Money tuple.
type Money struct {
	Currency string  `json:"currency"`
	Amount   float64 `json:"amount"`
}

// HTTPError signals a non-2xx from the LangWatch app. The Body is the
// raw response (truncated to 4KiB) so callers can surface it.
type HTTPError struct {
	StatusCode int
	URL        string
	Body       string
}

func (e *HTTPError) Error() string {
	return fmt.Sprintf("evaluatorblock: %s returned %d: %s", e.URL, e.StatusCode, e.Body)
}

// Execute runs the evaluator request and parses the response.
//
// Validation order:
//  1. Required fields (BaseURL, APIKey, EvaluatorSlug, Data).
//  2. Build the request URL — `${BaseURL}/api/evaluations/<slug>/evaluate`.
//     Slugs with a "/" (e.g. "langevals/exact_match") path-join naturally.
//  3. POST + parse the JSON body into Result.
//  4. Surface upstream non-2xx as HTTPError; preserve TraceID + Origin
//     headers throughout for trace correlation.
func (e *Executor) Execute(ctx context.Context, req Request) (*Result, error) {
	if req.BaseURL == "" {
		return nil, errors.New("evaluatorblock: BaseURL required")
	}
	if req.APIKey == "" {
		return nil, errors.New("evaluatorblock: APIKey required")
	}
	if req.EvaluatorSlug == "" {
		return nil, errors.New("evaluatorblock: EvaluatorSlug required")
	}
	if len(req.Data) == 0 {
		return nil, errors.New("evaluatorblock: Data required")
	}

	endpoint, err := buildEndpoint(req.BaseURL, req.EvaluatorSlug)
	if err != nil {
		return nil, err
	}

	body := map[string]any{
		"data": req.Data,
	}
	if req.Name != "" {
		body["name"] = req.Name
	}
	if len(req.Settings) > 0 {
		body["settings"] = req.Settings
	}

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("evaluatorblock: marshal body: %w", err)
	}

	timeout := e.defaultTime
	if req.TimeoutMS > 0 {
		timeout = time.Duration(req.TimeoutMS) * time.Millisecond
	}
	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	httpReq, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("evaluatorblock: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("X-Auth-Token", req.APIKey)
	if req.TraceID != "" {
		httpReq.Header.Set("X-LangWatch-Trace-Id", req.TraceID)
	}
	if req.Origin != "" {
		httpReq.Header.Set("X-LangWatch-Origin", req.Origin)
	}
	if req.ThreadID != "" {
		httpReq.Header.Set("X-LangWatch-Thread-Id", req.ThreadID)
	}

	start := time.Now()
	resp, err := e.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("evaluatorblock: send: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return nil, fmt.Errorf("evaluatorblock: read body: %w", err)
	}
	duration := time.Since(start)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Truncate the body in the error so we don't blow up logs on
		// HTML 500 pages.
		preview := string(respBody)
		if len(preview) > 4096 {
			preview = preview[:4096] + "…"
		}
		return nil, &HTTPError{StatusCode: resp.StatusCode, URL: endpoint, Body: preview}
	}

	res, err := parseResult(respBody)
	if err != nil {
		return nil, err
	}
	res.Inputs = req.Data
	res.Duration = duration
	res.Raw = respBody
	return res, nil
}

// buildEndpoint joins the base URL with the evaluator slug. Slugs are
// expected to be path-safe (the evaluators registry uses underscores +
// slashes only) but we url-escape each segment defensively to keep
// custom-evaluator slugs (e.g. "evaluators/<id>") working.
func buildEndpoint(base, slug string) (string, error) {
	base = strings.TrimRight(base, "/")
	if base == "" {
		return "", errors.New("evaluatorblock: BaseURL is empty after trim")
	}
	parts := strings.Split(slug, "/")
	for i, p := range parts {
		if p == "" {
			return "", fmt.Errorf("evaluatorblock: slug %q has empty segment", slug)
		}
		parts[i] = url.PathEscape(p)
	}
	return base + "/api/evaluations/" + strings.Join(parts, "/") + "/evaluate", nil
}

// upstream is the shape the LangWatch evaluator endpoint returns.
// Mirror what handleEvaluatorCall in evaluations-legacy.ts produces.
// Fields are pointer types so we can detect "not present" vs "zero".
type upstream struct {
	Status  string         `json:"status"`
	Score   *float64       `json:"score,omitempty"`
	Passed  *bool          `json:"passed,omitempty"`
	Details string         `json:"details,omitempty"`
	Label   string         `json:"label,omitempty"`
	Cost    *Money         `json:"cost,omitempty"`
	Error   string         `json:"error,omitempty"` // some legacy paths use error instead of details
	Raw     map[string]any `json:"-"`
}

func parseResult(body []byte) (*Result, error) {
	var u upstream
	if err := json.Unmarshal(body, &u); err != nil {
		return nil, fmt.Errorf("evaluatorblock: parse response: %w (body=%q)", err, truncate(body, 1024))
	}
	if u.Status == "" {
		// Some upstream paths return 200 with a result-only payload
		// (no status field). Treat as processed when score / passed
		// are present, error otherwise.
		if u.Score != nil || u.Passed != nil {
			u.Status = "processed"
		} else if u.Error != "" || u.Details != "" {
			u.Status = "error"
		} else {
			u.Status = "skipped"
		}
	}
	details := u.Details
	if details == "" {
		details = u.Error
	}
	return &Result{
		Status:  u.Status,
		Score:   u.Score,
		Passed:  u.Passed,
		Details: details,
		Label:   u.Label,
		Cost:    u.Cost,
	}, nil
}

func truncate(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return string(b[:n]) + "…"
}
