package scenario

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Scenarios of specs/remote-trace-fetching.feature in the scenario
// repository: late exporter batches, the wrapped-trace settle signal and the
// project's recommended wait settings.

const (
	rtThread = "thread-remote"
	rtTrace  = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1"
	// mayStillArrive is part of the note shown with an unconfirmed trace.
	mayStillArrive = "spans may still be arriving"
)

// toolSpanJSON is a trace API tool span without a parent.
func toolSpanJSON(spanID, name string) map[string]any {
	return map[string]any{
		"span_id":    spanID,
		"trace_id":   rtTrace,
		"type":       "tool",
		"name":       name,
		"timestamps": map[string]any{"started_at": 1_700_000_000_000, "finished_at": 1_700_000_000_500},
	}
}

// wrappedTraceJSON is an agent request span wrapping a tool span: the
// wrapper exports last, so its presence proves the trace complete.
func wrappedTraceJSON(rootID string) []any {
	root := toolSpanJSON(rootID, "agent.handle_request")
	root["type"] = "span"
	child := toolSpanJSON(rootID[:len(rootID)-1]+"f", "get_weather")
	child["parent_id"] = rootID
	return []any{root, child}
}

// traceAPI is a fake LangWatch: spans answers /api/trace/{id}, settings the
// settle-settings route (nil: 404).
type traceAPI struct {
	srv      *httptest.Server
	mu       sync.Mutex
	paths    []string
	headers  []http.Header
	spans    func() []any
	settings map[string]any
}

func newTraceAPI(t *testing.T, spans func() []any) *traceAPI {
	t.Helper()
	a := &traceAPI{spans: spans}
	a.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a.mu.Lock()
		a.paths = append(a.paths, r.URL.Path)
		a.headers = append(a.headers, r.Header.Clone())
		settings := a.settings
		a.mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/api/traces/settle-settings") {
			if settings == nil {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_ = json.NewEncoder(w).Encode(settings)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"trace_id": rtTrace, "spans": a.spans()})
	}))
	t.Cleanup(a.srv.Close)
	return a
}

func (a *traceAPI) requested(suffix string) int {
	a.mu.Lock()
	defer a.mu.Unlock()
	n := 0
	for _, p := range a.paths {
		if strings.HasSuffix(p, suffix) {
			n++
		}
	}
	return n
}

func (a *traceAPI) langwatch() LangWatchConfig {
	return LangWatchConfig{Endpoint: a.srv.URL, APIKey: "key-123", ProjectID: "project-1"}
}

// fakeClock advances only when the settle loop sleeps.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Sleep(_ context.Context, d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
}

// settleWithLateBatch settle-waits on a trace whose second span lands 5.5s
// after the first, one exporter batch behind, and returns the span names.
func settleWithLateBatch(t *testing.T, quiet time.Duration) []string {
	t.Helper()
	clock := &fakeClock{now: time.Unix(1_800_000_000, 0)}
	started := clock.Now()
	api := newTraceAPI(t, func() []any {
		first := toolSpanJSON("d000000000000001", "get_weather")
		if clock.Now().Sub(started) >= 5500*time.Millisecond {
			return []any{first, toolSpanJSON("d000000000000002", "tools.second_batch")}
		}
		return []any{first}
	})
	f := NewRemoteTraceFetcher(RemoteTraceFetcherOptions{})
	f.now, f.sleep = clock.Now, clock.Sleep
	c := NewSpanCollector()
	f.SettleWait(context.Background(), TraceSettleTarget{
		ThreadID: rtThread, TraceIDs: []string{rtTrace}, Collector: c,
		LangWatch: api.langwatch(), Timeout: 30 * time.Second, QuietPeriod: quiet,
	})
	var names []string
	for _, s := range c.SpansForThread(rtThread) {
		names = append(names, s.Name())
	}
	return names
}

func TestSettleDefaultQuietPeriodReachesLateBatch(t *testing.T) {
	if DefaultTraceQuietPeriod != 7*time.Second {
		t.Errorf("default quiet period %v", DefaultTraceQuietPeriod)
	}
	if names := settleWithLateBatch(t, DefaultTraceQuietPeriod); !slices.Contains(names, "tools.second_batch") {
		t.Errorf("late span missing: %v", names)
	}
}

func TestSettleTwoSecondQuietPeriodMissesLateBatch(t *testing.T) {
	if names := settleWithLateBatch(t, 2*time.Second); slices.Contains(names, "tools.second_batch") {
		t.Errorf("late span unexpectedly present: %v", names)
	}
}

// --- judge -----------------------------------------------------------------

// scriptedLLM answers with answer and records every request.
type scriptedLLM struct {
	mu       sync.Mutex
	requests []InferenceParams
	answer   func(n int, p InferenceParams) *InferenceResult
}

