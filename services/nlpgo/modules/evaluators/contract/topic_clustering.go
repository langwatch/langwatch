package contract

import "github.com/langwatch/langwatch/pkg/herr"

// Topic clustering's error codes. The transport registers their statuses:
// failed is 500, too few traces is 422 (design: plans/langevals-go/topic-clustering-go.md §9 Q6).
const (
	ErrTopicClusteringFailed       herr.Code = "topic_clustering_failed"
	ErrTopicClusteringTooFewTraces herr.Code = "topic_clustering_too_few_traces"
)

// ClusteringMode picks the flow: a first clustering or an increment.
type ClusteringMode string

const (
	// ClusteringBatch clusters a page of traces from scratch.
	ClusteringBatch ClusteringMode = "batch"
	// ClusteringIncremental assigns traces to existing topics and grows them.
	ClusteringIncremental ClusteringMode = "incremental"
)

// ClusteringTrace is one trace as langevals receives it.
type ClusteringTrace struct {
	TraceID    string  `json:"trace_id"`
	Input      string  `json:"input"`
	TopicID    *string `json:"topic_id"`
	SubtopicID *string `json:"subtopic_id"`
}

// ClusteringTopic is a topic with the centroid assignment compares against.
type ClusteringTopic struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Centroid    []float64 `json:"centroid"`
	P95Distance float64   `json:"p95_distance"`
}

// ClusteringSubtopic is a topic under a parent topic.
type ClusteringSubtopic struct {
	ClusteringTopic
	ParentID string `json:"parent_id"`
}

// TraceTopicAssignment places one trace; nil ids mean no topic or subtopic.
type TraceTopicAssignment struct {
	TraceID    string  `json:"trace_id"`
	TopicID    *string `json:"topic_id"`
	SubtopicID *string `json:"subtopic_id"`
}

// TopicClusteringRequest is one clustering call. Tenant.Env carries the
// X_LITELLM_* and X_LITELLM_EMBEDDINGS_* params, as for evaluations.
type TopicClusteringRequest struct {
	Mode            ClusteringMode
	Tenant          Tenant
	ChatModel       string
	EmbeddingsModel string
	Dimensions      int
	Traces          []ClusteringTrace
	Topics          []ClusteringTopic
	Subtopics       []ClusteringSubtopic
}

// TopicClusteringResult is langevals' response body.
type TopicClusteringResult struct {
	Topics    []ClusteringTopic      `json:"topics"`
	Subtopics []ClusteringSubtopic   `json:"subtopics"`
	Traces    []TraceTopicAssignment `json:"traces"`
	Cost      Money                  `json:"cost"`
}
