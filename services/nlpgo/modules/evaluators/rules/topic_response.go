package rules

import "github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"

// Id prefixes for the records clustering creates.
const (
	TopicIDPrefix    = "topic_"
	SubtopicIDPrefix = "subtopic_"
)

// ClusteringResponse is build_response's output, before cost.
type ClusteringResponse struct {
	Topics    []contract.ClusteringTopic
	Subtopics []contract.ClusteringSubtopic
	Traces    []contract.TraceTopicAssignment
}

// ResponseInput is a named hierarchy: one name per topic, one per subtopic
// (nil when naming failed), and the id source.
type ResponseInput struct {
	Hierarchy     []TopicCluster
	TopicNames    []*string
	SubtopicNames [][]*string
	NewID         func(prefix string) string
}

// BuildResponse is build_response: a topic survives with a subtopic, 5
// distinct inputs and a name, its centroid over its subtopics' traces; a
// subtopic also needs a surviving topic. Every trace gets a row.
func BuildResponse(in ResponseInput) ClusteringResponse {
	b := responseBuilder{newID: in.NewID}
	for ti, topic := range in.Hierarchy {
		topicID := b.addTopic(topic, in.TopicNames[ti])
		for si, sub := range topic.Subtopics {
			subtopicID := b.addSubtopic(sub, in.SubtopicNames[ti][si], topicID)
			b.addRows(sub.Traces, topicID, subtopicID)
		}
	}
	return b.out
}

type responseBuilder struct {
	out   ClusteringResponse
	newID func(prefix string) string
}

func (b *responseBuilder) addTopic(topic TopicCluster, name *string) *string {
	var samples []EmbeddedTrace
	for _, sub := range topic.Subtopics {
		samples = append(samples, sub.Traces...)
	}
	if len(topic.Subtopics) < MinimumSubtopicsPerTopic || DistinctInputs(samples) < MinimumDistinctInputs || name == nil {
		return nil
	}
	id := b.newID(TopicIDPrefix)
	centroid, p95 := CentroidAndP95(vectorsOf(samples))
	b.out.Topics = append(b.out.Topics, contract.ClusteringTopic{ID: id, Name: *name, Centroid: centroid, P95Distance: p95})
	return &id
}

func (b *responseBuilder) addSubtopic(sub Cluster, name, topicID *string) *string {
	if topicID == nil || DistinctInputs(sub.Traces) < MinimumDistinctInputs || name == nil {
		return nil
	}
	id := b.newID(SubtopicIDPrefix)
	centroid, p95 := CentroidAndP95(vectorsOf(sub.Traces))
	b.out.Subtopics = append(b.out.Subtopics, contract.ClusteringSubtopic{
		ClusteringTopic: contract.ClusteringTopic{ID: id, Name: *name, Centroid: centroid, P95Distance: p95},
		ParentID:        *topicID,
	})
	return &id
}

func (b *responseBuilder) addRows(traces []EmbeddedTrace, topicID, subtopicID *string) {
	for _, trace := range traces {
		b.out.Traces = append(b.out.Traces, contract.TraceTopicAssignment{TraceID: trace.TraceID, TopicID: topicID, SubtopicID: subtopicID})
	}
}

// ReparentSubtopics moves new subtopics built under a stand-in topic to their
// real parent, and their traces with them (design §9 Q1: Python kept the
// stand-in's id, which is never created).
func ReparentSubtopics(built ClusteringResponse, parentID string) ClusteringResponse {
	out := ClusteringResponse{Subtopics: built.Subtopics}
	for i := range out.Subtopics {
		out.Subtopics[i].ParentID = parentID
	}
	for _, row := range built.Traces {
		out.Traces = append(out.Traces, contract.TraceTopicAssignment{TraceID: row.TraceID, TopicID: &parentID, SubtopicID: row.SubtopicID})
	}
	return out
}
