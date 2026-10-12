package scenario

import (
	"context"
	"slices"
	"strings"

	"github.com/langwatch/scenario/go/internal/jsjson"
	"github.com/langwatch/scenario/go/internal/spandigest"
)

// JudgeAgentConfig configures the judge.
type JudgeAgentConfig struct {
	// Name is reported to LangWatch; defaults to "JudgeAgent".
	Name string
	// ModelConfig selects the model; unset fields fall back to
	// Configure(WithDefaultModel(...)).
	ModelConfig
	// SystemPrompt replaces the built-in prompts; the phase rules are still
	// appended.
	SystemPrompt string
	// Criteria are what the conversation is judged against.
	Criteria []string
	// SpanCollector defaults to DefaultSpanCollector().
	SpanCollector *SpanCollector
	// TraceFetcher overrides the registered RemoteTraceFetcher.
	TraceFetcher RemoteTraceFetcher
	// TokenThreshold is the estimated digest size above which the judge gets
	// the structure-only trace view plus expand_trace/grep_trace. Default
	// 8192.
	TokenThreshold int
	// MaxDiscoverySteps bounds the tool-calling steps of trace discovery.
	// Default 10.
	MaxDiscoverySteps int
	// IncludeAudio passes audio to the judge model; nil auto-detects (audio
	// present and the model is known to accept it).
	IncludeAudio *bool
	// IncludeTimeline includes JudgeContextProvider context such as a voice
	// timeline; nil means when the conversation has audio.
	IncludeTimeline *bool
}

// JudgeAgent evaluates the conversation against criteria. It is two-phase,
// like the JS judge: mid-conversation it first decides whether enough
// information was collected (continue_test / make_verdict), and only then
// delivers per-criterion verdicts with finish_test. An explicit Judge step
// or the last turn goes straight to the verdict.
type JudgeAgent struct {
	cfg     JudgeAgentConfig
	invoker invoker
}

// NewJudgeAgent returns a judge.
func NewJudgeAgent(cfg JudgeAgentConfig) *JudgeAgent {
	if cfg.TokenThreshold <= 0 {
		cfg.TokenThreshold = spandigest.DefaultTokenThreshold
	}
	if cfg.MaxDiscoverySteps <= 0 {
		cfg.MaxDiscoverySteps = 10
	}
	cfg.Criteria = append([]string(nil), cfg.Criteria...)
	return &JudgeAgent{cfg: cfg, invoker: invoker{role: AgentRoleJudge}}
}

// Role implements AgentAdapter.
func (j *JudgeAgent) Role() AgentRole { return AgentRoleJudge }

// Name implements Named.
func (j *JudgeAgent) Name() string {
	if j.cfg.Name != "" {
		return j.cfg.Name
	}
	return "JudgeAgent"
}

// Criteria implements CriteriaProvider.
func (j *JudgeAgent) Criteria() []string { return j.cfg.Criteria }

// audioCapableModels are model substrings known to accept audio input.
var audioCapableModels = [...]string{"gpt-4o", "gemini-2.5", "gemini-2.0-flash"}

// ModelSupportsAudio reports whether the judge model is known to accept
// audio input.
func (j *JudgeAgent) ModelSupportsAudio(model string) bool {
	m := strings.ToLower(model)
	for _, s := range audioCapableModels {
		if strings.Contains(m, s) {
			return true
		}
	}
	return false
}

func conversationHasAudio(msgs []Message) bool {
	for _, m := range msgs {
		if m.HasAudio() {
			return true
		}
	}
	return false
}

func (j *JudgeAgent) includeAudio(hasAudio bool, model string) bool {
	if j.cfg.IncludeAudio != nil {
		return *j.cfg.IncludeAudio && hasAudio
	}
	return hasAudio && j.ModelSupportsAudio(model)
}

func (j *JudgeAgent) includeTimeline(hasAudio bool) bool {
	if j.cfg.IncludeTimeline != nil {
		return *j.cfg.IncludeTimeline
	}
	return hasAudio
}

func (j *JudgeAgent) collector() *SpanCollector {
	if j.cfg.SpanCollector != nil {
		return j.cfg.SpanCollector
	}
	return DefaultSpanCollector()
}

// clearThread drops what the judge's own collector and fetcher kept for a
// thread; the runner clears the default ones itself.
func (j *JudgeAgent) clearThread(threadID string) {
	if c := j.cfg.SpanCollector; c != nil {
		c.ClearThread(threadID)
	}
	if f := j.cfg.TraceFetcher; f != nil {
		f.ClearThread(threadID)
	}
}

