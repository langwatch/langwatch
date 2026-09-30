package services_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/memory"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

const (
	judgeSlug     = "test/llm_judge"
	judgeSettings = `{"model":"openai/gpt-4o-mini"}`
)

type harness struct {
	service *services.EvaluationService
	llm     *memory.LLM
	trace   *memory.CustomerTrace
	spans   *tracetest.InMemoryExporter
	logs    *observer.ObservedLogs
}

func newHarness(t *testing.T, cfg contract.Config, judgeCalls int) harness {
	t.Helper()
	spans := tracetest.NewInMemoryExporter()
	provider := sdktrace.NewTracerProvider(sdktrace.WithSyncer(spans))
	t.Cleanup(func() { _ = provider.Shutdown(context.Background()) })
	core, logs := observer.New(zap.DebugLevel)

	evaluators := services.BuiltinEvaluators()
	evaluators[judgeSlug] = judgeEvaluator(judgeCalls)
	h := harness{llm: memory.NewLLM(), trace: memory.NewCustomerTrace(), spans: spans, logs: logs}
	h.service = services.NewEvaluationService(services.EvaluationDeps{
		Config:        cfg,
		LLM:           h.llm,
		CustomerTrace: h.trace,
		OpsTracer:     provider.Tracer("test"),
		Logger:        zap.New(core),
		Evaluators:    evaluators,
	})
	return h
}

// judgeEvaluator is a test-only LLM judge: it sends the entry to the model
// `calls` times and passes when every call answers.
func judgeEvaluator(calls int) services.Evaluator {
	type settings struct {
		Model string `json:"model"`
	}
	parse := func(raw json.RawMessage) (settings, error) {
		var s settings
		if err := json.Unmarshal(raw, &s); err != nil || s.Model == "" {
			return s, errors.New("model is required")
		}
		return s, nil
	}
	score := func(ctx context.Context, s settings, in services.EntryRun) (contract.Result, error) {
		content := *in.Entry.Input
		if in.Entry.Output != nil {
			content += " " + *in.Entry.Output
		}
		content += " " + string(in.Entry.Contexts)
		for range calls {
			_, err := in.Models.Complete(ctx, channels.CompletionRequest{
				Model:    s.Model,
				Messages: []channels.Message{{Role: "user", Content: content}},
			})
			if err != nil {
				return contract.Result{}, err
			}
		}
		passed, value := true, 1.0
		return contract.Result{Status: contract.StatusProcessed, Passed: &passed, Score: &value}, nil
	}
	return services.Evaluator{
		Definition: rules.Definition{Slug: judgeSlug, RequiredFields: []string{rules.FieldInput}},
		Prepare:    services.WithSettings(parse, score),
	}
}

func testConfig() contract.Config {
	cfg := contract.DefaultConfig()
	cfg.BusyWaitSeconds = 1
	return cfg
}

func tenant(projectID string) contract.Tenant {
	return contract.Tenant{ProjectID: projectID, Env: map[string]string{
		"X_LITELLM_model":   "openai/gpt-4o-mini",
		"X_LITELLM_api_key": projectID + "-key",
	}}
}

func text(s string) *string { return &s }

func judgeRequest(t contract.Tenant, input string) contract.EvaluateRequest {
	return contract.EvaluateRequest{
		Tenant:    t,
		Evaluator: judgeSlug,
		Entries:   []contract.Entry{{Input: text(input)}},
		Settings:  json.RawMessage(judgeSettings),
	}
}

func answer(costUSD float64) func(context.Context, channels.CompletionRequest) (channels.CompletionResponse, error) {
	return func(context.Context, channels.CompletionRequest) (channels.CompletionResponse, error) {
		return channels.CompletionResponse{
			Choices: []channels.Choice{{Content: "yes", FinishReason: "stop"}},
			Usage:   channels.Usage{PromptTokens: 10, CompletionTokens: 2},
			CostUSD: &costUSD,
		}, nil
	}
}

// @scenario "An unknown evaluator is refused by name"
func TestEvaluateRefusesAnUnknownEvaluatorByName(t *testing.T) {
	h := newHarness(t, testConfig(), 1)

	_, err := h.service.Evaluate(t.Context(), contract.EvaluateRequest{
		Tenant:    tenant("acme"),
		Evaluator: "langevals/does_not_exist",
	})

	require.Error(t, err)
	require.ErrorIs(t, err, contract.ErrEvaluatorNotFound)
	var handled herr.E
	require.ErrorAs(t, err, &handled)
	assert.Equal(t, "langevals/does_not_exist", handled.Meta["evaluator"])
}

