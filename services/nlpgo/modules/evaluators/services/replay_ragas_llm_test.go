package services_test

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/memory"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

// ragasLLMEvaluators are the ragas LLM metrics with their definitions.
func ragasLLMEvaluators() map[string]services.Evaluator {
	prepares := services.RagasLLMPrepares()
	evaluators := map[string]services.Evaluator{}
	definitions := rules.Definitions()
	for i := range definitions {
		if prepare, ok := prepares[definitions[i].Slug]; ok {
			evaluators[definitions[i].Slug] = services.Evaluator{Definition: definitions[i], Prepare: prepare}
		}
	}
	return evaluators
}

// ragasObserved is a service over one LLM channel whose logs and ops spans
// the test can read.
type ragasObserved struct {
	service *services.EvaluationService
	logs    *observer.ObservedLogs
	spans   *tracetest.InMemoryExporter
}

func newRagasService(llm channels.LLMChannel) ragasObserved {
	core, logs := observer.New(zapcore.DebugLevel)
	spans := tracetest.NewInMemoryExporter()
	return ragasObserved{
		service: services.NewEvaluationService(services.EvaluationDeps{
			Config:        contract.DefaultConfig(),
			LLM:           llm,
			CustomerTrace: memory.NewCustomerTrace(),
			OpsTracer:     sdktrace.NewTracerProvider(sdktrace.WithSyncer(spans)).Tracer("replay"),
			Logger:        zap.New(core),
			Evaluators:    ragasLLMEvaluators(),
		}),
		logs:  logs,
		spans: spans,
	}
}

// ragasEnv adds X_LITELLM_model, which TS sends for the judge model and the
// recording, run without TS, left out.
func ragasEnv(env map[string]string, settings json.RawMessage) map[string]string {
	parsed := rules.DefaultRagasSettings()
	_ = json.Unmarshal(settings, &parsed)
	env["X_LITELLM_model"] = parsed.Model
	return env
}

func loadRagasCases(t *testing.T, file string) []llmFixtureCase {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "testdata", "fixtures", file))
	require.NoError(t, err)
	var cases []llmFixtureCase
	require.NoError(t, json.Unmarshal(raw, &cases))
	require.NotEmpty(t, cases)
	return cases
}

// ragasEvaluation is one case run through one service with the tenant env.
type ragasEvaluation struct {
	observed ragasObserved
	slug     string
	c        *llmFixtureCase
	env      map[string]string
}

func evaluateRagas(t *testing.T, run ragasEvaluation) contract.Result {
	t.Helper()
	observed, slug, c, env := run.observed, run.slug, run.c, run.env
	settings := c.Settings
	if len(settings) == 0 {
		settings = json.RawMessage(`{}`)
	}
	results, err := observed.service.Evaluate(context.Background(), contract.EvaluateRequest{
		Tenant:    contract.Tenant{ProjectID: "project_replay", Env: ragasEnv(env, settings)},
		Evaluator: slug,
		Entries:   []contract.Entry{c.Entry},
		Settings:  settings,
	})
	require.NoError(t, err)
	require.Len(t, results, 1)
	return results[0]
}

// replayRagasLLM runs every recorded case of one metric through the real
// gateway channel: each request must match a recorded one, rendered prompt
// byte for byte, and every recorded call must be made.
func replayRagasLLM(t *testing.T, slug string) {
	t.Helper()
	cases := loadRagasCases(t, strings.ReplaceAll(slug, "/", "__")+".json")
	for i := range cases {
		c := &cases[i]
		t.Run(c.Name, func(t *testing.T) {
			recording := newRecordedLLM(t, c.Calls)
			got := evaluateRagas(t, ragasEvaluation{observed: newRagasService(recording), slug: slug, c: c, env: recording.env(c.Env)})
			compareResult(t, &c.fixtureCase, got, replayOptions{Tolerance: 1e-9})
			recording.assertAllCallsMade(t)
		})
	}
}

// @scenario "Each ragas LLM metric replays its recorded answers, prompts byte-identical"
func TestRagasLLMMetricsReplayTheirRecordings(t *testing.T) {
	for _, slug := range []string{
		"ragas/faithfulness",
		"ragas/factual_correctness",
		"ragas/response_context_recall",
		"ragas/response_context_precision",
		"ragas/response_relevancy",
		"ragas/summarization_score",
		"ragas/rubrics_based_scoring",
		"ragas/sql_query_equivalence",
	} {
		t.Run(slug, func(t *testing.T) { replayRagasLLM(t, slug) })
	}
}

// @scenario "Response relevancy asks for three questions, and scores one when the provider returns one"
func TestRagasRelevancyAsksForThreeAndScoresWhatComesBack(t *testing.T) {
	cases := loadRagasCases(t, "ragas__response_relevancy.json")
	for _, name := range []string{"committal_n3", "provider_ignores_n"} {
		t.Run(name, func(t *testing.T) {
			c := ragasCase(t, cases, name)
			for _, call := range c.Calls {
				if call.Kind == "chat" {
					assert.InDelta(t, 3.0, decodeObject(t, call.Request)["n"], 0, "the recorded request asks for three")
				}
			}
			recording := newRecordedLLM(t, c.Calls)
			got := evaluateRagas(t, ragasEvaluation{observed: newRagasService(recording), slug: "ragas/response_relevancy", c: c, env: recording.env(c.Env)})
			compareResult(t, &c.fixtureCase, got, replayOptions{Tolerance: 1e-9})
			recording.assertAllCallsMade(t)
		})
	}
}

