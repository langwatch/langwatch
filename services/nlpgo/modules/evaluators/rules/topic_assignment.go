package rules

import "github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"

// AssignmentMargin is how far past a topic's p95 a trace may still join it.
const AssignmentMargin = 1.1

// MatchTopic is get_matching_topic: the nearest centroid by cosine distance
// (the first wins a tie), accepted within 1.1 x its p95; -1 when none.
func MatchTopic(vector []float64, topics []contract.ClusteringTopic) int {
	if len(topics) == 0 {
		return -1
	}
	trace := Normed(vector)
	best, bestDistance := 0, 0.0
	for i, topic := range topics {
		d := CosineDistance(trace, Normed(topic.Centroid))
		if i == 0 || d < bestDistance {
			best, bestDistance = i, d
		}
	}
	if bestDistance <= topics[best].P95Distance*AssignmentMargin {
		return best
	}
	return -1
}

// AssignTrace is assign_trace_to_topic: keep given ids, else match a topic,
// then match a subtopic under it.
func AssignTrace(trace EmbeddedTrace, topics []contract.ClusteringTopic, subtopics []contract.ClusteringSubtopic) contract.TraceTopicAssignment {
	out := contract.TraceTopicAssignment{TraceID: trace.TraceID, TopicID: trace.TopicID, SubtopicID: trace.SubtopicID}
	if isBlank(out.TopicID) {
		out.TopicID = nil
		if i := MatchTopic(trace.Vector, topics); i >= 0 {
			out.TopicID = &topics[i].ID
		}
	}
	if out.TopicID != nil && isBlank(out.SubtopicID) {
		children := ChildTopics(subtopics, *out.TopicID)
		if i := MatchTopic(trace.Vector, children); i >= 0 {
			out.SubtopicID = &children[i].ID
		}
	}
	return out
}

// ChildTopics are the subtopics under parentID, as topics.
func ChildTopics(subtopics []contract.ClusteringSubtopic, parentID string) []contract.ClusteringTopic {
	var children []contract.ClusteringTopic
	for _, s := range subtopics {
		if s.ParentID == parentID {
			children = append(children, s.ClusteringTopic)
		}
	}
	return children
}

func isBlank(id *string) bool { return id == nil || *id == "" }