// judgeCall carries what both phases of one judge call share.
type judgeCall struct {
	in         AgentInput
	criteria   []string
	transcript string
	extra      string // extension context, appended to the content
	traces     traceSettings
	model      ModelConfig
}

// Call implements AgentAdapter. It returns nil to continue the
// conversation, or a verdict.
func (j *JudgeAgent) Call(ctx context.Context, in AgentInput) (*AgentReturn, error) {
	criteria := j.cfg.Criteria
	if in.JudgmentRequest != nil && in.JudgmentRequest.Criteria != nil {
		criteria = in.JudgmentRequest.Criteria
	}
	maxTurns := in.ScenarioConfig.MaxTurns
	if maxTurns == 0 {
		maxTurns = DefaultMaxTurns
	}
	turn := 0
	if in.ScenarioState != nil {
		turn = in.ScenarioState.CurrentTurn()
	}
	isLast := turn >= maxTurns-1
	enforce := in.JudgmentRequest != nil
	if enforce && len(criteria) == 0 {
		return VerdictReturn(JudgeResult{
			Reasoning:     "JudgeAgent: No criteria was provided to be judged against",
			MetCriteria:   []string{},
			UnmetCriteria: []string{},
		}), nil
	}
	required := isLast || enforce
	// Below the minTurns floor the decision is predetermined; nothing is spent.
	if !required && turn < in.ScenarioConfig.MinTurns {
		return nil, nil
	}

	model, err := j.cfg.ModelConfig.merged(currentSettings().DefaultModel)
	if err != nil {
		return nil, err
	}
	msgs, hasAudio, err := j.prepareMessages(ctx, in, model.Model)
	if err != nil {
		return nil, err
	}
	call := judgeCall{
		in:         in,
		criteria:   criteria,
		transcript: buildJudgeTranscript(msgs),
		traces:     resolveTraceSettings(in.ScenarioConfig, j.cfg.TraceFetcher),
		model:      model,
	}
	if j.includeTimeline(hasAudio) {
		call.extra = j.extensionContext(ctx, in)
	}

	forced, exhausted := required, false
	var recap []Message
	if !required {
		outcome, err := j.decide(ctx, call)
		if err != nil {
			return nil, err
		}
		switch outcome.decision {
		case decisionContinue:
			return nil, nil
		case decisionFailed:
			return VerdictReturn(outcome.failure), nil
		case decisionExhausted:
			forced, exhausted, recap = true, true, outcome.recap
		}
	}
	return j.verdict(ctx, call, forced, exhausted, recap)
}

// prepareMessages runs the JudgeInputPreprocessor extensions when the
// conversation carries audio (for example speech-to-text).
func (j *JudgeAgent) prepareMessages(ctx context.Context, in AgentInput, model string) ([]Message, bool, error) {
	msgs := in.Messages
	hasAudio := conversationHasAudio(msgs)
	if !hasAudio || in.Executor == nil {
		return msgs, hasAudio, nil
	}
	opts := JudgeInputOptions{IncludeAudio: j.includeAudio(hasAudio, model)}
	// The executor hands the judge a view of the stored conversation;
	// extensions get a copy they may modify.
	msgs = slices.Clone(msgs)
	var err error
	for _, p := range in.Executor.hooks.judgeInput {
		if msgs, err = p.PreprocessJudgeInput(ctx, in.Executor, msgs, opts); err != nil {
			return nil, hasAudio, err
		}
	}
	return msgs, hasAudio, nil
}

func (j *JudgeAgent) extensionContext(ctx context.Context, in AgentInput) string {
	if in.Executor == nil {
		return ""
	}
	var b strings.Builder
	for _, p := range in.Executor.hooks.judgeContext {
		if s := p.JudgeContext(ctx, in.Executor); s != "" {
			b.WriteString("\n    ")
			b.WriteString(s)
		}
	}
	return b.String()
}

func (j *JudgeAgent) extensionTools(ctx context.Context, in AgentInput, phase JudgePhase) []JudgeTool {
	if in.Executor == nil {
		return nil
	}
	var out []JudgeTool
	for _, p := range in.Executor.hooks.judgeTools {
		out = append(out, p.JudgeTools(ctx, in.Executor, phase)...)
	}
	return out
}

type decision int

const (
	decisionContinue decision = iota
	decisionVerdict
	decisionExhausted
	decisionFailed
)

type decisionOutcome struct {
	decision decision
	recap    []Message
	failure  JudgeResult
}