func ragasCase(t *testing.T, cases []llmFixtureCase, name string) *llmFixtureCase {
	t.Helper()
	for i := range cases {
		if cases[i].Name == name {
			return &cases[i]
		}
	}
	t.Fatalf("no recorded case %q", name)
	return nil
}

// scriptedRagas is a memory LLM answering every call with one choice.
func scriptedRagas(content, finishReason string) *memory.LLM {
	llm := memory.NewLLM()
	llm.ScriptComplete(func(context.Context, channels.CompletionRequest) (channels.CompletionResponse, error) {
		return channels.CompletionResponse{Choices: []channels.Choice{{Content: content, FinishReason: finishReason}}}, nil
	})
	return llm
}

func rubricsCase() *llmFixtureCase {
	input, output := "What is the capital of France?", "Paris."
	return &llmFixtureCase{fixtureCase: fixtureCase{Entry: contract.Entry{Input: &input, Output: &output}}}
}

// @scenario "Malformed JSON from the model is repaired at most three times"
func TestRagasRepairsMalformedJSONAtMostThreeTimes(t *testing.T) {
	llm := scriptedRagas("this is not json", "stop")
	got := evaluateRagas(t, ragasEvaluation{observed: newRagasService(llm), slug: "ragas/rubrics_based_scoring", c: rubricsCase(), env: map[string]string{}})

	assert.Equal(t, contract.StatusError, got.Status)
	assert.Equal(t, "RagasOutputParserException", got.ErrorType)
	calls := llm.Completions()
	require.Len(t, calls, 4, "one call and three repairs")
	for _, call := range calls[1:] {
		prompt, ok := call.Messages[0].Content.(string)
		require.True(t, ok)
		assert.True(t, strings.HasPrefix(prompt, "The output string did not satisfy the constraints"), "a repair prompt")
	}
}

// @scenario "A model answer cut off by the length limit aborts the metric"
func TestRagasLengthCutAbortsWithoutRepair(t *testing.T) {
	llm := scriptedRagas(`{"feedback": "cut`, "length")
	got := evaluateRagas(t, ragasEvaluation{observed: newRagasService(llm), slug: "ragas/rubrics_based_scoring", c: rubricsCase(), env: map[string]string{}})

	assert.Equal(t, contract.StatusError, got.Status)
	assert.Equal(t, "LLMDidNotFinishException", got.ErrorType)
	assert.Len(t, llm.Completions(), 1, "no repair and no retry")
}

// failedFirst is the case's one recorded chat call answered with status.
func failedFirst(t *testing.T, c *llmFixtureCase, status int) recordedCall {
	t.Helper()
	require.Len(t, c.Calls, 1)
	failed := c.Calls[0]
	failed.Status = status
	failed.Response = json.RawMessage(`{"error":{"message":"scripted failure"}}`)
	return failed
}

// @scenario "Only rate limits are retried"
func TestRagasRetriesOnlyRateLimits(t *testing.T) {
	cases := loadRagasCases(t, "ragas__rubrics_based_scoring.json")
	c := ragasCase(t, cases, "default_rubrics_high")

	t.Run("a rate limit is retried", func(t *testing.T) {
		recording := newRecordedLLM(t, []recordedCall{failedFirst(t, c, http.StatusTooManyRequests), c.Calls[0]})
		got := evaluateRagas(t, ragasEvaluation{observed: newRagasService(recording), slug: "ragas/rubrics_based_scoring", c: c, env: recording.env(c.Env)})
		compareResult(t, &c.fixtureCase, got, replayOptions{Tolerance: 1e-9})
		recording.assertAllCallsMade(t)
	})
	t.Run("a server error is not", func(t *testing.T) {
		recording := newRecordedLLM(t, []recordedCall{failedFirst(t, c, http.StatusInternalServerError)})
		got := evaluateRagas(t, ragasEvaluation{observed: newRagasService(recording), slug: "ragas/rubrics_based_scoring", c: c, env: recording.env(c.Env)})
		assert.Equal(t, contract.StatusError, got.Status)
		recording.assertAllCallsMade(t)
	})
}

// @scenario "Metric prompts and entry content never reach a log or a LangWatch span"
func TestRagasContentStaysOutOfLogsAndOpsSpans(t *testing.T) {
	cases := loadRagasCases(t, "ragas__faithfulness.json")
	for _, name := range []string{"unfaithful_asks_dont_know", "finish_reason_length"} {
		t.Run(name, func(t *testing.T) {
			c := ragasCase(t, cases, name)
			recording := newRecordedLLM(t, c.Calls)
			observed := newRagasService(recording)
			evaluateRagas(t, ragasEvaluation{observed: observed, slug: "ragas/faithfulness", c: c, env: recording.env(c.Env)})

			secrets := []string{*c.Entry.Output, "France", "judge the faithfulness", "Scripted"}
			seen := ragasTelemetry(observed)
			require.NotEmpty(t, seen)
			for _, secret := range secrets {
				assert.NotContains(t, strings.Join(seen, "\n"), secret)
			}
		})
	}
}

// ragasTelemetry is every log message and field, and every ops span's name,
// status and attribute value.
func ragasTelemetry(observed ragasObserved) []string {
	var seen []string
	entries := observed.logs.All()
	for i := range entries {
		seen = append(seen, entries[i].Message, stringify(entries[i].ContextMap()))
	}
	spans := observed.spans.GetSpans()
	for i := range spans {
		seen = append(seen, spans[i].Name, spans[i].Status.Description)
		for j := range spans[i].Attributes {
			seen = append(seen, spans[i].Attributes[j].Value.String())
		}
	}
	return seen
}

func stringify(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}
