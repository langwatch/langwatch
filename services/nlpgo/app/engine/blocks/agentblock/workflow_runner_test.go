package agentblock_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/agentblock"
)

type captured struct {
	method      string
	path        string
	authToken   string
	traceID     string
	origin      string
	requestBody map[string]any
}

func newServer(t *testing.T, status int, response any, c *captured) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c != nil {
			c.method = r.Method
			c.path = r.URL.Path
			c.authToken = r.Header.Get("X-Auth-Token")
			c.traceID = r.Header.Get("X-LangWatch-Trace-Id")
			c.origin = r.Header.Get("X-LangWatch-Origin")
			body, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(body, &c.requestBody)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		switch v := response.(type) {
		case []byte:
			_, _ = w.Write(v)
		default:
			_ = json.NewEncoder(w).Encode(response)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func TestWorkflowRunner_HappyPath_PostsToRunEndpointAndUnwrapsResult(t *testing.T) {
	c := &captured{}
	srv := newServer(t, 200, map[string]any{
		"result": map[string]any{"answer": "4"},
	}, c)

	runner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{})
	res, err := runner.Execute(context.Background(), agentblock.WorkflowRunRequest{
		BaseURL:    srv.URL,
		APIKey:     "tok-xyz",
		WorkflowID: "workflow_abc",
		Inputs:     map[string]any{"question": "what is 2+2?"},
		TraceID:    "trc_123",
		Origin:     "workflow",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	if c.method != http.MethodPost {
		t.Errorf("method = %q, want POST", c.method)
	}
	if want := "/api/workflows/workflow_abc/run"; c.path != want {
		t.Errorf("path = %q, want %q", c.path, want)
	}
	if c.authToken != "tok-xyz" {
		t.Errorf("X-Auth-Token = %q", c.authToken)
	}
	if c.traceID != "trc_123" {
		t.Errorf("X-LangWatch-Trace-Id = %q", c.traceID)
	}
	if c.origin != "workflow" {
		t.Errorf("X-LangWatch-Origin = %q", c.origin)
	}
	if c.requestBody["question"] != "what is 2+2?" {
		t.Errorf("body.question = %v", c.requestBody["question"])
	}
	if c.requestBody["do_not_trace"] != true {
		t.Errorf("body.do_not_trace = %v, want true (mirrors CustomNode.forward)", c.requestBody["do_not_trace"])
	}

	got, ok := res.Result.(map[string]any)
	if !ok || got["answer"] != "4" {
		t.Errorf("Result = %v, want {answer:4} unwrapped", res.Result)
	}
	if res.Duration <= 0 {
		t.Errorf("Duration not measured: %v", res.Duration)
	}
}

func TestWorkflowRunner_VersionPinnedAddsSegment(t *testing.T) {
	c := &captured{}
	srv := newServer(t, 200, map[string]any{"result": "ok"}, c)

	runner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{})
	_, err := runner.Execute(context.Background(), agentblock.WorkflowRunRequest{
		BaseURL:    srv.URL,
		APIKey:     "k",
		WorkflowID: "w_id",
		VersionID:  "v_42",
		Inputs:     map[string]any{"q": "x"},
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if want := "/api/workflows/w_id/v_42/run"; c.path != want {
		t.Errorf("path = %q, want %q", c.path, want)
	}
}

func TestWorkflowRunner_NonTwoXxReturnsHTTPError(t *testing.T) {
	srv := newServer(t, 502, []byte("upstream gone"), nil)

	runner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{})
	_, err := runner.Execute(context.Background(), agentblock.WorkflowRunRequest{
		BaseURL:    srv.URL,
		APIKey:     "k",
		WorkflowID: "w_id",
		Inputs:     map[string]any{"q": "x"},
	})
	var httpErr *agentblock.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Execute: error = %v, want *HTTPError", err)
	}
	if httpErr.StatusCode != 502 {
		t.Errorf("StatusCode = %d, want 502", httpErr.StatusCode)
	}
	if !strings.Contains(httpErr.Body, "upstream gone") {
		t.Errorf("Body = %q", httpErr.Body)
	}
}

func TestWorkflowRunner_TwoXxWithoutResultKeyReturnsMissingResultError(t *testing.T) {
	srv := newServer(t, 200, map[string]any{
		// note: no "result" key — mirrors the legacy Python check
		"status": "weird-shape",
		"data":   "stuff",
	}, nil)

	runner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{})
	_, err := runner.Execute(context.Background(), agentblock.WorkflowRunRequest{
		BaseURL:    srv.URL,
		APIKey:     "k",
		WorkflowID: "w_id",
		Inputs:     map[string]any{"q": "x"},
	})
	var missing *agentblock.MissingResultError
	if !errors.As(err, &missing) {
		t.Fatalf("Execute: error = %v, want *MissingResultError", err)
	}
	if !strings.Contains(missing.Body, "weird-shape") {
		t.Errorf("Body should preserve upstream payload: %q", missing.Body)
	}
}

func TestWorkflowRunner_DoNotTraceAlwaysAddedNeverOverridden(t *testing.T) {
	c := &captured{}
	srv := newServer(t, 200, map[string]any{"result": nil}, c)

	runner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{})
	_, err := runner.Execute(context.Background(), agentblock.WorkflowRunRequest{
		BaseURL:    srv.URL,
		APIKey:     "k",
		WorkflowID: "w_id",
		// Caller "explicitly" sets do_not_trace=false in the inputs to
		// try to force tracing on the sub-workflow. The runner should
		// override this — sub-workflows always traceless to avoid
		// double-counting in the parent's span tree.
		Inputs: map[string]any{"q": "x", "do_not_trace": false},
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if c.requestBody["do_not_trace"] != true {
		t.Errorf("do_not_trace must always be true on the wire, got %v", c.requestBody["do_not_trace"])
	}
}

func TestWorkflowRunner_NilInputsBecomeEmptyObject(t *testing.T) {
	c := &captured{}
	srv := newServer(t, 200, map[string]any{"result": nil}, c)

	runner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{})
	_, err := runner.Execute(context.Background(), agentblock.WorkflowRunRequest{
		BaseURL:    srv.URL,
		APIKey:     "k",
		WorkflowID: "w_id",
		Inputs:     nil,
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if c.requestBody["do_not_trace"] != true {
		t.Errorf("do_not_trace = %v, want true (added even with nil inputs)", c.requestBody["do_not_trace"])
	}
}

func TestWorkflowRunner_ValidationErrors(t *testing.T) {
	runner := agentblock.NewWorkflowRunner(agentblock.WorkflowRunnerOptions{})
	cases := []struct {
		name string
		req  agentblock.WorkflowRunRequest
		want string
	}{
		{
			name: "missing BaseURL",
			req:  agentblock.WorkflowRunRequest{APIKey: "k", WorkflowID: "w", Inputs: map[string]any{"a": 1}},
			want: "BaseURL required",
		},
		{
			name: "missing APIKey",
			req:  agentblock.WorkflowRunRequest{BaseURL: "https://x", WorkflowID: "w", Inputs: map[string]any{"a": 1}},
			want: "APIKey required",
		},
		{
			name: "missing WorkflowID",
			req:  agentblock.WorkflowRunRequest{BaseURL: "https://x", APIKey: "k", Inputs: map[string]any{"a": 1}},
			want: "WorkflowID required",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := runner.Execute(context.Background(), tc.req)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Execute: error = %v, want substring %q", err, tc.want)
			}
		})
	}
}