func (l *scriptedLLM) Inference(_ context.Context, p InferenceParams) (*InferenceResult, error) {
	l.mu.Lock()
	l.requests = append(l.requests, p)
	n := len(l.requests)
	l.mu.Unlock()
	return l.answer(n, p), nil
}

func (l *scriptedLLM) calls() []InferenceParams {
	l.mu.Lock()
	defer l.mu.Unlock()
	return slices.Clone(l.requests)
}

func toolCallAnswer(name, args string) *InferenceResult {
	return &InferenceResult{Message: Message{Role: RoleAssistant, ToolCalls: []ToolCall{{ID: "call_" + name, Name: name, Arguments: args}}}}
}

var judgeCriteria = []string{"The agent wrote the order"}

func finishAnswer() *InferenceResult {
	names := criteriaParamNames(judgeCriteria)
	answers := map[string]any{}
	for i, n := range names {
		answers[n] = map[string]any{"requirement": "req " + strconv.Itoa(i), "reasoning": "why", "status": "passed"}
	}
	b, _ := json.Marshal(map[string]any{"criteria": answers, "reasoning": "summary"})
	return toolCallAnswer("finish_test", string(b))
}

func offers(p InferenceParams, name string) bool {
	return slices.ContainsFunc(p.Tools, func(d ToolDefinition) bool { return d.Name == name })
}

func userContent(p InferenceParams) string {
	for i := range p.Messages {
		if p.Messages[i].Role == RoleUser {
			return p.Messages[i].Content
		}
	}
	return ""
}

// runVerdict asks the judge for a verdict on a conversation whose agent
// message carries rtTrace.
func runVerdict(t *testing.T, llm LLM, fetcher RemoteTraceFetcher, lw LangWatchConfig, cfg ScenarioConfig) {
	t.Helper()
	on := true
	cfg.Name, cfg.Description, cfg.FetchRemoteTraces, cfg.LangWatch = "remote traces", "the agent writes the order", &on, lw
	j := NewJudgeAgent(JudgeAgentConfig{
		ModelConfig: ModelConfig{LLM: llm, Model: "judge-model"}, Criteria: judgeCriteria,
		SpanCollector: NewSpanCollector(), TraceFetcher: fetcher,
	})
	_, err := j.Call(context.Background(), AgentInput{
		ThreadID: rtThread,
		Messages: []Message{
			{Role: RoleUser, Content: "write the order"},
			{Role: RoleAssistant, Content: "I wrote it", TraceID: rtTrace},
		},
		JudgmentRequest: &JudgmentRequest{},
		ScenarioConfig:  cfg,
	})
	if err != nil {
		t.Fatal(err)
	}
}

func quick() ScenarioConfig {
	zero := time.Duration(0)
	return ScenarioConfig{TraceWaitTimeout: 2 * time.Second, TraceWaitExtension: 5 * time.Second, TraceQuietPeriod: &zero}
}

func pollingFetcher() *LangWatchTraceFetcher {
	return NewRemoteTraceFetcher(RemoteTraceFetcherOptions{PollInterval: time.Millisecond})
}

func TestJudgeFlatTraceMayStillBeArriving(t *testing.T) {
	api := newTraceAPI(t, func() []any {
		return []any{toolSpanJSON("e000000000000001", "get_weather"), toolSpanJSON("e000000000000002", "save_order")}
	})
	llm := &scriptedLLM{answer: func(int, InferenceParams) *InferenceResult { return finishAnswer() }}
	runVerdict(t, llm, pollingFetcher(), api.langwatch(), quick())
	first := llm.calls()[0]
	if !offers(first, "wait_for_traces") || !offers(first, "finish_test") {
		t.Errorf("tools offered: %v", first.Tools)
	}
	if !strings.Contains(userContent(first), "<trace_status>\n    "+unconfirmedTraceNote+"\n    </trace_status>") {
		t.Errorf("unconfirmed note missing: %q", userContent(first))
	}
}

func TestJudgeWrappedTraceIsComplete(t *testing.T) {
	api := newTraceAPI(t, func() []any { return wrappedTraceJSON("e000000000000001") })
	llm := &scriptedLLM{answer: func(int, InferenceParams) *InferenceResult { return finishAnswer() }}
	runVerdict(t, llm, pollingFetcher(), api.langwatch(), quick())
	first := llm.calls()[0]
	if offers(first, "wait_for_traces") {
		t.Error("wait_for_traces offered for a wrapped trace")
	}
	if c := first.ToolChoice; c == nil || c.Type != ToolChoiceTool || c.ToolName != "finish_test" {
		t.Errorf("tool choice %+v", c)
	}
	if strings.Contains(userContent(first), mayStillArrive) {
		t.Error("unconfirmed note shown for a wrapped trace")
	}
}

