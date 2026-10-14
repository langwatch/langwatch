package rules

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/rand/v2"
	"strings"
)

// Naming limits, as topic_naming.py hard-codes them.
const (
	NamingSampleRunes        = 140
	TopicSamplesPerSubtopic  = 5
	TopicSamplesLimit        = 30
	SubtopicSamplesLimit     = 20
	NamingBatchSamples       = 150
	SimilarNameDistance      = 0.6
	DisambiguationRounds     = 3
	StandInTopicName         = "New Sub Topics"
	NamingToolName           = "topicNames"
	namingToolDescriptionRaw = `"use this function to name the topics based on the examples provided, avoid using \"and\" or \"&\" in the name, try to name it with a single 2-3 words concept."`
)

// The prompts, rendered from topic_naming.py by the fixture recorder.
var (
	//go:embed prompts/topic_names.tmpl
	topicNamesPrompt string
	//go:embed prompts/topic_names_existing.tmpl
	topicNamesExistingPrompt string
	//go:embed prompts/topic_pair_names.tmpl
	topicPairNamesPrompt string
)

// NamingToolChoice forces the topicNames tool.
const NamingToolChoice = `{"type":"function","function":{"name":"topicNames"}}`

// ErrMissingName is a naming answer without a non-empty name for a topic.
var ErrMissingName = errors.New("missing topic name")

// SampleInputs is get_subtopic_samples: up to n distinct inputs in random
// order, each cut to 140 characters.
func SampleInputs(traces []EmbeddedTrace, n int, rng *rand.Rand) []string {
	seen := map[string]struct{}{}
	var distinct []string
	for _, t := range traces {
		if _, ok := seen[t.Input]; !ok {
			seen[t.Input] = struct{}{}
			distinct = append(distinct, t.Input)
		}
	}
	rng.Shuffle(len(distinct), func(i, j int) { distinct[i], distinct[j] = distinct[j], distinct[i] })
	samples := distinct[:min(n, len(distinct))]
	for i, s := range samples {
		if runes := []rune(s); len(runes) > NamingSampleRunes {
			samples[i] = string(runes[:NamingSampleRunes])
		}
	}
	return samples
}

// TopicSamples is a topic's naming examples: 5 per subtopic, shuffled, 30 kept.
func TopicSamples(topic TopicCluster, rng *rand.Rand) []string {
	var samples []string
	for _, sub := range topic.Subtopics {
		samples = append(samples, SampleInputs(sub.Traces, TopicSamplesPerSubtopic, rng)...)
	}
	rng.Shuffle(len(samples), func(i, j int) { samples[i], samples[j] = samples[j], samples[i] })
	return samples[:min(TopicSamplesLimit, len(samples))]
}

// SubtopicSamples is one example list per subtopic of a topic, 20 each.
func SubtopicSamples(topic TopicCluster, rng *rand.Rand) [][]string {
	examples := make([][]string, len(topic.Subtopics))
	for i, sub := range topic.Subtopics {
		examples[i] = SampleInputs(sub.Traces, SubtopicSamplesLimit, rng)
	}
	return examples
}

// NamingBatches is generate_topic_names_split's batching: topics are added
// until a batch holds the split size, at most 150 samples; [start, end) ranges.
func NamingBatches(examples [][]string) [][2]int {
	total := 0
	for _, e := range examples {
		total += len(e)
	}
	split := min(ceilDiv(total, max(1, ceilDiv(total, NamingBatchSamples))), NamingBatchSamples)
	var batches [][2]int
	start, size := 0, 0
	for i, e := range examples {
		size += len(e)
		if size >= split {
			batches = append(batches, [2]int{start, i + 1})
			start, size = i+1, 0
		}
	}
	if start < len(examples) {
		batches = append(batches, [2]int{start, len(examples)})
	}
	return batches
}

