package rules_test

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// @scenario "Whitespace-only inputs are neither embedded nor returned"
func TestUsableTracesDropsBlankInputs(t *testing.T) {
	traces := []contract.ClusteringTrace{{TraceID: "a", Input: " \n\t"}, {TraceID: "b", Input: "hi "}, {TraceID: "c"}, {TraceID: "d", Input: "\x1f "}}
	usable := rules.UsableTraces(traces)
	require.Len(t, usable, 1)
	assert.Equal(t, "b", usable[0].TraceID)
}

// @scenario "Embeddings are padded or truncated to 1,536 dimensions"
func TestNormalizeDimensions(t *testing.T) {
	assert.Equal(t, []float64{1, 2, 0, 0}, rules.NormalizeDimensions([]float64{1, 2}, 4))
	assert.Equal(t, []float64{1, 2}, rules.NormalizeDimensions([]float64{1, 2, 3}, 2))
	assert.Len(t, rules.NormalizeDimensions(make([]float64, 3072), rules.EmbeddingDimensions), 1536)
}

// @scenario "A trace joins the nearest topic within 1.1 times its p95, else stays unassigned"
func TestMatchTopicAndAssignTrace(t *testing.T) {
	topics := func(p95 float64) []contract.ClusteringTopic {
		return []contract.ClusteringTopic{
			{ID: "a", Centroid: []float64{1, 0}, P95Distance: p95},
			{ID: "b", Centroid: []float64{0, 1}, P95Distance: p95},
		}
	}
	tie := []float64{1, 1} // 1 - 1/sqrt(2) ~ 0.2929 from both
	assert.Equal(t, 0, rules.MatchTopic(tie, topics(0.27)), "within 1.1 x p95, the first topic wins the tie")
	assert.Equal(t, -1, rules.MatchTopic(tie, topics(0.26)), "past 1.1 x p95")
	assert.Equal(t, 1, rules.MatchTopic([]float64{0.1, 1}, topics(0.1)))
	assert.Equal(t, -1, rules.MatchTopic(tie, nil))

	subtopics := []contract.ClusteringSubtopic{
		{ClusteringTopic: contract.ClusteringTopic{ID: "a1", Centroid: []float64{1, 0.2}, P95Distance: 0.1}, ParentID: "a"},
		{ClusteringTopic: contract.ClusteringTopic{ID: "b1", Centroid: []float64{1, 0}, P95Distance: 0.1}, ParentID: "b"},
	}
	trace := rules.EmbeddedTrace{ClusteringTrace: contract.ClusteringTrace{TraceID: "t"}, Vector: []float64{1, 0.1}}
	got := rules.AssignTrace(trace, topics(0.1), subtopics)
	require.NotNil(t, got.TopicID)
	require.NotNil(t, got.SubtopicID)
	assert.Equal(t, "a", *got.TopicID)
	assert.Equal(t, "a1", *got.SubtopicID, "only subtopics of the matched topic are candidates")

	kept := "b"
	trace.TopicID = &kept
	got = rules.AssignTrace(trace, topics(0.1), subtopics)
	assert.Equal(t, "b", *got.TopicID, "a given topic is kept")
	assert.Equal(t, "b1", *got.SubtopicID)
}

// @scenario "More than 100 unassigned traces create new topics bounded by the mean existing p95"
func TestIncrementThresholdsAndCeiling(t *testing.T) {
	assert.False(t, rules.ShouldCreateTopics(99))
	assert.False(t, rules.ShouldCreateTopics(100))
	assert.True(t, rules.ShouldCreateTopics(101))
	assert.False(t, rules.ShouldCreateSubtopics(49))
	assert.True(t, rules.ShouldCreateSubtopics(50))
	assert.InDelta(t, 0.2, rules.P95Ceiling([]contract.ClusteringTopic{{P95Distance: 0.1}, {P95Distance: 0.3}}), 1e-15)
	assert.True(t, math.IsNaN(rules.P95Ceiling(nil)), "no siblings: NaN, which filters nothing")
}

func TestMergeAssignmentsKeepsTheLaterRow(t *testing.T) {
	topic, sub := "topic", "sub"
	rows := rules.MergeAssignments([]contract.TraceTopicAssignment{
		{TraceID: "x", TopicID: &topic},
		{TraceID: "y", TopicID: &topic},
		{TraceID: "x", TopicID: &topic, SubtopicID: &sub},
	})
	require.Len(t, rows, 2)
	assert.Equal(t, "x", rows[0].TraceID)
	assert.Equal(t, &sub, rows[0].SubtopicID)
}

func TestBuildResponseSurvivalAndReparent(t *testing.T) {
	trace := func(id, input string) rules.EmbeddedTrace {
		return rules.EmbeddedTrace{ClusteringTrace: contract.ClusteringTrace{TraceID: id, Input: input}, Vector: []float64{1, float64(len(input))}}
	}
	five := []rules.EmbeddedTrace{trace("1", "a"), trace("2", "bb"), trace("3", "ccc"), trace("4", "dddd"), trace("5", "eeeee")}
	two := []rules.EmbeddedTrace{trace("6", "a"), trace("7", "a")}
	hierarchy := []rules.TopicCluster{{Subtopics: []rules.Cluster{{Traces: five}, {Traces: two}}}, {Subtopics: []rules.Cluster{{Traces: five}}}}
	name := "named"
	ids := 0
	newID := func(prefix string) string { ids++; return prefix + string(rune('0'+ids)) }
	out := rules.BuildResponse(rules.ResponseInput{Hierarchy: hierarchy, TopicNames: []*string{&name, nil}, SubtopicNames: [][]*string{{&name, &name}, {&name}}, NewID: newID})
	require.Len(t, out.Topics, 1, "an unnamed topic is not created")
	require.Len(t, out.Subtopics, 1, "a subtopic with 1 distinct input is not created")
	assert.Equal(t, out.Topics[0].ID, out.Subtopics[0].ParentID)
	require.Len(t, out.Traces, 12)
	assert.Nil(t, out.Traces[5].SubtopicID)
	assert.Equal(t, out.Topics[0].ID, *out.Traces[5].TopicID)
	assert.Nil(t, out.Traces[7].TopicID, "traces of a dropped topic keep a row with no ids")

	moved := rules.ReparentSubtopics(out, "topic_real")
	assert.Equal(t, "topic_real", moved.Subtopics[0].ParentID)
	for _, row := range moved.Traces {
		assert.Equal(t, "topic_real", *row.TopicID)
	}
}