// decide is phase 1: continue, or move to the verdict. It never fetches
// remote traces and never produces a verdict.
func (j *JudgeAgent) decide(ctx context.Context, c judgeCall) (decisionOutcome, error) {
	spans := withoutJudgeModelCalls(j.collector().SpansForThread(c.in.ThreadID))
	content, large := judgeContent(c.in.ScenarioState.spanDigests(), spans, j.cfg.TokenThreshold, c.transcript, c.extra)

	system := buildDecisionSystemPrompt(c.criteria, c.in.ScenarioConfig.Description, c.traces.fetch)
	if j.cfg.SystemPrompt != "" {
		system = j.cfg.SystemPrompt + "\n\n" + decisionPhaseRule
		if c.traces.fetch {
			system += "\n\n" + remoteTraceDecisionRule
		}
	}
	var tools []JudgeTool
	if large {
		tools = discoveryTools(spans)
	}
	tools = append(tools, j.extensionTools(ctx, c.in, JudgePhaseDecision)...)
	params := InferenceParams{
		Model:       c.model.Model,
		Temperature: c.model.Temperature,
		MaxTokens:   c.model.MaxTokens,
		Messages: []Message{
			SystemMsg(system),
			UserMsg(content),
		},
		Tools: append(toolDefinitions(tools),
			ToolDefinition{Name: "continue_test", Description: continueTestDescription, Parameters: emptyObjectSchema()},
			ToolDefinition{Name: "make_verdict", Description: makeVerdictDescription, Parameters: emptyObjectSchema()},
		),
		ToolChoice: &ToolChoice{Type: ToolChoiceRequired},
	}
	comp, err := j.loop(ctx, c.model.LLM, params, tools, j.steps(tools), "continue_test", "make_verdict")
	if err != nil {
		return decisionOutcome{}, err
	}
	switch {
	case comp.called("continue_test"):
		return decisionOutcome{decision: decisionContinue}, nil
	case comp.called("make_verdict"):
		return decisionOutcome{decision: decisionVerdict}, nil
	case len(tools) > 0:
		// Discovery ran out of steps: force the verdict, keeping what was
		// gathered (minus the system prompt and content it rebuilds).
		recap := collapseDiscoveryHistory(comp.history, tools)
		if len(recap) > 2 {
			recap = recap[2:]
		} else {
			recap = nil
		}
		return decisionOutcome{decision: decisionExhausted, recap: recap}, nil
	}
	return decisionOutcome{decision: decisionFailed, failure: JudgeResult{
		Reasoning:     "JudgeAgent: No decision tool call found in LLM output",
		MetCriteria:   []string{},
		UnmetCriteria: c.criteria,
	}}, nil
}

func (j *JudgeAgent) steps(tools []JudgeTool) int {
	if len(tools) == 0 {
		return 1
	}
	return j.cfg.MaxDiscoverySteps
}