// NamesPrompt is generate_topic_names' system and user messages.
func NamesPrompt(examples [][]string, existing []string) (system, user string) {
	suffix := ""
	if names := strings.Join(existing, "\n"); names != "" {
		suffix = strings.Replace(topicNamesExistingPrompt, "{{.Names}}", names, 1)
	}
	sections := make([]string, len(examples))
	for i, samples := range examples {
		sections[i] = fmt.Sprintf("# Topic %d Samples\n\n", i) + strings.Join(samples, "\n")
	}
	return strings.Replace(topicNamesPrompt, "{{.Existing}}", suffix, 1), strings.Join(sections, "\n\n\n")
}

// NamesTool is the topicNames tool with properties topic_0..topic_{count-1}.
func NamesTool(count int) json.RawMessage {
	keys := make([]string, count)
	for i := range keys {
		keys[i] = fmt.Sprintf("topic_%d", i)
	}
	return namingTool(keys)
}

// PairTool is the topicNames tool with properties topic_a and topic_b.
func PairTool() json.RawMessage { return namingTool([]string{"topic_a", "topic_b"}) }

func namingTool(keys []string) json.RawMessage {
	properties := make([]string, len(keys))
	for i, k := range keys {
		properties[i] = fmt.Sprintf(`%q:{"type":"string"}`, k)
	}
	return json.RawMessage(`{"type":"function","function":{"name":"topicNames","parameters":{"type":"object","properties":{` +
		strings.Join(properties, ",") + `}},"description":` + namingToolDescriptionRaw + `}}`)
}

// ParseNames reads topic_0..topic_{count-1}; a missing or empty one fails.
func ParseNames(arguments string, count int) ([]string, error) {
	var answer map[string]any
	if err := json.Unmarshal([]byte(arguments), &answer); err != nil {
		return nil, fmt.Errorf("decode topic names: %w", err)
	}
	names := make([]string, count)
	for i := range names {
		name, _ := answer[fmt.Sprintf("topic_%d", i)].(string)
		if name == "" {
			return nil, fmt.Errorf("%w: topic_%d", ErrMissingName, i)
		}
		names[i] = name
	}
	return names, nil
}

// NamedExamples is one side of a disambiguation: a name and its examples.
type NamedExamples struct {
	Name     string
	Examples []string
}

// PairPrompt is improve_name_between_two_topics' system and user messages.
func PairPrompt(a, b NamedExamples) (system, user string) {
	return topicPairNamesPrompt, "# Topic A: " + a.Name + "\n\n" + strings.Join(a.Examples, "\n") +
		"\n\n# Topic B: " + b.Name + "\n\n" + strings.Join(b.Examples, "\n")
}

// ParsePairNames reads topic_a and topic_b; a missing key fails, null is kept as nil.
func ParsePairNames(arguments string) (a, b *string, err error) {
	var answer map[string]*string
	if err := json.Unmarshal([]byte(arguments), &answer); err != nil {
		return nil, nil, fmt.Errorf("decode pair names: %w", err)
	}
	a, okA := answer["topic_a"]
	b, okB := answer["topic_b"]
	if !okA || !okB {
		return nil, nil, fmt.Errorf("%w: topic_a or topic_b", ErrMissingName)
	}
	return a, b, nil
}

// ClosestPair is improve_similar_names' scan: the closest two named topics
// (strict <, i then j); ok only when their cosine distance is at most 0.6.
func ClosestPair(names []*string, vectors [][]float64) (a, b int, ok bool) {
	space := nameSpace{names: names, vectors: vectors}
	closest := math.Inf(1)
	a, b = -1, -1
	for i := range names {
		for j := range names {
			if d, named := space.distance(i, j); named && d < closest {
				closest, a, b = d, i, j
			}
		}
	}
	return a, b, a >= 0 && closest <= SimilarNameDistance
}

// nameSpace is the names and their embeddings (nil where embedding failed).
type nameSpace struct {
	names   []*string
	vectors [][]float64
}

// distance is 1 - cosine of two different, named, embedded topics.
func (s nameSpace) distance(i, j int) (float64, bool) {
	if i == j || s.vectors[i] == nil || s.vectors[j] == nil || isBlank(s.names[i]) || isBlank(s.names[j]) {
		return 0, false
	}
	return 1 - dot(s.vectors[i], s.vectors[j])/(Norm(s.vectors[i])*Norm(s.vectors[j])), true
}
