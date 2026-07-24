package evaluatorblock_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/evaluatorblock"
)

// captureCall is a one-shot httptest fixture that records the inbound
// request and replies with whatever the test wants.
type captureCall struct {
	method      string
	path        string
	authToken   string
	traceID     string
	origin      string
	requestBody map[string]any
}

func newServer(t *testing.T, status int, response any, capture *captureCall) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if capture != nil {
			capture.method = r.Method
			capture.path = r.URL.Path
			capture.authToken = r.Header.Get("X-Auth-Token")
			capture.traceID = r.Header.Get("X-LangWatch-Trace-Id")
			capture.origin = r.Header.Get("X-LangWatch-Origin")
			body, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(body, &capture.requestBody)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		bytes, err := json.Marshal(response)
		if err != nil {
			t.Fatalf("encode response: %v", err)
		}
		_, _ = w.Write(bytes)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func ptrFloat(v float64) *float64 { return &v }
func ptrBool(v bool) *bool        { return &v }

func TestExecute_HappyPath_ProcessedResultPropagatesAllFields(t *testing.T) {
	capture := &captureCall{}
	srv := newServer(t, 200, map[string]any{
		"status":  "processed",
		"score":   0.85,
		"passed":  true,
		"details": "looks good",
		"label":   "high",
		"cost":    map[string]any{"currency": "USD", "amount": 0.0021},
	}, capture)

	exec := evaluatorblock.New(evaluatorblock.Options{})
	res, err := exec.Execute(context.Background(), evaluatorblock.Request{
		BaseURL:       srv.URL,
		APIKey:        "test-token-123",
		EvaluatorSlug: "langevals/exact_match",
		Name:          "Strict match",
		Settings:      map[string]any{"mode": "exact"},
		Data:          map[string]any{"input": "hello", "output": "hello"},
		TraceID:       "trc_abc",
		Origin:        "evaluation",
	})
	if err != nil {
		t.Fatalf("Execute: unexpected error: %v", err)
	}

	// Wire-shape assertions
	if capture.method != http.MethodPost {
		t.Errorf("method = %q, want POST", capture.method)
	}
	wantPath := "/api/evaluations/langevals/exact_match/evaluate"
	if capture.path != wantPath {
		t.Errorf("path = %q, want %q", capture.path, wantPath)
	}
	if capture.authToken != "test-token-123" {
		t.Errorf("X-Auth-Token = %q, want test-token-123", capture.authToken)
	}
	if capture.traceID != "trc_abc" {
		t.Errorf("X-LangWatch-Trace-Id = %q, want trc_abc", capture.traceID)
	}
	if capture.origin != "evaluation" {
		t.Errorf("X-LangWatch-Origin = %q, want evaluation", capture.origin)
	}
	if capture.requestBody["name"] != "Strict match" {
		t.Errorf("body.name = %v, want \"Strict match\"", capture.requestBody["name"])
	}
	if data, ok := capture.requestBody["data"].(map[string]any); !ok || data["input"] != "hello" {
		t.Errorf("body.data.input mismatch: %v", capture.requestBody["data"])
	}
	if settings, ok := capture.requestBody["settings"].(map[string]any); !ok || settings["mode"] != "exact" {
		t.Errorf("body.settings.mode mismatch: %v", capture.requestBody["settings"])
	}

	// Result-shape assertions
	if res.Status != "processed" {
		t.Errorf("Status = %q, want processed", res.Status)
	}
	if res.Score == nil || *res.Score != 0.85 {
		t.Errorf("Score = %v, want 0.85", res.Score)
	}
	if res.Passed == nil || *res.Passed != true {
		t.Errorf("Passed = %v, want true", res.Passed)
	}
	if res.Details != "looks good" {
		t.Errorf("Details = %q, want \"looks good\"", res.Details)
	}
	if res.Label != "high" {
		t.Errorf("Label = %q, want \"high\"", res.Label)
	}
	if res.Cost == nil || res.Cost.Currency != "USD" || res.Cost.Amount != 0.0021 {
		t.Errorf("Cost = %v, want USD/0.0021", res.Cost)
	}
	if res.Inputs["input"] != "hello" {
		t.Errorf("Inputs not echoed correctly: %v", res.Inputs)
	}
	if res.Duration <= 0 {
		t.Errorf("Duration not measured: %v", res.Duration)
	}
}

func TestExecute_SkippedResult_DetailsPreserved(t *testing.T) {
	srv := newServer(t, 200, map[string]any{
		"status":  "skipped",
		"details": "missing required field 'expected_output'",
	}, nil)

	exec := evaluatorblock.New(evaluatorblock.Options{})
	res, err := exec.Execute(context.Background(), evaluatorblock.Request{
		BaseURL:       srv.URL,
		APIKey:        "k",
		EvaluatorSlug: "langevals/exact_match",
		Data:          map[string]any{"input": "x"},
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if res.Status != "skipped" {
		t.Errorf("Status = %q, want skipped", res.Status)
	}
	if !strings.Contains(res.Details, "expected_output") {
		t.Errorf("Details = %q, want details to mention missing field", res.Details)
	}
	if res.Score != nil {
		t.Errorf("Score = %v, want nil for skipped", res.Score)
	}
}

func TestExecute_ErrorResultStatusErrorAndDetails(t *testing.T) {
	srv := newServer(t, 200, map[string]any{
		"status":  "error",
		"details": "upstream API key invalid",
	}, nil)

	exec := evaluatorblock.New(evaluatorblock.Options{})
	res, err := exec.Execute(context.Background(), evaluatorblock.Request{
		BaseURL:       srv.URL,
		APIKey:        "k",
		EvaluatorSlug: "ragas/answer_correctness",
		Data:          map[string]any{"input": "x", "output": "y"},
	})
	if err != nil {
		t.Fatalf("Execute: unexpected error: %v", err)
	}
	if res.Status != "error" {
		t.Errorf("Status = %q, want error", res.Status)
	}
	if res.Details != "upstream API key invalid" {
		t.Errorf("Details = %q", res.Details)
	}
}

func TestExecute_NonJSONErrorBodyPropagatesAsHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte("internal server error"))
	}))
	defer srv.Close()

	exec := evaluatorblock.New(evaluatorblock.Options{})
	_, err := exec.Execute(context.Background(), evaluatorblock.Request{
		BaseURL:       srv.URL,
		APIKey:        "k",
		EvaluatorSlug: "langevals/exact_match",
		Data:          map[string]any{"input": "x"},
	})
	if err == nil {
		t.Fatalf("Execute: expected error for 500 status")
	}
	var httpErr *evaluatorblock.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("Execute: error = %v, want *HTTPError", err)
	}
	if httpErr.StatusCode != http.StatusInternalServerError {
		t.Errorf("StatusCode = %d, want 500", httpErr.StatusCode)
	}
	if !strings.Contains(httpErr.Body, "internal server error") {
		t.Errorf("Body = %q, want body preview", httpErr.Body)
	}
}