// verdict is phase 2: settle-wait for remote traces when fetching, then a
// finish_test-pinned evaluation, with a one-shot wait_for_traces while the
// remote traces are incomplete.
func (j *JudgeAgent) verdict(ctx context.Context, c judgeCall, forced, exhausted bool, recap []Message) (*AgentReturn, error) {
	collector := j.collector()
	ts := c.traces
	var traceIDs []string
	if ts.fetch {
		traceIDs = messageTraceIDs(c.in.Messages)
	}
	target := TraceSettleTarget{
		ThreadID: c.in.ThreadID, TraceIDs: traceIDs, Collector: collector,
		LangWatch: c.in.ScenarioConfig.LangWatch, QuietPeriod: ts.quietPeriod,
	}
	allSettled := true
	switch {
	case ts.fetch && len(traceIDs) > 0:
		target.Timeout = ts.timeout
		allSettled = ts.fetcher.SettleWait(ctx, target)
	case ts.fetch:
		logger().Warn("Remote trace fetching is on but no message carries a trace id; nothing to fetch")
		ts.fetcher.RecordMissingTraceIDs(c.in.ThreadID, collector)
	}
	waitAvailable := ts.fetch && len(traceIDs) > 0 && !allSettled && ts.extension > 0
	waitedOnce := false

	for {
		evidenceExhausted := ts.fetch && len(traceIDs) > 0 && ts.fetcher.NoneSettled(c.in.ThreadID, traceIDs)
		terminal := forced || evidenceExhausted

		spans := withoutJudgeModelCalls(collector.SpansForThread(c.in.ThreadID))
		extra := ""
		if c.in.JudgmentRequest != nil {
			extra = additionalContextSection(c.in.JudgmentRequest.AdditionalContext)
		}
		content, large := judgeContent(c.in.ScenarioState.spanDigests(), spans, j.cfg.TokenThreshold, c.transcript, extra+c.extra)
		system := buildVerdictSystemPrompt(c.criteria, c.in.ScenarioConfig.Description, ts.fetch)
		if j.cfg.SystemPrompt != "" {
			system = j.cfg.SystemPrompt
			if ts.fetch {
				system += "\n\n" + remoteTraceJudgingRule
			}
		}
		msgs := []Message{SystemMsg(system), UserMsg(content)}
		if exhausted {
			msgs = append(msgs, recap...)
			msgs = append(msgs, UserMsg(discoveryExhaustedPrompt))
		}
		if waitedOnce {
			msgs = append(msgs, UserMsg(waitedOncePrompt))
		}

		var tools []JudgeTool
		if large && !exhausted {
			tools = discoveryTools(spans)
		}
		tools = append(tools, j.extensionTools(ctx, c.in, JudgePhaseVerdict)...)
		defs := toolDefinitions(tools)
		if waitAvailable {
			defs = append(defs, ToolDefinition{Name: "wait_for_traces", Description: waitForTracesDescription, Parameters: emptyObjectSchema()})
		}
		defs = append(defs, buildFinishTestTool(c.criteria))
		choice := RequireTool("finish_test")
		if waitAvailable || len(tools) > 0 {
			choice = &ToolChoice{Type: ToolChoiceRequired}
		}
		params := InferenceParams{
			Model: c.model.Model, Temperature: c.model.Temperature, MaxTokens: c.model.MaxTokens,
			Messages: msgs, Tools: defs, ToolChoice: choice,
		}
		terminals := []string{"finish_test"}
		if waitAvailable {
			terminals = append(terminals, "wait_for_traces")
		}
		comp, err := j.loop(ctx, c.model.LLM, params, tools, j.steps(tools), terminals...)
		if err != nil {
			return nil, err
		}
		if waitAvailable && comp.called("wait_for_traces") {
			waitAvailable, waitedOnce = false, true
			target.Timeout = ts.extension
			ts.fetcher.ExtendSettle(ctx, target)
			continue
		}
		forcedNow := false
		if len(tools) > 0 && !comp.called("finish_test") {
			if comp, err = j.forceVerdict(ctx, c.model.LLM, params, comp, tools); err != nil {
				return nil, err
			}
			forcedNow = true
		}
		return j.parseVerdict(comp, c.criteria, terminal || forcedNow), nil
	}
}

// forceVerdict makes one last finish_test-pinned call after discovery ran
// out of steps; discovery history is collapsed to text so the tools can be
// withdrawn.
func (j *JudgeAgent) forceVerdict(ctx context.Context, llm LLM, params InferenceParams, comp judgeCompletion, tools []JudgeTool) (judgeCompletion, error) {
	logger().Warn("judge discovery exhausted its steps, forcing the verdict")
	msgs := collapseDiscoveryHistory(comp.history, tools)
	msgs = append(msgs, UserMsg(discoveryExhaustedPrompt))
	var finish []ToolDefinition
	for _, d := range params.Tools {
		if d.Name == "finish_test" {
			finish = append(finish, d)
		}
	}
	params.Messages, params.Tools, params.ToolChoice = msgs, finish, RequireTool("finish_test")
	return j.loop(ctx, llm, params, nil, 1, "finish_test")
}

// parseVerdict reads the finish_test call. Without a forced judgment an
// inconclusive verdict continues the conversation (nil).
func (j *JudgeAgent) parseVerdict(comp judgeCompletion, criteria []string, forced bool) *AgentReturn {
	calls := comp.lastCalls()
	fail := func(reason string) *AgentReturn {
		return VerdictReturn(JudgeResult{Reasoning: reason, MetCriteria: []string{}, UnmetCriteria: criteria})
	}
	if len(calls) == 0 {
		return fail("JudgeAgent: No tool call found in LLM output")
	}
	call := calls[0]
	if tc, ok := toolCallNamed(Message{ToolCalls: calls}, "finish_test"); ok {
		call = tc
	}
	switch call.Name {
	case "finish_test":
	case "expand_trace", "grep_trace":
		logger().Warn("discovery tool leaked past the discovery loop without a verdict", "tool", call.Name)
		return fail("JudgeAgent: trace discovery did not converge on a verdict within the step budget")
	default:
		return fail("JudgeAgent: Unknown tool call: " + call.Name)
	}
	var answers any
	reasoning := ""
	if v, err := jsjson.Parse(call.Arguments); err == nil {
		if obj, ok := v.(jsjson.Object); ok {
			answers, _ = obj.Get("criteria")
			if r, ok := obj.Get("reasoning"); ok {
				reasoning, _ = r.(string)
			}
		}
	}
	verdicts := parseCriterionVerdicts(criteria, answers)
	if !forced && verdicts.verdict == "inconclusive" {
		return nil
	}
	if reasoning == "" {
		reasoning = "No reasoning provided"
	}
	return VerdictReturn(JudgeResult{
		Success:              verdicts.verdict == "success",
		Reasoning:            reasoning,
		MetCriteria:          verdicts.met,
		UnmetCriteria:        verdicts.unmet,
		InconclusiveCriteria: verdicts.inconclusive,
		Criteria:             verdicts.criteria,
	})
}

