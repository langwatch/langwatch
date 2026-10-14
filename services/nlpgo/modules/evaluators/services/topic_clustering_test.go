package services_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/memory"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

// The generator and scripted models mirror
// services/langevals/evaluators/topic_clustering/scripts/record_go_fixtures.py.

func syntheticNoise(seed uint64) []float64 {
	out := make([]float64, rules.EmbeddingDimensions)
	state := seed
	next := func() float64 {
		state += 0x9E3779B97F4A7C15
		z := state
		z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
		z = (z ^ (z >> 27)) * 0x94D049BB133111EB
		z ^= z >> 31
		return float64(z>>11) * 0x1p-53
	}
	for j := range out {
		u0, u1, u2, u3 := next(), next(), next(), next()
		out[j] = u0 + u1 + u2 + u3 - 2
	}
	return out
}

func syntheticVector(text string) []float64 {
	var topic, sub, q uint64
	if n, _ := fmt.Sscanf(text, "t%d s%d q%d", &topic, &sub, &q); n != 3 {
		return nameVector(text)
	}
	b, c := 0.5, 0.3
	switch {
	case sub >= 7:
		b, c = 0.3, 0.2
	case topic >= 8:
		b, c = 0.4, 0.2
	}
	base, offset := syntheticNoise(1000+topic), syntheticNoise(2_000_000+topic*1000+sub)
	point := syntheticNoise(3_000_000_000 + topic*1_000_000 + sub*10_000 + q)
	v := make([]float64, rules.EmbeddingDimensions)
	var squares float64
	for j := range v {
		v[j] = base[j] + float64(b*offset[j])
		v[j] += float64(c * point[j])
		squares += float64(v[j] * v[j])
	}
	norm := math.Sqrt(squares)
	for j := range v {
		v[j] = float64(float32(v[j] / norm))
	}
	return v
}

func nameVector(name string) []float64 {
	v := make([]float64, rules.EmbeddingDimensions)
	var topic, sub int
	n, _ := fmt.Sscanf(name, "t%d s%d", &topic, &sub)
	switch n {
	case 2:
		v[topic*10+sub+1] = 1
	case 1:
		v[topic*10] = 1
	default:
		v[len(v)-1] = 1
	}
	return v
}

func scriptedName(samples []string) string {
	heads, topics := map[string]bool{}, map[string]bool{}
	for _, s := range samples {
		parts := strings.SplitN(s, " ", 3)
		heads[strings.Join(parts[:min(2, len(parts))], " ")] = true
		topics[parts[0]] = true
	}
	for _, set := range []map[string]bool{heads, topics} {
		if len(set) == 1 {
			for k := range set {
				return k
			}
		}
	}
	return "mixed"
}

func scriptedArguments(req channels.CompletionRequest) string {
	user, _ := req.Messages[1].Content.(string)
	answer := map[string]string{}
	if strings.Contains(string(req.Tools[0]), `"topic_a"`) {
		answer["topic_a"] = strings.TrimPrefix(strings.SplitN(user, "\n\n", 2)[0], "# Topic A: ") + " a"
		answer["topic_b"] = strings.SplitN(strings.SplitN(user, "# Topic B: ", 2)[1], "\n\n", 2)[0] + " b"
	} else {
		for i, section := range strings.Split(user, "\n\n\n") {
			answer[fmt.Sprintf("topic_%d", i)] = scriptedName(strings.Split(strings.SplitN(section, "\n\n", 2)[1], "\n"))
		}
	}
	raw, _ := json.Marshal(answer)
	return string(raw)
}

func toolAnswer(arguments string, cost *float64) channels.CompletionResponse {
	return channels.CompletionResponse{Choices: []channels.Choice{{ToolCalls: []channels.ToolCall{{Name: rules.NamingToolName, Arguments: arguments}}}}, CostUSD: cost}
}

func embedByText(_ context.Context, req channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
	vectors := make([][]float64, len(req.Inputs))
	for i, text := range req.Inputs {
		vectors[i] = syntheticVector(text)
	}
	return channels.EmbeddingResponse{Vectors: vectors}, nil
}

// scriptedLLM answers embeddings from the generator and names by sample prefix.
func scriptedLLM(cost *float64) *memory.LLM {
	llm := memory.NewLLM()
	llm.ScriptEmbed(embedByText)
	llm.ScriptComplete(func(_ context.Context, req channels.CompletionRequest) (channels.CompletionResponse, error) {
		return toolAnswer(scriptedArguments(req), cost), nil
	})
	return llm
}

