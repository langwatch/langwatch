package scenario

import (
	"context"
	"errors"
	"sync"
	"time"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// Executor runs one scenario: it executes the script, orchestrates the
// agents turn by turn, records the conversation and reports events. Script
// steps and extensions drive it through its exported methods.
//
// Turns follow the JS SDK: within a turn the user simulator, the agent under
// test and the judge act in that order; every message an agent produces is
// broadcast to the other agents' pending queues, which they receive as
// AgentInput.NewMessages on their next call.
type Executor struct {
	cfg     ScenarioConfig
	state   *ExecutionState
	hooks   hooks
	emitter *eventEmitter
	tracer  *langwatch.LangWatchTracer
	runID   string
	batchID string
	start   time.Time

	values sync.Map

	mu              sync.Mutex
	pendingRoles    []AgentRole
	pendingAgents   []bool
	pendingMessages [][]Message
	agentTimes      []time.Duration
	result          *ScenarioResult
	checkpoints     []checkpoint
	// merged is set when the result already holds the checkpoint criteria.
	merged      bool
	pendingTurn *TurnHandle
	runCtx      context.Context
	turnSpan    trace.Span
	finished    bool
}

// checkpoint is the outcome of an inline-criteria judge step.
type checkpoint struct {
	met, unmet, inconclusive []string
	criteria                 []CriterionResult
}

func newExecutor(cfg ScenarioConfig, runID, batchID string, publish func(Event), granular bool) *Executor {
	n := len(cfg.Agents)
	ex := &Executor{
		cfg:             cfg,
		state:           newExecutionState(cfg),
		hooks:           collectHooks(cfg),
		tracer:          langwatch.Tracer(TracerName, trace.WithInstrumentationVersion(Version)),
		runID:           runID,
		batchID:         batchID,
		pendingAgents:   make([]bool, n),
		pendingMessages: make([][]Message, n),
		agentTimes:      make([]time.Duration, n),
		pendingRoles:    make([]AgentRole, 0, len(turnRoleOrder)),
	}
	ex.emitter = &eventEmitter{
		base: eventBase{
			batchRunID: batchID, scenarioID: cfg.ID, scenarioRunID: runID, scenarioSetID: cfg.SetID,
		},
		granular: granular,
		publish:  publish,
		state:    ex.state,
	}
	collector := DefaultSpanCollector()
	ex.state.setSpanProvider(func() []sdktrace.ReadOnlySpan { return collector.SpansForThread(cfg.ThreadID) })
	ex.state.setOnRollback(ex.onRollback)
	return ex
}

// State returns the live execution state.
func (ex *Executor) State() *ExecutionState { return ex.state }

// Config returns the scenario configuration with defaults applied.
func (ex *Executor) Config() ScenarioConfig { return ex.cfg }

// Agents returns the agents of the scenario.
func (ex *Executor) Agents() []AgentAdapter { return ex.cfg.Agents }

// Extensions returns the extensions active in the run.
func (ex *Executor) Extensions() []Extension { return ex.hooks.all }

// RunID returns the id of this run ("scenariorun_…").
func (ex *Executor) RunID() string { return ex.runID }

// BatchRunID returns the batch the run reports under.
func (ex *Executor) BatchRunID() string { return ex.batchID }

// ThreadID returns the conversation thread id.
func (ex *Executor) ThreadID() string { return ex.cfg.ThreadID }

// Messages returns a copy of the conversation.
func (ex *Executor) Messages() []Message { return ex.state.Messages() }

// Value returns a per-run value: one set with SetValue, else the entry of
// ScenarioConfig.Values (or RunOptions.Values).
func (ex *Executor) Value(key any) any {
	if v, ok := ex.values.Load(key); ok {
		return v
	}
	return ex.cfg.Values[key]
}

// SetValue stores a per-run value.
func (ex *Executor) SetValue(key, value any) { ex.values.Store(key, value) }

// Result returns the result set so far, or nil.
func (ex *Executor) Result() *ScenarioResult {
	ex.mu.Lock()
	defer ex.mu.Unlock()
	return ex.result
}

// TurnContext returns ctx carrying the current turn span, for extensions
// that start spans of their own.
func (ex *Executor) TurnContext(ctx context.Context) context.Context {
	ex.mu.Lock()
	span := ex.turnSpan
	ex.mu.Unlock()
	if span == nil {
		return ctx
	}
	return trace.ContextWithSpan(ctx, span)
}

// AssertionError is a failed check in a custom script step. Returning it (or
// an error wrapping it) from a step ends the run as failed with the message
// among the unmet criteria, instead of as a crash.
type AssertionError struct{ Message string }

func (e *AssertionError) Error() string { return e.Message }

// Assert returns an *AssertionError with msg when cond is false.
func Assert(cond bool, msg string) error {
	if cond {
		return nil
	}
	return &AssertionError{Message: msg}
}

// execute runs the scenario to its end and returns the result. The error is
// non-nil when the run ended in an error or a failed assertion; the result
// is then the error result.
func (ex *Executor) execute(ctx context.Context) (res *ScenarioResult, err error) {
	ex.start = time.Now()
	runCtx, runSpan := ex.tracer.Start(ctx, "Scenario Run", trace.WithAttributes(
		attribute.String("langwatch.origin", "simulation"),
		sdkAttributes[0], sdkAttributes[1],
		attribute.String("scenario.run_id", ex.runID),
		attribute.String("scenario.name", ex.cfg.Name),
		attribute.String("scenario.id", ex.cfg.ID),
		attribute.String(threadIDKey, ex.cfg.ThreadID),
	))
	ex.mu.Lock()
	ex.runCtx = runCtx
	ex.mu.Unlock()
	// The first newTurn creates the turn-1 span and moves the counter to 1;
	// it is reset to 0 so the judge sees turn 0 on the first turn, as in JS.
	ex.newTurn()
	ex.state.setTurn(0)
	ex.emitter.runStarted(ex.cfg, ex.runAgents())

	defer func() {
		ex.endTurnSpan()
		ex.stopExtensions(runCtx)
		if err != nil {
			runSpan.SetStatus(codes.Error, err.Error())
		}
		runSpan.End()
	}()

	if err := ex.startExtensions(runCtx); err != nil {
		return ex.finishWithError(runCtx, err)
	}

	var assertion *AssertionError
	for _, step := range ex.cfg.Script {
		if err := ctx.Err(); err != nil {
			return ex.finishWithError(runCtx, err)
		}
		if err := step.Run(runCtx, ex); err != nil {
			if errors.As(err, &assertion) {
				break
			}
			return ex.finishWithError(runCtx, err)
		}
		if r := ex.Result(); r != nil {
			if err := ex.awaitPendingTurn(); err != nil {
				return ex.finishWithError(runCtx, err)
			}
			ex.mu.Lock()
			if !ex.merged {
				cp := ex.compiledCheckpointsLocked()
				r.MetCriteria = concat(cp.met, r.MetCriteria)
			}
			ex.mu.Unlock()
			return ex.finish(runCtx, r), nil
		}
	}
	if err := ex.awaitPendingTurn(); err != nil {
		return ex.finishWithError(runCtx, err)
	}
	if assertion != nil {
		return ex.finishWithAssertion(runCtx, assertion)
	}

	ex.mu.Lock()
	hasCheckpoints := len(ex.checkpoints) > 0
	cp := ex.compiledCheckpointsLocked()
	ex.mu.Unlock()
	if hasCheckpoints {
		r := ex.setResult(ScenarioResult{
			Success:              len(cp.unmet) == 0,
			Reasoning:            "All inline criteria checkpoints passed",
			MetCriteria:          cp.met,
			UnmetCriteria:        cp.unmet,
			InconclusiveCriteria: cp.inconclusive,
			Criteria:             cp.criteria,
		})
		return ex.finish(runCtx, r), nil
	}
	r := ex.reachedMaxTurns(scriptEndedReasoning)
	return ex.finish(runCtx, r), nil
}

const scriptEndedReasoning = "Reached end of script without conclusion, add one of the following:\n" +
	"- Add `Scenario.judge()` to the script to force criteria judgement\n" +
	"- Add `Scenario.succeed()` or `Scenario.fail()` to end the test with an explicit result\n" +
	"- If your script already has a judge but is hitting maxTurns, increase `maxTurns` in your config"

func (ex *Executor) runAgents() []runAgent {
	out := make([]runAgent, 0, len(ex.cfg.Agents))
	for _, a := range ex.cfg.Agents {
		if name := agentName(a); name != "" {
			out = append(out, runAgent{name: name, role: a.Role()})
		}
	}
	return out
}

func (ex *Executor) startExtensions(ctx context.Context) error {
	turnCtx := ex.TurnContext(ctx)
	for _, s := range ex.hooks.starters {
		if err := s.Start(turnCtx, ex); err != nil {
			return err
		}
	}
	return nil
}

func (ex *Executor) stopExtensions(ctx context.Context) {
	for _, s := range ex.hooks.stoppers {
		s.Stop(ctx, ex)
	}
}

func concat(a, b []string) []string {
	out := make([]string, 0, len(a)+len(b))
	out = append(out, a...)
	return append(out, b...)
}