func toolDefinitions(tools []JudgeTool) []ToolDefinition {
	out := make([]ToolDefinition, 0, len(tools)+3)
	for _, t := range tools {
		out = append(out, t.Definition)
	}
	return out
}

// judgeCompletion is the outcome of a (possibly multi-step) tool loop.
type judgeCompletion struct {
	steps   [][]ToolCall
	history []Message
}

func (c judgeCompletion) called(name string) bool {
	for _, calls := range c.steps {
		for _, tc := range calls {
			if tc.Name == name {
				return true
			}
		}
	}
	return false
}

func (c judgeCompletion) lastCalls() []ToolCall {
	if len(c.steps) == 0 {
		return nil
	}
	return c.steps[len(c.steps)-1]
}

// loop calls the model until it calls a terminal tool, calls no executable
// tool, or maxSteps calls were made; executable tools run in between and
// their results are fed back.
func (j *JudgeAgent) loop(ctx context.Context, llm LLM, params InferenceParams, tools []JudgeTool, maxSteps int, terminal ...string) (judgeCompletion, error) {
	comp := judgeCompletion{history: params.Messages}
	for step := 0; step < maxSteps; step++ {
		params.Messages = comp.history
		res, err := j.invoker.invoke(ctx, llm, params)
		if err != nil {
			return comp, err
		}
		calls := res.Message.ToolCalls
		comp.steps = append(comp.steps, calls)
		stop := len(calls) == 0
		for _, tc := range calls {
			for _, t := range terminal {
				if tc.Name == t {
					stop = true
				}
			}
		}
		if stop {
			return comp, nil
		}
		results := make([]Message, 0, len(calls))
		for _, tc := range calls {
			tool, ok := findTool(tools, tc.Name)
			if !ok {
				return comp, nil
			}
			out, err := tool.Execute(ctx, tc.Arguments)
			if err != nil {
				out = "Error: " + err.Error()
			}
			results = append(results, Message{Role: RoleTool, ToolCallID: tc.ID, ToolName: tc.Name, Content: out, IsError: err != nil})
		}
		assistant := res.Message
		assistant.Role = RoleAssistant
		history := make([]Message, 0, len(comp.history)+1+len(results))
		history = append(history, comp.history...)
		history = append(history, assistant)
		comp.history = append(history, results...)
	}
	return comp, nil
}

func findTool(tools []JudgeTool, name string) (JudgeTool, bool) {
	for _, t := range tools {
		if t.Definition.Name == name {
			return t, true
		}
	}
	return JudgeTool{}, false
}

// collapseDiscoveryHistory rewrites each discovery cycle (assistant tool
// calls of executable tools plus their results) into one plain-text
// assistant message, so the tools can be withdrawn from the next call.
func collapseDiscoveryHistory(history []Message, tools []JudgeTool) []Message {
	out := make([]Message, 0, len(history))
	for i := 0; i < len(history); i++ {
		m := history[i]
		if m.Role != RoleAssistant || !hasExecutableCall(m, tools) {
			out = append(out, m)
			continue
		}
		results := map[string]string{}
		k := i + 1
		for ; k < len(history) && history[k].Role == RoleTool; k++ {
			results[history[k].ToolCallID] = history[k].Content
		}
		var parts []string
		if m.Content != "" {
			parts = append(parts, m.Content)
		}
		for _, tc := range m.ToolCalls {
			if _, ok := findTool(tools, tc.Name); !ok {
				continue
			}
			body, ok := results[tc.ID]
			if !ok {
				body = "(no result captured)"
			}
			parts = append(parts, "[Called "+tc.Name+" with "+string(appendToolInput(nil, tc.Arguments))+"]\n"+body)
		}
		out = append(out, AssistantMsg(strings.Join(parts, "\n\n")))
		i = k - 1
	}
	return out
}

func hasExecutableCall(m Message, tools []JudgeTool) bool {
	for _, tc := range m.ToolCalls {
		if _, ok := findTool(tools, tc.Name); ok {
			return true
		}
	}
	return false
}