// Saved + workflow evaluators own their input typing (bool, float, int,
// dict, json_schema) and the app resolves them against the evaluator's
// declared inputs. The langevals/* coercion path stringifies non-strings
// so the receiving Pydantic schema accepts them — applying the same
// stringification to a workflow evaluator would silently destroy the
// caller's declared types. This test pins the boundary.
func TestExecute_CustomAndSavedSlugsPassDataThroughUnchanged(t *testing.T) {
	cases := []struct {
		name string
		slug string
	}{
		{"saved evaluator slug", "evaluators/saved-eval-id"},
		{"custom workflow evaluator slug", "custom/workflow-id-abc"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			capture := &captureCall{}
			srv := newServer(t, 200, map[string]any{"status": "processed"}, capture)

			exec := evaluatorblock.New(evaluatorblock.Options{})
			_, err := exec.Execute(context.Background(), evaluatorblock.Request{
				BaseURL:       srv.URL,
				APIKey:        "k",
				EvaluatorSlug: tc.slug,
				Data: map[string]any{
					"flag":      true,
					"threshold": 0.5,
					"limit":     42,
					"shape":     map[string]any{"a": 1},
				},
			})
			if err != nil {
				t.Fatalf("Execute: %v", err)
			}
			data, ok := capture.requestBody["data"].(map[string]any)
			if !ok {
				t.Fatalf("body.data missing or wrong shape: %v", capture.requestBody["data"])
			}
			// JSON round-trip turns the bool into true (not "true"), int
			// into float64 42 (not "42"), and the map stays a map.
			if got, ok := data["flag"].(bool); !ok || got != true {
				t.Errorf("flag = %v (%T), want true (bool, unchanged)", data["flag"], data["flag"])
			}
			if got, ok := data["threshold"].(float64); !ok || got != 0.5 {
				t.Errorf("threshold = %v (%T), want 0.5 (float64, unchanged)", data["threshold"], data["threshold"])
			}
			if got, ok := data["limit"].(float64); !ok || got != 42 {
				t.Errorf("limit = %v (%T), want 42 (float64, unchanged)", data["limit"], data["limit"])
			}
			if shape, ok := data["shape"].(map[string]any); !ok || shape["a"] != float64(1) {
				t.Errorf("shape = %v, want map preserved unchanged", data["shape"])
			}
		})
	}
}