type sleeps struct {
	mu    sync.Mutex
	waits []time.Duration
}

func (s *sleeps) sleep(ctx context.Context, d time.Duration) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.waits = append(s.waits, d)
	return ctx.Err()
}

func newService(llm channels.LLMChannel, configure ...func(*services.TopicClusteringDeps)) (*services.TopicClusteringService, *sleeps) {
	slept := &sleeps{}
	ids := 0
	deps := services.TopicClusteringDeps{
		LLM:     llm,
		NewID:   func(prefix string) string { ids++; return fmt.Sprintf("%s%04d", prefix, ids) },
		NewRand: func() *rand.Rand { return rand.New(rand.NewPCG(1, 2)) }, //nolint:gosec // G404: a fixed seed so naming samples repeat
		Sleep:   slept.sleep,
	}
	for _, c := range configure {
		c(&deps)
	}
	return services.NewTopicClusteringService(deps), slept
}

// traces mirrors the recorder's traces_for: (topic, subtopic, first q, count, distinct).
func traces(spec [][5]int) []contract.ClusteringTrace {
	var out []contract.ClusteringTrace
	for _, s := range spec {
		for i := range s[3] {
			out = append(out, contract.ClusteringTrace{
				TraceID: fmt.Sprintf("tr-%02d-%d-%03d", s[0], s[1], s[2]+i),
				Input:   fmt.Sprintf("t%02d s%d q%03d", s[0], s[1], s[2]+i%s[4]),
			})
		}
	}
	return out
}

func request(mode contract.ClusteringMode, traces []contract.ClusteringTrace) contract.TopicClusteringRequest {
	return contract.TopicClusteringRequest{
		Mode: mode, Tenant: contract.Tenant{ProjectID: "project_fixture"},
		ChatModel: "openai/gpt-5-mini", EmbeddingsModel: "openai/text-embedding-3-small", Traces: traces,
	}
}

// twoTopics is the recorder's n48 grid: 2 topics of 2 subtopics of 12 traces.
var twoTopics = [][5]int{{0, 0, 0, 12, 12}, {0, 1, 0, 12, 12}, {1, 0, 0, 12, 12}, {1, 1, 0, 12, 12}}

type recordedCase struct {
	Name     string   `json:"name"`
	Spec     [][5]int `json:"spec"`
	Existing []struct {
		ID        string   `json:"id"`
		Name      string   `json:"name"`
		Inputs    []string `json:"inputs"`
		Subtopics []struct {
			ID     string   `json:"id"`
			Name   string   `json:"name"`
			Inputs []string `json:"inputs"`
		} `json:"subtopics"`
	} `json:"existing"`
	Topics    []string     `json:"topics"`
	Subtopics [][2]string  `json:"subtopics"`
	Rows      [][3]*string `json:"rows"`
	Cost      float64      `json:"cost"`
}

func centroidAndP95(inputs []string) ([]float64, float64) {
	vectors := make([][]float64, len(inputs))
	for i, text := range inputs {
		vectors[i] = syntheticVector(text)
	}
	return rules.CentroidAndP95(vectors)
}

// runRecorded clusters one recorded case in Go with the recorder's scripted models.
func runRecorded(t *testing.T, name string) (recordedCase, contract.TopicClusteringRequest, contract.TopicClusteringResult) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "clustering", "cases.json"))
	require.NoError(t, err)
	var cases []recordedCase
	require.NoError(t, json.Unmarshal(raw, &cases))
	i := slices.IndexFunc(cases, func(c recordedCase) bool { return c.Name == name })
	require.GreaterOrEqual(t, i, 0)
	c := cases[i]
	mode := contract.ClusteringIncremental
	if c.Name == "base" {
		mode = contract.ClusteringBatch
	}
	req := request(mode, traces(c.Spec))
	for _, topic := range c.Existing {
		centroid, p95 := centroidAndP95(topic.Inputs)
		req.Topics = append(req.Topics, contract.ClusteringTopic{ID: topic.ID, Name: topic.Name, Centroid: centroid, P95Distance: p95})
		for _, sub := range topic.Subtopics {
			centroid, p95 := centroidAndP95(sub.Inputs)
			req.Subtopics = append(req.Subtopics, contract.ClusteringSubtopic{ClusteringTopic: contract.ClusteringTopic{ID: sub.ID, Name: sub.Name, Centroid: centroid, P95Distance: p95}, ParentID: topic.ID})
		}
	}
	cost := 0.001
	svc, _ := newService(scriptedLLM(&cost))
	result, err := svc.ClusterTopics(context.Background(), req)
	require.NoError(t, err)
	return c, req, result
}

