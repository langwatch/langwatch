package rules

import "github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"

// EmbeddedTrace is a trace with its embedding.
type EmbeddedTrace struct {
	contract.ClusteringTrace
	Vector []float64
}

// Cluster is one flat cluster that survived its filters.
type Cluster struct {
	Label  int
	Traces []EmbeddedTrace
}

// TopicCluster is a topic-level cluster and its subtopic clusters.
type TopicCluster struct {
	Label     int
	Subtopics []Cluster
}
