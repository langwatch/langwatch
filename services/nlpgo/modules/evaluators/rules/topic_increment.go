package rules

import "github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"

// The incremental thresholds (constants.py).
const (
	MinimumUnassignedForNewTopics    = 100
	MinimumUnassignedForNewSubtopics = 50
)

// ShouldCreateTopics reports whether more than 100 traces matched no topic.
func ShouldCreateTopics(unassigned int) bool { return unassigned > MinimumUnassignedForNewTopics }

// ShouldCreateSubtopics reports whether at least 50 traces matched a topic but none of its subtopics.
func ShouldCreateSubtopics(topicOnly int) bool { return topicOnly >= MinimumUnassignedForNewSubtopics }

// P95Ceiling is the mean p95 of the existing topics; NaN when there are
// none, which then filters nothing.
func P95Ceiling(topics []contract.ClusteringTopic) float64 {
	p95s := make([]float64, len(topics))
	for i, t := range topics {
		p95s[i] = t.P95Distance
	}
	return Mean(p95s)
}

// TopicOnlyGroup is the traces that matched one topic and none of its subtopics.
type TopicOnlyGroup struct {
	TopicID string
	Traces  []EmbeddedTrace
}

// GroupTopicOnly groups topic-only traces by topic, topics in first-seen order.
func GroupTopicOnly(traces []EmbeddedTrace, assignments []contract.TraceTopicAssignment) []TopicOnlyGroup {
	var groups []TopicOnlyGroup
	index := map[string]int{}
	for i, a := range assignments {
		if a.TopicID == nil || !isBlank(a.SubtopicID) {
			continue
		}
		at, ok := index[*a.TopicID]
		if !ok {
			at = len(groups)
			index[*a.TopicID] = at
			groups = append(groups, TopicOnlyGroup{TopicID: *a.TopicID})
		}
		groups[at].Traces = append(groups[at].Traces, traces[i])
	}
	return groups
}

// MergeAssignments keeps one row per trace, the later row winning, at the
// first row's position (Python emitted both; design §9 Q3).
func MergeAssignments(rows []contract.TraceTopicAssignment) []contract.TraceTopicAssignment {
	merged := make([]contract.TraceTopicAssignment, 0, len(rows))
	index := map[string]int{}
	for _, row := range rows {
		if at, ok := index[row.TraceID]; ok {
			merged[at] = row
			continue
		}
		index[row.TraceID] = len(merged)
		merged = append(merged, row)
	}
	return merged
}