func namesByID(req contract.TopicClusteringRequest, result contract.TopicClusteringResult) map[string]string {
	names := map[string]string{}
	for _, topic := range append(slices.Clone(req.Topics), result.Topics...) {
		names[topic.ID] = topic.Name
	}
	for _, sub := range append(slices.Clone(req.Subtopics), result.Subtopics...) {
		names[sub.ID] = sub.Name
	}
	return names
}

// @scenario "Batch and incremental membership match the Python recording"
func TestClusterTopicsMatchesPythonRecording(t *testing.T) {
	for _, name := range []string{"base", "grow", "few"} {
		t.Run(name, func(t *testing.T) {
			c, req, result := runRecorded(t, name)
			parents := map[string]string{}
			for _, pair := range c.Subtopics {
				parents[pair[0]] = pair[1]
			}
			want := map[string][2]string{}
			for _, row := range c.Rows {
				if row[1] == nil {
					continue // Python's null rows: dropped in Go (design §9 Q2)
				}
				topic, sub := *row[1], ""
				if row[2] != nil {
					sub = *row[2]
				}
				if topic == "<unknown>" {
					topic = parents[sub] // Python's never-created parent (design §9 Q1)
				}
				want[*row[0]] = [2]string{topic, sub} // the later row wins (design §9 Q3)
			}
			names := namesByID(req, result)
			got := map[string][2]string{}
			for _, row := range result.Traces {
				if row.TopicID == nil {
					continue
				}
				sub := ""
				if row.SubtopicID != nil {
					sub = names[*row.SubtopicID]
				}
				got[row.TraceID] = [2]string{names[*row.TopicID], sub}
			}
			assert.Equal(t, want, got)

			var topics []string
			for _, topic := range result.Topics {
				topics = append(topics, topic.Name)
			}
			slices.Sort(topics)
			assert.Equal(t, c.Topics, orNil(topics))
			var subtopics [][2]string
			for _, sub := range result.Subtopics {
				subtopics = append(subtopics, [2]string{sub.Name, names[sub.ParentID]})
			}
			slices.SortFunc(subtopics, func(a, b [2]string) int { return strings.Compare(a[0]+a[1], b[0]+b[1]) })
			assert.Equal(t, c.Subtopics, orNil(subtopics))
			assert.InDelta(t, c.Cost, result.Cost.Amount, 1e-12)
			assert.Equal(t, "USD", result.Cost.Currency)
		})
	}
}

func orNil[T any](s []T) []T {
	if len(s) == 0 {
		return []T{}
	}
	return s
}

// @scenario "100 or fewer unassigned traces are left out of the answer"
func TestFewUnassignedTracesAreLeftOut(t *testing.T) {
	c, _, result := runRecorded(t, "few")
	pythonNulls := 0
	for _, row := range c.Rows {
		if row[1] == nil {
			pythonNulls++
		}
	}
	assert.Equal(t, 100, pythonNulls, "the recording shows Python's null rows")
	assert.Empty(t, result.Topics)
	for _, row := range result.Traces {
		assert.NotNil(t, row.TopicID, "trace %s", row.TraceID)
	}
}

// @scenario "New subtopics are created under the topic their traces matched"
func TestNewSubtopicsKeepTheirRealParent(t *testing.T) {
	_, req, result := runRecorded(t, "grow")
	names := namesByID(req, result)
	created := 0
	for _, sub := range result.Subtopics {
		if sub.Name == "t03 s7" {
			created++
			assert.Equal(t, "topic_t03", sub.ParentID)
		}
	}
	assert.Equal(t, 1, created)
	for _, row := range result.Traces {
		require.NotNil(t, row.TopicID)
		assert.Contains(t, names, *row.TopicID, "every row's topic exists or was created")
	}
}

