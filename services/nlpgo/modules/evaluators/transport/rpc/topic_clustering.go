package rpc

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/langwatch/langwatch/pkg/herr"
	httprpc "github.com/langwatch/langwatch/pkg/rpc"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// DefaultClusteringMaxBodyBytes is the clustering body cap (plan §5.4).
const DefaultClusteringMaxBodyBytes int64 = 180 << 20

// TopicClusteringRoutes are what the two clustering routes need. A zero
// MaxBodyBytes is DefaultClusteringMaxBodyBytes.
type TopicClusteringRoutes struct {
	API            contract.EvaluatorRuntimeAPI
	InternalSecret string
	MaxBodyBytes   int64
}

// clusteringBody is langevals' batch and incremental request body;
// deployment_name is accepted and ignored (design §2.1).
type clusteringBody struct {
	ProjectID               string                        `json:"project_id"`
	Traces                  []contract.ClusteringTrace    `json:"traces"`
	Topics                  []contract.ClusteringTopic    `json:"topics"`
	Subtopics               []contract.ClusteringSubtopic `json:"subtopics"`
	LiteLLMParams           map[string]string             `json:"litellm_params"`
	EmbeddingsLiteLLMParams map[string]any                `json:"embeddings_litellm_params"`
	DeploymentName          *string                       `json:"deployment_name"`
}

// MountTopicClustering adds POST /go/evaluators/topics/{batch,incremental}_clustering.
func MountTopicClustering(mux *http.ServeMux, routes TopicClusteringRoutes) {
	contract.RegisterStatuses()
	httprpc.RegisterStatuses()
	herr.RegisterStatus(contract.ErrTopicClusteringFailed, http.StatusInternalServerError)
	herr.RegisterStatus(contract.ErrTopicClusteringTooFewTraces, http.StatusUnprocessableEntity)
	maxBodyBytes := routes.MaxBodyBytes
	if maxBodyBytes == 0 {
		maxBodyBytes = DefaultClusteringMaxBodyBytes
	}
	for _, mode := range []contract.ClusteringMode{contract.ClusteringBatch, contract.ClusteringIncremental} {
		mux.Handle("POST /go/evaluators/topics/"+string(mode)+"_clustering",
			requireInternalSecret(routes.InternalSecret, clusteringHandler(routes.API, mode, maxBodyBytes)))
	}
}

func clusteringHandler(api contract.EvaluatorRuntimeAPI, mode contract.ClusteringMode, maxBodyBytes int64) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := httprpc.Decode[clusteringBody](w, r, maxBodyBytes)
		if herr.IsCode(err, httprpc.CodePayloadTooLarge) {
			err = herr.New(r.Context(), contract.ErrPayloadTooLarge, herr.M{"message": "clustering payload too large"})
		}
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		result, err := api.ClusterTopics(r.Context(), clusteringRequest(mode, body))
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}
		var encoded bytes.Buffer
		if err := json.NewEncoder(&encoded).Encode(result); err != nil {
			herr.WriteHTTP(w, herr.New(r.Context(), contract.ErrTopicClusteringFailed, herr.M{"message": "topic clustering result is not encodable"}, err))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(encoded.Bytes())
	}
}

// clusteringRequest moves the litellm params into Tenant.Env under the
// X_LITELLM_* and X_LITELLM_EMBEDDINGS_* names the LLM channel reads.
func clusteringRequest(mode contract.ClusteringMode, body clusteringBody) contract.TopicClusteringRequest {
	env := map[string]string{}
	for key, value := range body.LiteLLMParams {
		env["X_LITELLM_"+key] = value
	}
	dimensions := addEmbeddingsParams(env, body.EmbeddingsLiteLLMParams)
	return contract.TopicClusteringRequest{
		Mode:            mode,
		Tenant:          contract.Tenant{ProjectID: body.ProjectID, Env: env},
		ChatModel:       body.LiteLLMParams["model"],
		EmbeddingsModel: env["X_LITELLM_EMBEDDINGS_model"],
		Dimensions:      dimensions,
		Traces:          body.Traces,
		Topics:          body.Topics,
		Subtopics:       body.Subtopics,
	}
}

// addEmbeddingsParams copies the embeddings params into env and answers the
// dimensions they ask for, which are not a provider param.
func addEmbeddingsParams(env map[string]string, params map[string]any) int {
	dimensions := rules.EmbeddingDimensions
	for key, value := range params {
		switch {
		case key == "dimensions":
			dimensions = dimensionsOf(value, dimensions)
		case value != nil:
			env["X_LITELLM_EMBEDDINGS_"+key] = paramText(value)
		}
	}
	return dimensions
}

func dimensionsOf(value any, fallback int) int {
	if n, err := strconv.Atoi(paramText(value)); err == nil && n > 0 {
		return n
	}
	return fallback
}

// paramText is a param as litellm would read it: a string as is, else its text.
func paramText(value any) string {
	if s, ok := value.(string); ok {
		return s
	}
	return fmt.Sprint(value)
}