func TestEvaluateRefusesARequestWithoutATenant(t *testing.T) {
	h := newHarness(t, testConfig(), 1)

	_, err := h.service.Evaluate(t.Context(), judgeRequest(contract.Tenant{}, "hi"))

	require.ErrorIs(t, err, contract.ErrTenantMissing)
}

// @scenario "Invalid settings are refused before any model call"
func TestEvaluateRefusesInvalidSettingsBeforeAnyModelCall(t *testing.T) {
	h := newHarness(t, testConfig(), 1)
	h.llm.ScriptComplete(answer(0.001))
	req := judgeRequest(tenant("acme"), "hi")
	req.Settings = json.RawMessage(`{"model":""}`)

	_, err := h.service.Evaluate(t.Context(), req)

	require.ErrorIs(t, err, contract.ErrEvaluatorSettingsInvalid)
	assert.Empty(t, h.llm.Completions())
}

// @scenario "Concurrent evaluations use only their own tenant's credentials"
func TestConcurrentEvaluationsUseOnlyTheirOwnTenantsCredentials(t *testing.T) {
	cfg := testConfig()
	cfg.BusyWaitSeconds = 30
	h := newHarness(t, cfg, 2)
	h.llm.ScriptComplete(answer(0.001))

	const evaluations = 40
	errs := make([]error, evaluations)
	statuses := make([]contract.Status, evaluations)
	var wg sync.WaitGroup
	for i := range evaluations {
		projectID := []string{"acme", "globex"}[i%2]
		wg.Go(func() {
			results, err := h.service.Evaluate(context.Background(), judgeRequest(tenant(projectID), "question from "+projectID))
			errs[i] = err
			if err == nil {
				statuses[i] = results[0].Status
			}
		})
	}
	wg.Wait()
	for i := range evaluations {
		require.NoError(t, errs[i])
		assert.Equal(t, contract.StatusProcessed, statuses[i])
	}

	completions := h.llm.Completions()
	require.Len(t, completions, 80)
	for _, req := range completions {
		projectID := req.Tenant.ProjectID
		assert.Equal(t, projectID+"-key", req.Tenant.Env["X_LITELLM_api_key"])
		content, ok := req.Messages[0].Content.(string)
		require.True(t, ok)
		assert.Contains(t, content, "question from "+projectID)
	}
}

// @scenario "The runtime never supplies credentials of its own"
func TestTheRuntimeNeverSuppliesCredentialsOfItsOwn(t *testing.T) {
	t.Setenv("OPENAI_API_KEY", "sk-host-key")
	t.Setenv("X_LITELLM_model", "openai/gpt-4o-mini")
	h := newHarness(t, testConfig(), 1)
	h.llm.ScriptComplete(answer(0.001))

	results, err := h.service.Evaluate(t.Context(), judgeRequest(contract.Tenant{ProjectID: "acme"}, "hi"))

	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, contract.StatusError, results[0].Status)
	require.NotNil(t, results[0].Details)
	assert.Equal(t, "model provider not configured", *results[0].Details)
	assert.Empty(t, h.llm.Completions())
}

// @scenario "One tenant's burst does not starve another"
func TestOneTenantsBurstDoesNotStarveAnother(t *testing.T) {
	cfg := testConfig()
	cfg.MaxInFlightPerProject = 2
	cfg.BusyWaitSeconds = 30
	h := newHarness(t, cfg, 1)
	releaseAcme := make(chan struct{})
	h.llm.ScriptComplete(func(ctx context.Context, req channels.CompletionRequest) (channels.CompletionResponse, error) {
		if req.Tenant.ProjectID == "acme" {
			<-releaseAcme
		}
		return answer(0.001)(ctx, req)
	})

	acmeErrs := make([]error, cfg.MaxInFlightPerProject)
	var acme sync.WaitGroup
	for i := range cfg.MaxInFlightPerProject {
		acme.Go(func() {
			_, acmeErrs[i] = h.service.Evaluate(context.Background(), judgeRequest(tenant("acme"), "hi"))
		})
	}
	require.Eventually(t, func() bool { return len(h.llm.Completions()) == cfg.MaxInFlightPerProject },
		5*time.Second, 10*time.Millisecond)

	started := time.Now()
	results, err := h.service.Evaluate(t.Context(), judgeRequest(tenant("globex"), "hi"))

	require.NoError(t, err)
	assert.Equal(t, contract.StatusProcessed, results[0].Status)
	assert.Less(t, time.Since(started), time.Second)
	close(releaseAcme)
	acme.Wait()
	for _, err := range acmeErrs {
		require.NoError(t, err)
	}
}