// @scenario "A trace appears once even when its topic gains new subtopics"
func TestTraceAppearsOnce(t *testing.T) {
	_, req, result := runRecorded(t, "grow")
	names := namesByID(req, result)
	seen := map[string]bool{}
	for _, row := range result.Traces {
		assert.False(t, seen[row.TraceID], "trace %s has two rows", row.TraceID)
		seen[row.TraceID] = true
		if strings.HasPrefix(row.TraceID, "tr-03-7-") {
			require.NotNil(t, row.SubtopicID)
			assert.Equal(t, "t03 s7", names[*row.SubtopicID])
		}
	}
}

// oneTopic is an incremental page of 25 traces that all join one existing topic.
func oneTopic() contract.TopicClusteringRequest {
	req := request(contract.ClusteringIncremental, traces([][5]int{{0, 0, 0, 25, 25}}))
	inputs := make([]string, len(req.Traces))
	for i, tr := range req.Traces {
		inputs[i] = tr.Input
	}
	centroid, _ := centroidAndP95(inputs)
	req.Topics = []contract.ClusteringTopic{{ID: "topic_x", Name: "x", Centroid: centroid, P95Distance: 1}}
	return req
}

// @scenario "A failed embedding batch falls back to one call per text"
func TestEmbeddingBatchFailureFallsBackPerText(t *testing.T) {
	llm := memory.NewLLM()
	llm.ScriptEmbed(func(ctx context.Context, req channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
		if len(req.Inputs) > 1 || req.Inputs[0] == "t00 s0 q003" || req.Inputs[0] == "t00 s0 q017" {
			return channels.EmbeddingResponse{}, errors.New("provider answered 500")
		}
		return embedByText(ctx, req)
	})
	svc, _ := newService(llm)
	result, err := svc.ClusterTopics(context.Background(), oneTopic())
	require.NoError(t, err)
	singles := 0
	for _, call := range llm.Embeddings() {
		if len(call.Inputs) == 1 {
			singles++
		}
	}
	assert.Equal(t, 25, singles)
	require.Len(t, result.Traces, 23)
	for _, row := range result.Traces {
		assert.NotContains(t, []string{"tr-00-0-003", "tr-00-0-017"}, row.TraceID)
	}
}

// @scenario "A third failed text fails the clustering"
func TestThirdFailedTextFailsTheClustering(t *testing.T) {
	llm := memory.NewLLM()
	llm.ScriptEmbed(func(ctx context.Context, req channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
		if len(req.Inputs) > 1 || slices.Contains([]string{"t00 s0 q001", "t00 s0 q002", "t00 s0 q020"}, req.Inputs[0]) {
			return channels.EmbeddingResponse{}, errors.New("provider answered 500")
		}
		return embedByText(ctx, req)
	})
	svc, _ := newService(llm)
	_, err := svc.ClusterTopics(context.Background(), oneTopic())
	require.True(t, herr.IsCode(err, contract.ErrTopicClusteringFailed), "got %v", err)
}

// @scenario "Missing embedding credentials fail at once without a per-text retry"
func TestMissingEmbeddingCredentialsFailAtOnce(t *testing.T) {
	llm := memory.NewLLM()
	llm.ScriptEmbed(func(context.Context, channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
		return channels.EmbeddingResponse{}, channels.ErrProviderNotConfigured
	})
	svc, _ := newService(llm)
	_, err := svc.ClusterTopics(context.Background(), oneTopic())
	require.True(t, herr.IsCode(err, contract.ErrTopicClusteringFailed))
	for _, call := range llm.Embeddings() {
		assert.Greater(t, len(call.Inputs), 1, "no per-text call")
	}
}

// @scenario "Embedding cost is counted only when embedding pricing is switched on"
func TestEmbeddingCostFollowsTheSwitch(t *testing.T) {
	for _, priced := range []bool{false, true} {
		llm := memory.NewLLM()
		llm.ScriptEmbed(func(ctx context.Context, req channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
			resp, err := embedByText(ctx, req)
			half := 0.5
			resp.CostUSD = &half
			return resp, err
		})
		svc, _ := newService(llm, func(d *services.TopicClusteringDeps) { d.PriceEmbeddings = priced })
		result, err := svc.ClusterTopics(context.Background(), oneTopic())
		require.NoError(t, err)
		want := 0.0
		if priced {
			want = 1.0 // two batches of 20 and 5
		}
		assert.InDelta(t, want, result.Cost.Amount, 0, "priced=%v", priced)
	}
}

