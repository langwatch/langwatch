package scenario

import (
	"context"
	"strconv"
	"time"

	"github.com/langwatch/scenario/go/internal/jsjson"
)

// setResult records r as the run result, filling the run id, messages and
// timings.
func (ex *Executor) setResult(r ScenarioResult) *ScenarioResult {
	r.RunID = ex.runID
	r.Messages = ex.state.Messages()
	r.TotalTime = time.Since(ex.start)
	ex.mu.Lock()
	defer ex.mu.Unlock()
	var agentTime time.Duration
	for i, a := range ex.cfg.Agents {
		if a.Role() == AgentRoleAgent {
			agentTime += ex.agentTimes[i]
		}
	}
	r.AgentTime = agentTime
	ex.result = &r
	ex.merged = false
	return ex.result
}

// Succeed ends the scenario as successful.
func (ex *Executor) Succeed(_ context.Context, reasoning string) *ScenarioResult {
	if reasoning == "" {
		reasoning = "Scenario marked as successful with Scenario.succeed()"
	}
	return ex.setResult(ScenarioResult{Success: true, Reasoning: reasoning, MetCriteria: []string{}, UnmetCriteria: []string{}})
}

// Fail ends the scenario as failed.
func (ex *Executor) Fail(_ context.Context, reasoning string) *ScenarioResult {
	if reasoning == "" {
		reasoning = "Scenario marked as failed with Scenario.fail()"
	}
	return ex.setResult(ScenarioResult{Success: false, Reasoning: reasoning, MetCriteria: []string{}, UnmetCriteria: []string{}})
}

// reachedMaxTurns fails the run, listing the judge's criteria as unmet. An
// empty reasoning means the turn cap was hit (ReachedMaxTurns); a script
// that ends without a verdict passes its own reasoning.
func (ex *Executor) reachedMaxTurns(reasoning string) *ScenarioResult {
	atCap := reasoning == ""
	if reasoning == "" {
		reasoning = "Reached maximum turns (" + strconv.Itoa(ex.cfg.MaxTurns) + ") without conclusion"
	}
	unmet := []string{}
	for _, a := range ex.cfg.Agents {
		if j, ok := a.(CriteriaProvider); ok && a.Role() == AgentRoleJudge {
			unmet = append(unmet, j.Criteria()...)
			break
		}
	}
	return ex.setResult(ScenarioResult{Success: false, Reasoning: reasoning, MetCriteria: []string{}, UnmetCriteria: unmet, ReachedMaxTurns: atCap})
}

func (ex *Executor) compiledCheckpointsLocked() checkpoint {
	var cp checkpoint
	cp.met, cp.unmet = []string{}, []string{}
	for _, c := range ex.checkpoints {
		cp.met = append(cp.met, c.met...)
		cp.unmet = append(cp.unmet, c.unmet...)
		cp.inconclusive = append(cp.inconclusive, c.inconclusive...)
		cp.criteria = append(cp.criteria, c.criteria...)
	}
	return cp
}

// finish concludes a run that reached a verdict: evaluators, finalizers,
// then RUN_FINISHED.
func (ex *Executor) finish(ctx context.Context, r *ScenarioResult) *ScenarioResult {
	if len(ex.cfg.Evaluators) > 0 {
		ex.runEvaluators(ctx, r)
	}
	ex.finalize(ctx, r)
	status := RunStatusFailed
	if r.Success {
		status = RunStatusSuccess
	}
	ex.emitFinished(status, r)
	return r
}

func (ex *Executor) runEvaluators(ctx context.Context, r *ScenarioResult) {
	runner := ex.cfg.EvaluatorRunner
	if runner == nil {
		runner = currentSettings().EvaluatorRunner
	}
	if runner == nil {
		logger().Warn("the scenario declares evaluators but no evaluator runner is registered; the verdict stands")
		return
	}
	if err := runner.RunEvaluators(ctx, ex, ex.cfg.Evaluators, r); err != nil {
		logger().Warn("evaluators did not run, the verdict stands", "error", err.Error())
	}
}

// finalize runs the result finalizers, once per run; their errors are
// logged.
func (ex *Executor) finalize(ctx context.Context, r *ScenarioResult) {
	ex.mu.Lock()
	done := ex.finalized
	ex.finalized = true
	ex.mu.Unlock()
	if done {
		return
	}
	ctx, cancel := cleanupContext(ctx)
	defer cancel()
	for _, f := range ex.hooks.finalizers {
		if err := f.FinalizeResult(ctx, ex, r); err != nil {
			logger().Warn("result finalizer failed", "error", err.Error())
		}
	}
}

// cleanupTimeout bounds the finalizers and RunStopper hooks of a cancelled
// run.
const cleanupTimeout = 30 * time.Second

// cleanupContext is the context of the end-of-run hooks: ctx itself, or,
// once the run was cancelled, a context detached from the cancellation
// with a bounded budget, so the hooks can still disconnect sessions, hang
// up calls and save recordings.
func cleanupContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if ctx.Err() == nil {
		return ctx, func() {}
	}
	return context.WithTimeout(context.WithoutCancel(ctx), cleanupTimeout)
}

// isFinished reports whether RUN_FINISHED was emitted.
func (ex *Executor) isFinished() bool {
	ex.mu.Lock()
	defer ex.mu.Unlock()
	return ex.finished
}

func (ex *Executor) emitFinished(status RunStatus, r *ScenarioResult) {
	ex.mu.Lock()
	if ex.finished {
		ex.mu.Unlock()
		return
	}
	ex.finished = true
	ex.mu.Unlock()
	ex.emitter.runFinished(status, r)
}

// finishWithError reports an error run: the result carries the error info
// JSON the JS SDK sends.
func (ex *Executor) finishWithError(ctx context.Context, err error) (*ScenarioResult, error) {
	_ = ex.awaitPendingTurn()
	info := jsjson.Object{{Key: "name", Value: "Error"}, {Key: "message", Value: err.Error()}}
	r := ex.setResult(ScenarioResult{
		Success:       false,
		Reasoning:     "Scenario failed with error: " + err.Error(),
		MetCriteria:   []string{},
		UnmetCriteria: []string{},
		Error:         jsjson.Stringify(info),
	})
	ex.finalize(ctx, r)
	ex.emitFinished(RunStatusError, r)
	return r, err
}

// finishWithAssertion reports a failed check of a custom step.
func (ex *Executor) finishWithAssertion(ctx context.Context, a *AssertionError) (*ScenarioResult, error) {
	ex.mu.Lock()
	cp := ex.compiledCheckpointsLocked()
	ex.mu.Unlock()
	r := ex.setResult(ScenarioResult{
		Success:       false,
		Reasoning:     "Scenario failed with error: " + a.Message,
		MetCriteria:   cp.met,
		UnmetCriteria: append(cp.unmet, a.Message),
		Criteria:      cp.criteria,
	})
	ex.finalize(ctx, r)
	ex.emitFinished(RunStatusError, r)
	return r, a
}

// verdictResult converts a judge verdict to a scenario result.
func verdictResult(v *JudgeResult) ScenarioResult {
	return ScenarioResult{
		Success:              v.Success,
		Reasoning:            v.Reasoning,
		MetCriteria:          nonNil(v.MetCriteria),
		UnmetCriteria:        nonNil(v.UnmetCriteria),
		InconclusiveCriteria: v.InconclusiveCriteria,
		Criteria:             v.Criteria,
	}
}