// @scenario "A project over its limit waits, then is told when to retry"
func TestAProjectOverItsLimitWaitsThenIsToldWhenToRetry(t *testing.T) {
	cfg := testConfig()
	cfg.MaxInFlightPerProject = 1
	h := newHarness(t, cfg, 1)
	release := make(chan struct{})
	h.llm.ScriptComplete(func(ctx context.Context, req channels.CompletionRequest) (channels.CompletionResponse, error) {
		<-release
		return answer(0.001)(ctx, req)
	})
	var firstErr error
	var first sync.WaitGroup
	first.Go(func() {
		_, firstErr = h.service.Evaluate(context.Background(), judgeRequest(tenant("acme"), "hi"))
	})
	require.Eventually(t, func() bool { return len(h.llm.Completions()) == 1 }, 5*time.Second, 10*time.Millisecond)

	started := time.Now()
	_, err := h.service.Evaluate(t.Context(), judgeRequest(tenant("acme"), "hi"))

	assert.GreaterOrEqual(t, time.Since(started), cfg.BusyWait())
	require.ErrorIs(t, err, contract.ErrBusy)
	var handled herr.E
	require.ErrorAs(t, err, &handled)
	assert.Equal(t, cfg.BusyWait().Milliseconds(), handled.Meta["retryAfterMs"])
	close(release)
	first.Wait()
	require.NoError(t, firstErr)
}

// @scenario "A provider failure after a model call is an entry error, not a server error"
func TestAProviderFailureAfterAModelCallIsAnEntryError(t *testing.T) {
	h := newHarness(t, testConfig(), 2)
	var calls int
	var mu sync.Mutex
	h.llm.ScriptComplete(func(ctx context.Context, req channels.CompletionRequest) (channels.CompletionResponse, error) {
		mu.Lock()
		calls++
		n := calls
		mu.Unlock()
		if n == 1 {
			return answer(0.002)(ctx, req)
		}
		return channels.CompletionResponse{}, errors.New("provider answered 503")
	})

	results, err := h.service.Evaluate(t.Context(), judgeRequest(tenant("acme"), "hi"))

	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, contract.StatusError, results[0].Status)
	require.NotNil(t, results[0].Cost)
	assert.Equal(t, "USD", results[0].Cost.Currency)
	assert.InDelta(t, 0.002, results[0].Cost.Amount, 1e-12)
}

// @scenario "The runtime finishes before the application gives up"
func TestTheRuntimeFinishesBeforeTheApplicationGivesUp(t *testing.T) {
	const applicationTimeout = 5 * time.Minute
	assert.Less(t, contract.DefaultConfig().Deadline(), applicationTimeout)

	cfg := testConfig()
	cfg.DeadlineSeconds = 1
	h := newHarness(t, cfg, 1)
	h.llm.ScriptComplete(func(ctx context.Context, _ channels.CompletionRequest) (channels.CompletionResponse, error) {
		<-ctx.Done()
		return channels.CompletionResponse{}, ctx.Err()
	})

	started := time.Now()
	results, err := h.service.Evaluate(t.Context(), judgeRequest(tenant("acme"), "hi"))

	require.NoError(t, err)
	assert.Equal(t, contract.StatusError, results[0].Status)
	assert.Equal(t, "DeadlineExceeded", results[0].ErrorType)
	assert.Less(t, time.Since(started), 3*time.Second)
}

