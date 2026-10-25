package rpc_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/memory"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
	evalrpc "github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/transport/rpc"
)

// clusteringAPI answers ClusterTopics from a script and refuses Evaluate.
type clusteringAPI struct {
	cluster func(context.Context, contract.TopicClusteringRequest) (contract.TopicClusteringResult, error)
}

func (clusteringAPI) Evaluate(context.Context, contract.EvaluateRequest) ([]contract.Result, error) {
	return nil, errors.New("clusteringAPI: Evaluate is not scripted")
}

func (a clusteringAPI) ClusterTopics(ctx context.Context, req contract.TopicClusteringRequest) (contract.TopicClusteringResult, error) {
	return a.cluster(ctx, req)
}

func postClustering(routes evalrpc.TopicClusteringRoutes, path, authorization, body string) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	evalrpc.MountTopicClustering(mux, routes)
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

const clusteringBody = `{"project_id":"project_1","traces":[{"trace_id":"a","input":"hello","topic_id":null,"subtopic_id":null}],
"topics":[],"subtopics":[],"litellm_params":{"model":"openai/gpt-5-mini","api_key":"sk-chat"},
"embeddings_litellm_params":{"model":"openai/text-embedding-3-small","api_key":"sk-embed","dimensions":1536},"deployment_name":"ignored"}`

func TestClusteringRequestCarriesTheLiteLLMParams(t *testing.T) {
	var got contract.TopicClusteringRequest
	api := clusteringAPI{cluster: func(_ context.Context, req contract.TopicClusteringRequest) (contract.TopicClusteringResult, error) {
		got = req
		return contract.TopicClusteringResult{Topics: []contract.ClusteringTopic{}, Subtopics: []contract.ClusteringSubtopic{}, Traces: []contract.TraceTopicAssignment{}}, nil
	}}
	routes := evalrpc.TopicClusteringRoutes{API: api, InternalSecret: secret}
	rec := postClustering(routes, "/go/evaluators/topics/incremental_clustering", "Bearer "+secret, clusteringBody)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, contract.ClusteringIncremental, got.Mode)
	assert.Equal(t, "project_1", got.Tenant.ProjectID)
	assert.Equal(t, "openai/gpt-5-mini", got.ChatModel)
	assert.Equal(t, "openai/text-embedding-3-small", got.EmbeddingsModel)
	assert.Equal(t, 1536, got.Dimensions)
	assert.Equal(t, map[string]string{
		"X_LITELLM_model": "openai/gpt-5-mini", "X_LITELLM_api_key": "sk-chat",
		"X_LITELLM_EMBEDDINGS_model": "openai/text-embedding-3-small", "X_LITELLM_EMBEDDINGS_api_key": "sk-embed",
	}, got.Tenant.Env)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, map[string]any{"topics": []any{}, "subtopics": []any{}, "traces": []any{}, "cost": map[string]any{"currency": "", "amount": 0.0}}, body)

	rec = postClustering(routes, "/go/evaluators/topics/batch_clustering", "", clusteringBody)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

// @scenario "A body over the clustering cap is refused with 413"
func TestClusteringBodyOverTheCapIs413(t *testing.T) {
	called := false
	api := clusteringAPI{cluster: func(context.Context, contract.TopicClusteringRequest) (contract.TopicClusteringResult, error) {
		called = true
		return contract.TopicClusteringResult{}, nil
	}}
	routes := evalrpc.TopicClusteringRoutes{API: api, InternalSecret: secret, MaxBodyBytes: 64}
	rec := postClustering(routes, "/go/evaluators/topics/batch_clustering", "Bearer "+secret, clusteringBody)
	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Equal(t, "evaluation_payload_too_large", errorCode(t, rec))
	assert.False(t, called)
}

func TestClusteringOverTheTraceCapIs413(t *testing.T) {
	called := false
	api := clusteringAPI{cluster: func(context.Context, contract.TopicClusteringRequest) (contract.TopicClusteringResult, error) {
		called = true
		return contract.TopicClusteringResult{}, nil
	}}
	routes := evalrpc.TopicClusteringRoutes{API: api, InternalSecret: secret, MaxTraces: 1}
	twoTraces := strings.Replace(clusteringBody, `"traces":[{`,
		`"traces":[{"trace_id":"b","input":"hi","topic_id":null,"subtopic_id":null},{`, 1)
	rec := postClustering(routes, "/go/evaluators/topics/batch_clustering", "Bearer "+secret, twoTraces)
	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Equal(t, "evaluation_payload_too_large", errorCode(t, rec))
	assert.False(t, called)
}

// @scenario "Fewer than 2 usable traces answers topic_clustering_too_few_traces"
func TestTooFewUsableTracesIs422(t *testing.T) {
	llm := memory.NewLLM()
	llm.ScriptEmbed(func(_ context.Context, req channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
		return channels.EmbeddingResponse{Vectors: make([][]float64, len(req.Inputs))}, nil
	})
	svc := services.NewTopicClusteringService(services.TopicClusteringDeps{LLM: llm})
	routes := evalrpc.TopicClusteringRoutes{API: clusteringAPI{cluster: svc.ClusterTopics}, InternalSecret: secret}
	rec := postClustering(routes, "/go/evaluators/topics/batch_clustering", "Bearer "+secret, clusteringBody)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, rec.Body.String())
	assert.Equal(t, "topic_clustering_too_few_traces", errorCode(t, rec))
}
