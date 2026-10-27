package redteam

import (
	"context"
	"strconv"

	scenario "github.com/langwatch/scenario/go"
)

// MarathonOption configures MarathonScript.
type MarathonOption func(*marathonOptions)

type marathonOptions struct {
	checks, finalChecks []scenario.ScriptStep
}

// WithChecks runs the steps after every attack turn.
func WithChecks(steps ...scenario.ScriptStep) MarathonOption {
	return func(o *marathonOptions) { o.checks = append(o.checks, steps...) }
}

// WithFinalChecks runs the steps after the last turn, before the judge, and
// before an early exit succeeds.
func WithFinalChecks(steps ...scenario.ScriptStep) MarathonOption {
	return func(o *marathonOptions) { o.finalChecks = append(o.finalChecks, steps...) }
}

// MarathonScript returns the attack script: TotalTurns user/agent turns,
// each followed by an early-exit check (unless DisableEarlyExit) and the
// per-turn checks, then the final checks and the judge.
//
// TotalTurns is a hard cap: backtracked turns count against it. The early
// exit succeeds the scenario once SuccessConfirmTurns consecutive turns
// scored at least SuccessScore, after running the final checks.
func (a *Agent) MarathonScript(opts ...MarathonOption) []scenario.ScriptStep {
	var o marathonOptions
	for _, opt := range opts {
		opt(&o)
	}
	perTurn := 2 + len(o.checks)
	if !a.cfg.DisableEarlyExit {
		perTurn++
	}
	steps := make([]scenario.ScriptStep, 0, a.cfg.TotalTurns*perTurn+len(o.finalChecks)+1)
	user, agent := scenario.User(), scenario.Agent()
	var earlyExit scenario.ScriptStep
	if !a.cfg.DisableEarlyExit {
		earlyExit = a.earlyExitStep(o.finalChecks)
	}
	for range a.cfg.TotalTurns {
		steps = append(steps, user, agent)
		if earlyExit != nil {
			steps = append(steps, earlyExit)
		}
		steps = append(steps, o.checks...)
	}
	steps = append(steps, o.finalChecks...)
	return append(steps, scenario.Judge())
}

func (a *Agent) earlyExitStep(finalChecks []scenario.ScriptStep) scenario.ScriptStep {
	return scenario.StepFunc(func(ctx context.Context, ex *scenario.Executor) error {
		if !a.CheckEarlyExit() {
			return nil
		}
		for _, fc := range finalChecks {
			if err := fc.Run(ctx, ex); err != nil {
				return err
			}
		}
		// The attack turn: the executor counts the first turn as 0.
		turn := ex.State().CurrentTurn() + 1
		ex.Succeed(ctx, "Early exit: objective achieved on turn "+strconv.Itoa(turn)+
			" (score >= "+formatScore(a.cfg.SuccessScore)+" for "+
			strconv.Itoa(a.cfg.SuccessConfirmTurns)+" consecutive turns)")
		return nil
	})
}

// CheckEarlyExit reports whether the last SuccessConfirmTurns scored turns
// all reached SuccessScore. Always false with DisableEarlyExit.
func (a *Agent) CheckEarlyExit() bool {
	if a.cfg.DisableEarlyExit {
		return false
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.turnScores) == 0 {
		return false
	}
	for t := a.maxScoredTurn; t > a.maxScoredTurn-a.cfg.SuccessConfirmTurns; t-- {
		s, ok := a.turnScores[t]
		if !ok || s.score < a.cfg.SuccessScore {
			return false
		}
	}
	return true
}