// @scenario "LangWatch's own telemetry sees the call but not the content"
func TestOwnTelemetrySeesTheCallButNotTheContent(t *testing.T) {
	const marker = "CANARY-d41d8cd98f00"
	h := newHarness(t, testConfig(), 1)
	h.llm.ScriptComplete(func(_ context.Context, req channels.CompletionRequest) (channels.CompletionResponse, error) {
		content, _ := req.Messages[0].Content.(string)
		if strings.Contains(content, "fail-me") {
			return channels.CompletionResponse{}, errors.New("provider refused: " + marker)
		}
		cost := 0.0005
		return channels.CompletionResponse{
			Choices:      []channels.Choice{{Content: marker, FinishReason: "stop"}},
			Usage:        channels.Usage{PromptTokens: 12, CompletionTokens: 3},
			CostUSD:      &cost,
			RequestBody:  []byte(`{"messages":"` + marker + `"}`),
			ResponseBody: []byte(`{"content":"` + marker + `"}`),
		}, nil
	})
	contexts := json.RawMessage(`["` + marker + ` context"]`)

	_, err := h.service.Evaluate(t.Context(), contract.EvaluateRequest{
		Tenant:    tenant("acme"),
		Evaluator: judgeSlug,
		Settings:  json.RawMessage(judgeSettings),
		Entries: []contract.Entry{
			{Input: text(marker + " input"), Output: text(marker + " output"), Contexts: contexts},
			{Input: text("fail-me " + marker), Output: text(marker), Contexts: contexts},
		},
	})
	require.NoError(t, err)

	spans := h.spans.GetSpans()
	require.Len(t, spans, 1)
	attrs := map[string]string{}
	for _, kv := range spans[0].Attributes {
		assert.Contains(t, services.OpsSpanAttributes(), kv.Key)
		attrs[string(kv.Key)] = kv.Value.String()
	}
	assert.Equal(t, judgeSlug, attrs["langwatch.evaluator.type"])
	assert.Equal(t, "openai/gpt-4o-mini", attrs["gen_ai.request.model"])
	assert.Equal(t, "openai", attrs["gen_ai.provider.name"])
	assert.Equal(t, "12", attrs["gen_ai.usage.input_tokens"])
	assert.Equal(t, "3", attrs["gen_ai.usage.output_tokens"])
	assert.Equal(t, "0.0005", attrs["langwatch.evaluation.cost_usd"])
	assert.Equal(t, "error", attrs["langwatch.evaluation.status"])

	span := spans[0]
	seen := []string{span.Name, span.Status.Description}
	for _, value := range attrs {
		seen = append(seen, value)
	}
	for _, event := range span.Events {
		seen = append(seen, event.Name, fmt.Sprint(event.Attributes))
	}
	require.NotZero(t, h.logs.Len(), "the canary must have log lines to search")
	for _, entry := range h.logs.All() {
		seen = append(seen, entry.Message, fmt.Sprint(entry.ContextMap()))
	}
	assert.False(t, slices.ContainsFunc(seen, func(s string) bool { return strings.Contains(s, marker) }),
		"the marker reached LangWatch's own telemetry")

	ends := h.trace.CallEnds()
	require.NotEmpty(t, ends)
	assert.Contains(t, string(ends[0].ResponseBody), marker, "the tenant's own trace still receives the content")
}

// @scenario "A failed trace export does not fail the evaluation"
func TestAFailedTraceExportDoesNotFailTheEvaluation(t *testing.T) {
	h := newHarness(t, testConfig(), 1)
	h.llm.ScriptComplete(answer(0.001))
	h.trace.FailExports()

	results, err := h.service.Evaluate(t.Context(), judgeRequest(tenant("acme"), "hi"))

	require.NoError(t, err)
	require.Len(t, results, 1)
	assert.Equal(t, contract.StatusProcessed, results[0].Status)
}

func TestExactMatchRunsThroughTheService(t *testing.T) {
	h := newHarness(t, testConfig(), 1)

	results, err := h.service.Evaluate(t.Context(), contract.EvaluateRequest{
		Tenant:    contract.Tenant{ProjectID: "acme"},
		Evaluator: "langevals/exact_match",
		Entries: []contract.Entry{
			{Output: text("true"), ExpectedOutput: text("1")},
			{Output: text("hello"), ExpectedOutput: text("world")},
			{Output: text("hello")},
		},
	})

	require.NoError(t, err)
	require.Len(t, results, 3)
	require.NotNil(t, results[0].Passed)
	assert.True(t, *results[0].Passed)
	require.NotNil(t, results[1].Passed)
	assert.False(t, *results[1].Passed)
	assert.Equal(t, contract.StatusError, results[2].Status)
	assert.Equal(t, "ValidationError", results[2].ErrorType)
	assert.Nil(t, results[0].Cost)
	assert.Empty(t, h.llm.Completions())
}
