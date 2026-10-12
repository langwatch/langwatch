package scenariorunner

import (
	"context"
	"time"

	"github.com/langwatch/langwatch/pkg/ksuid"
	"github.com/langwatch/langwatch/services/scenariorunner/targets"
)

// agentTestTimeoutMessage is the answer when the call deadline passes first.
const agentTestTimeoutMessage = "The agent did not answer before the call deadline."

// RunAgentTestTurn calls the target once with the user's message, inside the
// platform's call deadline (agent-test-turn.service.ts).
func RunAgentTestTurn(ctx context.Context, job *AgentTestTurnJob, rt Runtime) (AgentTestAnswer, error) {
	nlpServiceURL := ""
	if job.ExecuteSyncRoute.Mode == "direct" {
		nlpServiceURL = job.ExecuteSyncRoute.NLPServiceURL
	}
	route := job.ExecuteSyncRoute
	target, err := targets.Build(targets.BuildInput{
		Data:              job.AdapterData,
		NLPServiceURL:     nlpServiceURL,
		NLPInternalSecret: rt.NLPInternalSecret,
		ProjectAPIKey:     rt.APIKey,
		Route:             &route,
		Parameters:        paramsOf(job.Parameters),
		HTTP:              rt.HTTP,
		Timeouts:          job.NLPTimeouts,
		Logger:            rt.Logger,
	})
	if err != nil {
		return AgentTestAnswer{}, err
	}
	turn := targets.Turn{
		ThreadID: ksuid.Generate(ctx, "scenario").String(),
		Messages: []targets.Message{{Role: "user", Content: job.Message}},
	}
	turn.NewMessages = turn.Messages
	return callWithinDeadline(ctx, deadlineCall{target: target, turn: turn, timeoutMs: job.TimeoutMs})
}

// deadlineCall is one turn and the deadline it answers inside.
type deadlineCall struct {
	target    targets.Agent
	turn      targets.Turn
	timeoutMs float64
}

type callResult struct {
	reply string
	err   error
}

func callWithinDeadline(ctx context.Context, call deadlineCall) (AgentTestAnswer, error) {
	started := time.Now()
	callCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	done := make(chan callResult, 1)
	go func() {
		reply, err := call.target.Call(callCtx, call.turn)
		done <- callResult{reply: reply, err: err}
	}()
	timer := time.NewTimer(time.Duration(call.timeoutMs) * time.Millisecond)
	defer timer.Stop()
	select {
	case r := <-done:
		if r.err != nil {
			return AgentTestAnswer{}, r.err
		}
		return AgentTestAnswer{Success: true, Output: r.reply, DurationMs: time.Since(started).Milliseconds()}, nil
	case <-timer.C:
		return AgentTestAnswer{Success: false, Error: agentTestTimeoutMessage, TimeoutMs: call.timeoutMs}, nil
	}
}