// Langevals/* slugs MUST still be coerced — the receiving Pydantic schema
// types every field as `str`. This pairs with the pass-through test above
// to pin the boundary from both sides.
func TestExecute_LangevalsSlugStillCoercesData(t *testing.T) {
	capture := &captureCall{}
	srv := newServer(t, 200, map[string]any{"status": "processed"}, capture)

	exec := evaluatorblock.New(evaluatorblock.Options{})
	_, err := exec.Execute(context.Background(), evaluatorblock.Request{
		BaseURL:       srv.URL,
		APIKey:        "k",
		EvaluatorSlug: "langevals/exact_match",
		Data: map[string]any{
			"output":          true,
			"expected_output": "1",
		},
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	data, ok := capture.requestBody["data"].(map[string]any)
	if !ok {
		t.Fatalf("body.data missing or wrong shape: %v", capture.requestBody["data"])
	}
	if got, ok := data["output"].(string); !ok || got != "true" {
		t.Errorf("output = %v (%T), want \"true\" (string, coerced)", data["output"], data["output"])
	}
	if got, ok := data["expected_output"].(string); !ok || got != "1" {
		t.Errorf("expected_output = %v (%T), want \"1\" (string passthrough)", data["expected_output"], data["expected_output"])
	}
}

func TestExecute_NestedSlugUrlEncodedCorrectly(t *testing.T) {
	capture := &captureCall{}
	srv := newServer(t, 200, map[string]any{"status": "processed"}, capture)

	exec := evaluatorblock.New(evaluatorblock.Options{})
	_, err := exec.Execute(context.Background(), evaluatorblock.Request{
		BaseURL:       srv.URL,
		APIKey:        "k",
		EvaluatorSlug: "evaluators/saved-eval-id-with-dashes",
		Data:          map[string]any{"input": "x"},
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	want := "/api/evaluations/evaluators/saved-eval-id-with-dashes/evaluate"
	if capture.path != want {
		t.Errorf("path = %q, want %q", capture.path, want)
	}
}

func TestExecute_ValidationErrors(t *testing.T) {
	exec := evaluatorblock.New(evaluatorblock.Options{})
	cases := []struct {
		name string
		req  evaluatorblock.Request
		want string
	}{
		{
			name: "missing BaseURL",
			req:  evaluatorblock.Request{APIKey: "k", EvaluatorSlug: "x", Data: map[string]any{"a": 1}},
			want: "BaseURL required",
		},
		{
			name: "missing APIKey",
			req:  evaluatorblock.Request{BaseURL: "https://x", EvaluatorSlug: "x", Data: map[string]any{"a": 1}},
			want: "APIKey required",
		},
		{
			name: "missing EvaluatorSlug",
			req:  evaluatorblock.Request{BaseURL: "https://x", APIKey: "k", Data: map[string]any{"a": 1}},
			want: "EvaluatorSlug required",
		},
		{
			name: "missing Data",
			req:  evaluatorblock.Request{BaseURL: "https://x", APIKey: "k", EvaluatorSlug: "x"},
			want: "Data required",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := exec.Execute(context.Background(), tc.req)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("Execute: error = %v, want substring %q", err, tc.want)
			}
		})
	}
}

func TestExecute_BareSuccessShapeInferredAsProcessed(t *testing.T) {
	// Some legacy paths return {score, passed} without a status field.
	srv := newServer(t, 200, map[string]any{"score": 1.0, "passed": true}, nil)

	exec := evaluatorblock.New(evaluatorblock.Options{})
	res, err := exec.Execute(context.Background(), evaluatorblock.Request{
		BaseURL:       srv.URL,
		APIKey:        "k",
		EvaluatorSlug: "langevals/exact_match",
		Data:          map[string]any{"input": "x"},
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if res.Status != "processed" {
		t.Errorf("Status = %q, want processed (inferred)", res.Status)
	}
	if res.Score == nil || *res.Score != 1.0 {
		t.Errorf("Score = %v, want 1.0", res.Score)
	}
}

// Static check that pointer helpers are unused warnings stay quiet —
// we only export them indirectly through the test fixture above.
var _ = ptrFloat
var _ = ptrBool