// @scenario "A missing name is retried, then the topic is dropped"
func TestMissingNameIsRetriedThenDropped(t *testing.T) {
	llm := scriptedLLM(nil)
	llm.ScriptComplete(func(context.Context, channels.CompletionRequest) (channels.CompletionResponse, error) {
		return toolAnswer(`{"topic_0":""}`, nil), nil
	})
	svc, slept := newService(llm)
	result, err := svc.ClusterTopics(context.Background(), request(contract.ClusteringBatch, traces(twoTopics)))
	require.NoError(t, err)
	assert.Empty(t, result.Topics)
	assert.Empty(t, result.Subtopics)
	assert.Len(t, llm.Completions(), 12, "3 naming calls (topics, and each topic's subtopics), 4 attempts each")
	assert.Len(t, slept.waits, 9)
	for _, row := range result.Traces {
		assert.Nil(t, row.TopicID)
	}
}

// @scenario "Similar names are disambiguated at most three times"
func TestSimilarNamesAreDisambiguatedAtMostThreeTimes(t *testing.T) {
	llm := scriptedLLM(nil)
	llm.ScriptComplete(func(_ context.Context, req channels.CompletionRequest) (channels.CompletionResponse, error) {
		if strings.Contains(string(req.Tools[0]), `"topic_a"`) {
			return toolAnswer(`{"topic_a":"same","topic_b":"same"}`, nil), nil
		}
		return toolAnswer(`{"topic_0":"same","topic_1":"same"}`, nil), nil
	})
	svc, _ := newService(llm)
	result, err := svc.ClusterTopics(context.Background(), request(contract.ClusteringBatch, traces(twoTopics)))
	require.NoError(t, err)
	pairs := 0
	for _, call := range llm.Completions() {
		if strings.Contains(string(call.Tools[0]), `"topic_a"`) {
			pairs++
		}
	}
	assert.Equal(t, 9, pairs, "3 rounds in each of the 3 naming tasks")
	assert.Len(t, result.Topics, 2)
}

// @scenario "The cost is the sum of the naming calls in USD"
func TestCostIsTheSumOfNamingCalls(t *testing.T) {
	quarter := 0.25
	llm := scriptedLLM(&quarter)
	svc, _ := newService(llm)
	result, err := svc.ClusterTopics(context.Background(), request(contract.ClusteringBatch, traces(twoTopics)))
	require.NoError(t, err)
	require.Len(t, result.Topics, 2)
	assert.InDelta(t, 0.25*float64(len(llm.Completions())), result.Cost.Amount, 0)
	assert.Equal(t, "USD", result.Cost.Currency)
}

// @scenario "An unpriced chat model still names topics at zero cost"
func TestUnpricedChatModelStillNames(t *testing.T) {
	svc, _ := newService(scriptedLLM(nil))
	result, err := svc.ClusterTopics(context.Background(), request(contract.ClusteringBatch, traces(twoTopics)))
	require.NoError(t, err)
	assert.Len(t, result.Topics, 2)
	assert.Zero(t, result.Cost.Amount)
}

// @scenario "Clustering past its deadline stops provider calls and answers an error"
func TestDeadlineStopsProviderCalls(t *testing.T) {
	canceled := make(chan struct{}, 8)
	llm := memory.NewLLM()
	llm.ScriptEmbed(func(ctx context.Context, _ channels.EmbeddingRequest) (channels.EmbeddingResponse, error) {
		<-ctx.Done()
		canceled <- struct{}{}
		return channels.EmbeddingResponse{}, ctx.Err()
	})
	svc, _ := newService(llm, func(d *services.TopicClusteringDeps) { d.Deadline = 20 * time.Millisecond })
	_, err := svc.ClusterTopics(context.Background(), oneTopic())
	require.True(t, herr.IsCode(err, contract.ErrTopicClusteringFailed))
	assert.NotEmpty(t, canceled, "the provider call saw its context canceled")
}

func TestTooFewUsableTracesIsCoded(t *testing.T) {
	svc, _ := newService(scriptedLLM(nil))
	req := request(contract.ClusteringBatch, []contract.ClusteringTrace{{TraceID: "a", Input: "t00 s0 q000"}, {TraceID: "b", Input: "  "}})
	_, err := svc.ClusterTopics(context.Background(), req)
	require.True(t, herr.IsCode(err, contract.ErrTopicClusteringTooFewTraces))
}
