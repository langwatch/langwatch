package rpc_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	evalrpc "github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/transport/rpc"
)

const secret = "internal-secret"

// recordingAPI records every request and answers one processed result per entry.
type recordingAPI struct {
	mu       sync.Mutex
	requests []contract.EvaluateRequest
}

func (a *recordingAPI) Evaluate(_ context.Context, req contract.EvaluateRequest) ([]contract.Result, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.requests = append(a.requests, req)
	results := make([]contract.Result, len(req.Entries))
	for i := range results {
		results[i] = contract.Result{Status: contract.StatusProcessed}
	}
	return results, nil
}

func (a *recordingAPI) calls() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.requests)
}

func serve(t *testing.T, api *recordingAPI, internalSecret string, maxBodyBytes int64, authorization, body string) *httptest.ResponseRecorder {
	t.Helper()
	handler := evalrpc.NewHandler(evalrpc.HandlerDeps{API: api, InternalSecret: internalSecret, MaxBodyBytes: maxBodyBytes})
	req := httptest.NewRequest(http.MethodPost, "/go/evaluators/langevals/exact_match/evaluate", strings.NewReader(body))
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	req.Header.Set(evalrpc.HeaderProjectID, "acme")
	req.Header.Set(evalrpc.HeaderTraceparent, "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")
	req.Header.Set(evalrpc.HeaderTraceToken, "trace-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body herr.ErrorResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	return body.Error.Code
}

const validBody = `{"data":[{"output":"a","expected_output":"a"}],"settings":{"case_sensitive":true},"env":{"X_LITELLM_model":"openai/gpt-4o-mini"}}`

// @scenario "A request without the internal credential is refused"
func TestARequestWithoutTheInternalCredentialIsRefused(t *testing.T) {
	cases := map[string]struct{ internalSecret, authorization string }{
		"no credential":             {secret, ""},
		"wrong credential":          {secret, "Bearer not-the-secret"},
		"bare scheme":               {secret, "Bearer "},
		"empty secret fails closed": {"", "Bearer "},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			api := &recordingAPI{}

			rec := serve(t, api, tc.internalSecret, 1<<20, tc.authorization, validBody)

			assert.Equal(t, http.StatusUnauthorized, rec.Code)
			assert.Equal(t, string(contract.ErrUnauthorized), errorCode(t, rec))
			assert.Zero(t, api.calls(), "no evaluator runs")
		})
	}
}

// @scenario "A payload over the evaluation cap is refused"
func TestAPayloadOverTheEvaluationCapIsRefused(t *testing.T) {
	api := &recordingAPI{}
	body := `{"data":[{"output":"` + strings.Repeat("x", 2048) + `","expected_output":"a"}]}`

	rec := serve(t, api, secret, 1024, "Bearer "+secret, body)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Equal(t, string(contract.ErrPayloadTooLarge), errorCode(t, rec))
	assert.Zero(t, api.calls())
}

func TestAnAuthorizedRequestReachesTheRuntimeWithLangevalsWire(t *testing.T) {
	api := &recordingAPI{}

	rec := serve(t, api, secret, 1<<20, "Bearer "+secret, validBody)

	require.Equal(t, http.StatusOK, rec.Code)
	var results []contract.Result
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &results))
	assert.Len(t, results, 1)
	require.Equal(t, 1, api.calls())
	req := api.requests[0]
	assert.Equal(t, "langevals/exact_match", req.Evaluator)
	assert.Equal(t, "acme", req.Tenant.ProjectID)
	assert.Equal(t, "openai/gpt-4o-mini", req.Tenant.Env["X_LITELLM_model"])
	assert.JSONEq(t, `{"case_sensitive":true}`, string(req.Settings))
	assert.Equal(t, "trace-token", req.Trace.Token)
	assert.NotEmpty(t, req.Trace.Traceparent)
	require.Len(t, req.Entries, 1)
	assert.Equal(t, "a", *req.Entries[0].Output)
}

// ClusterTopics is not scripted; the clustering routes have their own tests.
func (a *recordingAPI) ClusterTopics(context.Context, contract.TopicClusteringRequest) (contract.TopicClusteringResult, error) {
	return contract.TopicClusteringResult{}, errors.New("recordingAPI: ClusterTopics is not scripted")
}
