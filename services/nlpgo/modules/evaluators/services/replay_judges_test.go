package services_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/memory"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

// judgeReplayObservers collect what the service logs and its own ops spans.
type judgeReplayObservers struct {
	logs  *observer.ObservedLogs
	spans *tracetest.InMemoryExporter
}

// judgeReplay names a judge's fixture and, optionally, the cases to replay.
type judgeReplay struct {
	slug  string
	file  string
	names []string
}

// replayJudgeCases replays recorded judge cases (all, or those named).
func replayJudgeCases(t *testing.T, replay judgeReplay) judgeReplayObservers {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "testdata", "fixtures", replay.file))
	require.NoError(t, err)
	var cases []llmFixtureCase
	require.NoError(t, json.Unmarshal(raw, &cases))
	seen := judgeReplayObservers{spans: tracetest.NewInMemoryExporter()}
	core, logs := observer.New(zap.DebugLevel)
	seen.logs = logs
	ran := 0
	for i := range cases {
		if len(replay.names) > 0 && !slices.Contains(replay.names, cases[i].Name) {
			continue
		}
		ran++
		t.Run(cases[i].Name, func(t *testing.T) {
			replayJudgeCase(t, judgeCaseRun{slug: replay.slug, c: &cases[i], spans: seen.spans, logger: zap.New(core)})
		})
	}
	require.Equal(t, max(len(replay.names), ran), ran, "every named case is recorded")
	return seen
}

type judgeCaseRun struct {
	slug   string
	c      *llmFixtureCase
	spans  *tracetest.InMemoryExporter
	logger *zap.Logger
}

// replayJudgeCase runs one case. TS sends X_LITELLM_model with every
// configured provider, so the replay does too.
func replayJudgeCase(t *testing.T, run judgeCaseRun) {
	t.Helper()
	recording := newRecordedLLM(t, run.c.Calls)
	service := services.NewEvaluationService(services.EvaluationDeps{
		Config:        contract.DefaultConfig(),
		LLM:           recording,
		CustomerTrace: memory.NewCustomerTrace(),
		OpsTracer:     sdktrace.NewTracerProvider(sdktrace.WithSyncer(run.spans)).Tracer("replay"),
		Logger:        run.logger,
		Evaluators:    services.BuiltinEvaluators(),
	})
	settings := run.c.Settings
	if len(settings) == 0 {
		settings = json.RawMessage(`{}`)
	}
	env := recording.env(run.c.Env)
	env["X_LITELLM_model"] = judgeModelOf(t, settings)
	results, err := service.Evaluate(context.Background(), contract.EvaluateRequest{
		Tenant:    contract.Tenant{ProjectID: "project_replay", Env: env},
		Evaluator: run.slug,
		Entries:   []contract.Entry{run.c.Entry},
		Settings:  settings,
	})
	require.NoError(t, err)
	require.Len(t, results, 1)
	compareResult(t, &run.c.fixtureCase, results[0], replayOptions{Tolerance: 1e-9})
	recording.assertAllCallsMade(t)
}

// judgeModelOf is the settings' model, or langevals' default.
func judgeModelOf(t *testing.T, settings json.RawMessage) string {
	t.Helper()
	var parsed struct {
		Model string `json:"model"`
	}
	require.NoError(t, json.Unmarshal(settings, &parsed))
	if parsed.Model == "" {
		return "openai/gpt-5-mini"
	}
	return parsed.Model
}

// @scenario "Each langevals judge replays its recorded answers, requests included"
func TestReplayJudgesAnswerAsLangevalsAnswered(t *testing.T) {
	for _, judge := range []string{
		"llm_boolean", "llm_score", "llm_category", "llm_answer_match", "competitor_llm",
		"competitor_llm_function_call", "off_topic", "query_resolution", "select_best_compare",
	} {
		t.Run(judge, func(t *testing.T) {
			replayJudgeCases(t, judgeReplay{slug: "langevals/" + judge, file: "langevals__" + judge + ".json"})
		})
	}
}

// @scenario "A refused forced tool call is retried with a reminder, as langevals does"
func TestReplayJudgeRetriesARefusedForcedToolCallWithAReminder(t *testing.T) {
	replayJudgeCases(t, judgeReplay{slug: "langevals/llm_boolean", file: "langevals__llm_boolean.json", names: []string{"forced_tool_choice_refused_retries_auto", "partial_tool_call_retries_with_reminder", "tool_call_arguments_not_json", "refusal_no_tool_call"}})
}

// @scenario "GPT-5 judges run at temperature 1 and Anthropic judges without top_p"
func TestReplayJudgePinsGPT5TemperatureAndDropsClaudeTopP(t *testing.T) {
	replayJudgeCases(t, judgeReplay{slug: "langevals/llm_boolean", file: "langevals__llm_boolean.json", names: []string{"gpt5_temperature_pinned", "anthropic_sampling_drops_top_p"}})
	replayJudgeCases(t, judgeReplay{slug: "langevals/llm_answer_match", file: "langevals__llm_answer_match.json", names: []string{"gpt5_temperature_pinned"}})
}

// @scenario "Content over the token budget is cut keeping both ends, and the details say so"
func TestReplayJudgeCutsLongContentKeepingBothEnds(t *testing.T) {
	replayJudgeCases(t, judgeReplay{slug: "langevals/llm_boolean", file: "langevals__llm_boolean.json", names: []string{"over_token_budget_cut"}})
}

// @scenario "A judge prompt that leaves no room for content is skipped with the numbers"
func TestReplayJudgeSkipsWhenThePromptLeavesNoRoom(t *testing.T) {
	replayJudgeCases(t, judgeReplay{slug: "langevals/llm_boolean", file: "langevals__llm_boolean.json", names: []string{"over_token_budget_skipped"}})
}

// observedJudgeText is every log line and ops span text the replay wrote.
func observedJudgeText(t *testing.T, seen judgeReplayObservers) []string {
	t.Helper()
	var written []string
	entries := seen.logs.All()
	for i := range entries {
		written = append(written, entries[i].Message, fmt.Sprint(entries[i].ContextMap()))
	}
	spans := seen.spans.GetSpans()
	require.NotEmpty(t, spans)
	for i := range spans {
		span := &spans[i]
		written = append(written, span.Name, span.Status.Description, fmt.Sprint(span.Attributes))
		for j := range span.Events {
			written = append(written, span.Events[j].Name, fmt.Sprint(span.Events[j].Attributes))
		}
	}
	return written
}

// @scenario "Judge prompts and entry content never reach a log or a LangWatch span"
func TestJudgePromptsAndContentNeverReachLogsOrOpsSpans(t *testing.T) {
	seen := replayJudgeCases(t, judgeReplay{slug: "langevals/llm_boolean", file: "langevals__llm_boolean.json", names: []string{"pass", "refusal_no_tool_call", "tool_call_arguments_not_json"}})
	secrets := []string{"What is the capital of France", "Paris is the capital", "You are an LLM evaluator", "Scripted reasoning", "Answer only by calling"}
	written := observedJudgeText(t, seen)
	for _, text := range written {
		for _, secret := range secrets {
			assert.NotContains(t, text, secret)
		}
	}
	assert.True(t, slices.ContainsFunc(written, func(text string) bool { return strings.Contains(text, "JudgeAnswerError") }), "the failure is still named")
}