func TestJudgeExtraWaitRereadsFlatTrace(t *testing.T) {
	var late atomic.Bool
	api := newTraceAPI(t, func() []any {
		first := toolSpanJSON("e000000000000001", "get_weather")
		if late.Load() {
			return []any{first, toolSpanJSON("e000000000000002", "tools.after_settle")}
		}
		return []any{first}
	})
	llm := &scriptedLLM{answer: func(n int, _ InferenceParams) *InferenceResult {
		if n == 1 {
			late.Store(true)
			return toolCallAnswer("wait_for_traces", "{}")
		}
		return finishAnswer()
	}}
	runVerdict(t, llm, pollingFetcher(), api.langwatch(), quick())
	calls := llm.calls()
	if len(calls) != 2 {
		t.Fatalf("calls %d", len(calls))
	}
	if strings.Contains(userContent(calls[0]), "tools.after_settle") {
		t.Error("late span present before the wait")
	}
	if !strings.Contains(userContent(calls[1]), "tools.after_settle") {
		t.Error("late span missing after the wait")
	}
}

// --- recommended settings --------------------------------------------------

// budgetFetcher records the budgets the judge settle-waits with, reporting
// every trace settled but unconfirmed so the extra wait is offered.
type budgetFetcher struct {
	*LangWatchTraceFetcher
	budgets    [][2]time.Duration
	extensions []time.Duration
}

func (f *budgetFetcher) SettleWait(_ context.Context, t TraceSettleTarget) SettleOutcome {
	f.budgets = append(f.budgets, [2]time.Duration{t.Timeout, t.QuietPeriod})
	return SettleOutcome{AllSettled: true, Unconfirmed: true}
}

func (f *budgetFetcher) ExtendSettle(_ context.Context, t TraceSettleTarget) SettleOutcome {
	f.extensions = append(f.extensions, t.Timeout)
	return SettleOutcome{AllSettled: true}
}

func (f *budgetFetcher) NoneSettled(string, []string) bool { return false }

func settingsRun(t *testing.T, settings map[string]any, cfg ScenarioConfig) (*traceAPI, *budgetFetcher) {
	t.Helper()
	api := newTraceAPI(t, func() []any { return nil })
	api.settings = settings
	f := &budgetFetcher{LangWatchTraceFetcher: pollingFetcher()}
	llm := &scriptedLLM{answer: func(n int, _ InferenceParams) *InferenceResult {
		if n == 1 {
			return toolCallAnswer("wait_for_traces", "{}")
		}
		return finishAnswer()
	}}
	runVerdict(t, llm, f, api.langwatch(), cfg)
	return api, f
}

var recommended = map[string]any{"waitTimeoutMs": 12_000, "waitExtensionMs": 20_000, "quietPeriodMs": 9_000}

func TestJudgeUsesProjectRecommendation(t *testing.T) {
	api, f := settingsRun(t, recommended, ScenarioConfig{})
	if !slices.Equal(f.budgets, [][2]time.Duration{{12 * time.Second, 9 * time.Second}}) {
		t.Errorf("budgets %v", f.budgets)
	}
	if !slices.Equal(f.extensions, []time.Duration{20 * time.Second}) {
		t.Errorf("extensions %v", f.extensions)
	}
	api.mu.Lock()
	h := api.headers[0]
	api.mu.Unlock()
	if h.Get("X-Auth-Token") != "key-123" || h.Get("Authorization") != "Bearer key-123" || h.Get("X-Project-Id") != "project-1" {
		t.Errorf("settings request headers %v", h)
	}
	// Asked once per endpoint, key and project.
	f.RecommendedTraceSettings(context.Background(), api.langwatch())
	if n := api.requested("/settle-settings"); n != 1 {
		t.Errorf("settings requested %d times", n)
	}
}

func TestJudgeFallsBackWithoutRecommendation(t *testing.T) {
	_, f := settingsRun(t, nil, ScenarioConfig{})
	if !slices.Equal(f.budgets, [][2]time.Duration{{30 * time.Second, 7 * time.Second}}) {
		t.Errorf("budgets %v", f.budgets)
	}
	if !slices.Equal(f.extensions, []time.Duration{30 * time.Second}) {
		t.Errorf("extensions %v", f.extensions)
	}
}

func TestJudgeRunSettingsWinOverRecommendation(t *testing.T) {
	quiet := 1500 * time.Millisecond
	api, f := settingsRun(t, recommended, ScenarioConfig{TraceWaitTimeout: 4 * time.Second, TraceQuietPeriod: &quiet})
	if !slices.Equal(f.budgets, [][2]time.Duration{{4 * time.Second, quiet}}) {
		t.Errorf("budgets %v", f.budgets)
	}
	if n := api.requested("/settle-settings"); n != 0 {
		t.Errorf("settings requested %d times", n)
	}
}

func TestExpandTraceToolTakesOffset(t *testing.T) {
	tools := discoveryTools(nil)
	props := tools[0].Definition.Parameters["properties"].(map[string]any)
	if _, ok := props["offset"]; !ok {
		t.Errorf("expand_trace schema lacks offset: %v", props)
	}
}
