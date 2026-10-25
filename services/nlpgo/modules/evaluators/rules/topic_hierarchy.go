package rules

import (
	"strings"
	"unicode"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// Python's constants.py, plus build_hierarchy's defaults.
const (
	TopicDistance            = 4.0
	SubtopicDistance         = 2.0
	MinimumDistinctInputs    = 5
	MinimumSubtopicsPerTopic = 1
	MaximumTopicP95          = 1.0
	EmbeddingDimensions      = 1536
)

// UsableTraces drops traces whose input is empty or whitespace only, as
// Python's str.strip() judges it (which also strips \x1c to \x1f).
func UsableTraces(traces []contract.ClusteringTrace) []contract.ClusteringTrace {
	usable := make([]contract.ClusteringTrace, 0, len(traces))
	for _, t := range traces {
		if strings.TrimFunc(t.Input, isPythonSpace) != "" {
			usable = append(usable, t)
		}
	}
	return usable
}

func isPythonSpace(r rune) bool {
	return unicode.IsSpace(r) || (r >= 0x1c && r <= 0x1f)
}

// NormalizeDimensions zero-pads or truncates an embedding to dim.
func NormalizeDimensions(v []float64, dim int) []float64 {
	if len(v) >= dim {
		return v[:dim]
	}
	return append(append(make([]float64, 0, dim), v...), make([]float64, dim-len(v))...)
}

// DistinctInputs counts the traces' different inputs.
func DistinctInputs(traces []EmbeddedTrace) int {
	seen := map[string]struct{}{}
	for _, t := range traces {
		seen[t.Input] = struct{}{}
	}
	return len(seen)
}

func vectorsOf(traces []EmbeddedTrace) [][]float64 {
	vectors := make([][]float64, len(traces))
	for i, t := range traces {
		vectors[i] = t.Vector
	}
	return vectors
}

// FlatClusters is one build_hierarchy level: Ward linkage cut at distance,
// labels in ascending order, dropping clusters with fewer than 5 distinct
// inputs or a p95 over maximumP95 (a NaN ceiling drops nothing).
func FlatClusters(traces []EmbeddedTrace, distance, maximumP95 float64) ([]Cluster, error) {
	dist, err := Pdist(vectorsOf(traces))
	if err != nil {
		return nil, err
	}
	z, err := WardLinkage(len(traces), dist)
	if err != nil {
		return nil, err
	}
	labels := FlatClustersByDistance(z, distance)
	members := map[int][]EmbeddedTrace{}
	top := 0
	for i, l := range labels {
		members[l] = append(members[l], traces[i])
		top = max(top, l)
	}
	var clusters []Cluster
	for l := 1; l <= top; l++ {
		if DistinctInputs(members[l]) < MinimumDistinctInputs {
			continue
		}
		if _, p95 := CentroidAndP95(vectorsOf(members[l])); p95 > maximumP95 {
			continue
		}
		clusters = append(clusters, Cluster{Label: l, Traces: members[l]})
	}
	return clusters, nil
}

// BuildTopicHierarchy is build_hierarchy(t=4) with subtopics at t=2 under the
// same ceiling; a topic without a surviving subtopic is dropped.
func BuildTopicHierarchy(traces []EmbeddedTrace, maximumP95 float64) ([]TopicCluster, error) {
	topics, err := FlatClusters(traces, TopicDistance, maximumP95)
	if err != nil {
		return nil, err
	}
	var hierarchy []TopicCluster
	for _, topic := range topics {
		subtopics, err := FlatClusters(topic.Traces, SubtopicDistance, maximumP95)
		if err != nil {
			return nil, err
		}
		if len(subtopics) < MinimumSubtopicsPerTopic {
			continue
		}
		hierarchy = append(hierarchy, TopicCluster{Label: topic.Label, Subtopics: subtopics})
	}
	return hierarchy, nil
}