func TestLinkageRefusesTooFewOrNonFinite(t *testing.T) {
	_, err := rules.WardLinkage(1, nil)
	require.ErrorIs(t, err, rules.ErrTooFewObservations)
	_, err = rules.WardLinkage(2, []float64{math.NaN()})
	require.ErrorIs(t, err, rules.ErrNonFiniteDistance)
	assert.True(t, math.IsNaN(rules.Percentile95([]float64{0.1, math.NaN()})))
	assert.InDelta(t, 0.3, rules.Percentile95([]float64{0.3}), 0)
}

// @scenario "The naming prompts match Python byte for byte"
func TestNamingPromptsMatchPython(t *testing.T) {
	type call struct {
		Messages []struct {
			Content string `json:"content"`
		} `json:"messages"`
		Tools      []json.RawMessage `json:"tools"`
		ToolChoice json.RawMessage   `json:"tool_choice"`
	}
	var recorded struct {
		Names         call `json:"names"`
		NamesExisting call `json:"names_existing"`
		Pair          call `json:"pair"`
	}
	loadFixture(t, "prompts.json", &recorded)

	system, user := rules.NamesPrompt([][]string{{"t01 s0 q001", "t01 s0 q002"}, {"t02 s1 q003"}}, nil)
	assert.Equal(t, recorded.Names.Messages[0].Content, system)
	assert.Equal(t, recorded.Names.Messages[1].Content, user)
	assert.JSONEq(t, string(recorded.Names.Tools[0]), string(rules.NamesTool(2)))
	assert.JSONEq(t, rules.NamingToolChoice, string(recorded.Names.ToolChoice))

	system, user = rules.NamesPrompt([][]string{{"t01 s0 q001"}}, []string{"Billing", "Refunds"})
	assert.Equal(t, recorded.NamesExisting.Messages[0].Content, system)
	assert.Equal(t, recorded.NamesExisting.Messages[1].Content, user)

	system, user = rules.PairPrompt(rules.NamedExamples{Name: "Billing", Examples: []string{"t01 s0 q001", "x"}}, rules.NamedExamples{Name: "Payments", Examples: []string{"t02 s1 q003"}})
	assert.Equal(t, recorded.Pair.Messages[0].Content, system)
	assert.Equal(t, recorded.Pair.Messages[1].Content, user)
	assert.JSONEq(t, string(recorded.Pair.Tools[0]), string(rules.PairTool()))
}

// @scenario "Names are asked in batches of at most 150 samples with the existing names"
func TestNamingBatches(t *testing.T) {
	examples := func(topics, samples int) [][]string {
		out := make([][]string, topics)
		for i := range out {
			out[i] = make([]string, samples)
		}
		return out
	}
	assert.Equal(t, [][2]int{{0, 5}, {5, 10}}, rules.NamingBatches(examples(10, 20)), "200 samples split into two calls of 100")
	assert.Equal(t, [][2]int{{0, 3}}, rules.NamingBatches(examples(3, 5)))
	assert.Equal(t, [][2]int{{0, 1}, {1, 2}}, rules.NamingBatches(examples(2, 0)), "no samples: one call per topic, as Python")
	assert.Equal(t, [][2]int{{0, 5}, {5, 10}, {10, 15}}, rules.NamingBatches(examples(15, 30)), "450 samples: calls of at most 150")

	system, _ := rules.NamesPrompt([][]string{{"x"}}, []string{"Billing", "Refunds"})
	assert.Contains(t, system, "Billing\nRefunds")
}

func TestParseNamesAndClosestPair(t *testing.T) {
	names, err := rules.ParseNames(`{"topic_1":"B","topic_0":"A"}`, 2)
	require.NoError(t, err)
	assert.Equal(t, []string{"A", "B"}, names)
	_, err = rules.ParseNames(`{"topic_0":"A","topic_1":""}`, 2)
	require.ErrorIs(t, err, rules.ErrMissingName)
	a, b, err := rules.ParsePairNames(`{"topic_a":"X","topic_b":null}`)
	require.NoError(t, err)
	assert.Equal(t, "X", *a)
	assert.Nil(t, b)
	_, _, err = rules.ParsePairNames(`{"topic_a":"X"}`)
	require.ErrorIs(t, err, rules.ErrMissingName)

	n := func(s string) *string { return &s }
	vectors := [][]float64{{1, 0, 0}, {0, 1, 0}, {1, 0.1, 0}, {1, 0, 0}}
	i, j, ok := rules.ClosestPair([]*string{n("a"), n("b"), n("c"), n("")}, vectors)
	assert.True(t, ok)
	assert.Equal(t, [2]int{0, 2}, [2]int{i, j}, "unnamed topics are skipped")
	_, _, ok = rules.ClosestPair([]*string{n("a"), n("b")}, vectors[:2])
	assert.False(t, ok, "orthogonal names are over 0.6 apart")
}
