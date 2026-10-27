package scenario

import (
	"context"
	"fmt"
)

// newTurn ends the current turn span, resets the role queue and starts the
// next turn with its span, a child of the run span.
func (ex *Executor) newTurn() {
	ex.mu.Lock()
	if ex.turnSpan != nil {
		ex.turnSpan.End()
	}
	ex.pendingRoles = append(ex.pendingRoles[:0], turnRoleOrder[:]...)
	for i := range ex.pendingAgents {
		ex.pendingAgents[i] = true
	}
	turn := ex.state.incrementTurn()
	_, span := ex.spans.start(ex.runCtx, "Scenario Turn", runSpanAttributes(ex.runID, ex.cfg, turn))
	ex.turnSpan = span
	ex.mu.Unlock()
}

func (ex *Executor) endTurnSpan() {
	ex.mu.Lock()
	if ex.turnSpan != nil {
		ex.turnSpan.End()
		ex.turnSpan = nil
	}
	ex.mu.Unlock()
}

// nextAgentLocked finds the first agent of role still pending on the turn.
func (ex *Executor) nextAgentLocked(role AgentRole) int {
	for i, a := range ex.cfg.Agents {
		if ex.pendingAgents[i] && a.Role() == role {
			return i
		}
	}
	return -1
}

func (ex *Executor) consumeUntilRoleLocked(role AgentRole) {
	for len(ex.pendingRoles) > 0 && ex.pendingRoles[0] != role {
		ex.pendingRoles = ex.pendingRoles[1:]
	}
}

func (ex *Executor) removeRoleLocked(role AgentRole) {
	for i, r := range ex.pendingRoles {
		if r == role {
			ex.pendingRoles = append(ex.pendingRoles[:i:i], ex.pendingRoles[i+1:]...)
			return
		}
	}
}

// NextRunnableRole returns the role that would act next on the current
// turn: the first pending role with a pending agent.
func (ex *Executor) NextRunnableRole() (AgentRole, bool) {
	ex.mu.Lock()
	defer ex.mu.Unlock()
	for _, r := range ex.pendingRoles {
		if ex.nextAgentLocked(r) >= 0 {
			return r, true
		}
	}
	return "", false
}

// step runs one agent interaction, advancing the turn when every role of
// the current turn acted.
func (ex *Executor) step(ctx context.Context, goToNextTurn bool, onTurn StateCallback) error {
	for {
		ex.mu.Lock()
		if len(ex.pendingRoles) == 0 {
			ex.mu.Unlock()
			if !goToNextTurn {
				return nil
			}
			ex.newTurn()
			if onTurn != nil {
				if err := onTurn(ctx, ex.state); err != nil {
					return err
				}
			}
			if ex.state.CurrentTurn() >= ex.cfg.MaxTurns {
				ex.reachedMaxTurns("")
				return nil
			}
			ex.mu.Lock()
		}
		role := ex.pendingRoles[0]
		idx := ex.nextAgentLocked(role)
		if idx < 0 {
			ex.removeRoleLocked(role)
			ex.mu.Unlock()
			continue
		}
		ex.pendingAgents[idx] = false
		ex.mu.Unlock()
		return ex.callAgent(ctx, idx, role, nil)
	}
}

// StateCallback is called with the state by Proceed after a turn or a step.
type StateCallback func(ctx context.Context, state *ExecutionState) error

// ProceedOptions configure Proceed.
type ProceedOptions struct {
	// Turns is the number of turns to proceed; 0 runs until the scenario
	// concludes or reaches MaxTurns.
	Turns int
	// OnTurn runs at the start of each new turn.
	OnTurn StateCallback
	// OnStep runs after each agent interaction.
	OnStep StateCallback
}

// Proceed lets the agents interact on their own for opts.Turns turns, or
// until the scenario concludes. It returns the result when it concluded.
func (ex *Executor) Proceed(ctx context.Context, opts ProceedOptions) (*ScenarioResult, error) {
	initialTurn := ex.state.CurrentTurn()
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		goToNextTurn := opts.Turns <= 0 || ex.state.CurrentTurn()+1 < initialTurn+opts.Turns
		for _, h := range ex.hooks.beforeProceed {
			if err := h.BeforeProceedStep(ctx, ex); err != nil {
				return nil, err
			}
		}
		if err := ex.step(ctx, goToNextTurn, opts.OnTurn); err != nil {
			return nil, err
		}
		if r := ex.Result(); r != nil {
			return r, nil
		}
		if opts.OnStep != nil {
			if err := opts.OnStep(ctx, ex.state); err != nil {
				return nil, err
			}
		}
		for _, h := range ex.hooks.afterProceed {
			if err := h.AfterProceedStep(ctx, ex); err != nil {
				return nil, err
			}
		}
		if r := ex.Result(); r != nil {
			return r, nil
		}
		if !goToNextTurn {
			return nil, nil
		}
	}
}

// User adds a user turn. With text, the text is the user message (after
// UserTurnTransformer extensions, and unless a UserTurnInterceptor takes the
// turn over); without, the user simulator generates it.
func (ex *Executor) User(ctx context.Context, text string) error {
	if text == "" {
		_, err := ex.scriptCallAgent(ctx, AgentRoleUser, nil, nil)
		return err
	}
	msgs, err := ex.transformUserTurn(ctx, nil, []Message{UserMsg(text)})
	if err != nil {
		return err
	}
	if len(msgs) == 1 {
		for _, ic := range ex.hooks.interceptors {
			handled, err := ic.InterceptUserTurn(ctx, ex, msgs[0])
			if err != nil {
				return err
			}
			if handled {
				return nil
			}
		}
	}
	_, err = ex.scriptCallAgent(ctx, AgentRoleUser, msgs, nil)
	return err
}

// UserMessage adds m as the user turn, without transformation.
func (ex *Executor) UserMessage(ctx context.Context, m Message) error {
	_, err := ex.scriptCallAgent(ctx, AgentRoleUser, []Message{m}, nil)
	return err
}

// Agent adds an agent turn: text as the agent's message, or, when empty, a
// response of the agent under test.
func (ex *Executor) Agent(ctx context.Context, text string) error {
	var content []Message
	if text != "" {
		content = []Message{AssistantMsg(text)}
	}
	_, err := ex.scriptCallAgent(ctx, AgentRoleAgent, content, nil)
	return err
}

// AgentMessage adds m as the agent turn.
func (ex *Executor) AgentMessage(ctx context.Context, m Message) error {
	_, err := ex.scriptCallAgent(ctx, AgentRoleAgent, []Message{m}, nil)
	return err
}

// Message adds a message: user messages take the user turn, assistant
// messages the agent turn, and other roles are added as they are.
func (ex *Executor) Message(ctx context.Context, m Message) error {
	switch m.Role {
	case RoleUser:
		return ex.UserMessage(ctx, m)
	case RoleAssistant:
		return ex.AgentMessage(ctx, m)
	}
	ex.addMessage(m, "", -1, nil)
	return nil
}

// Judge asks the judge for a verdict. With inline criteria the verdict is a
// checkpoint: when it passes the scenario continues and Judge returns nil.
func (ex *Executor) Judge(ctx context.Context, req JudgmentRequest) (*ScenarioResult, error) {
	return ex.scriptCallAgent(ctx, AgentRoleJudge, nil, &req)
}

// AddMessage records m as if every agent heard it: it is added to the
// conversation and broadcast to all agents. Extensions use it to record a
// turn they delivered themselves.
func (ex *Executor) AddMessage(m Message) Message {
	return ex.addMessage(m, "", -1, nil)
}

// ClearPendingMessages drops the queued messages of an agent, for example
// audio an extension already delivered out of band.
func (ex *Executor) ClearPendingMessages(agent AgentAdapter) {
	ex.mu.Lock()
	defer ex.mu.Unlock()
	for i, a := range ex.cfg.Agents {
		if a == agent {
			ex.pendingMessages[i] = nil
		}
	}
}

// scriptCallAgent is the routing of the script steps: find the next agent
// of role on this turn (starting a new turn when none is left), then add
// content or call the agent.
func (ex *Executor) scriptCallAgent(ctx context.Context, role AgentRole, content []Message, req *JudgmentRequest) (*ScenarioResult, error) {
	ex.mu.Lock()
	ex.consumeUntilRoleLocked(role)
	idx := ex.nextAgentLocked(role)
	ex.mu.Unlock()
	if idx < 0 {
		ex.newTurn()
		ex.mu.Lock()
		ex.consumeUntilRoleLocked(role)
		idx = ex.nextAgentLocked(role)
		ex.mu.Unlock()
	}
	if idx < 0 {
		return nil, noAgentError(role, content)
	}
	ex.mu.Lock()
	ex.pendingAgents[idx] = false
	ex.mu.Unlock()

	if len(content) > 0 {
		for _, m := range content {
			ex.addMessage(m, "", idx, nil)
		}
		return nil, nil
	}
	if err := ex.callAgent(ctx, idx, role, req); err != nil {
		return nil, err
	}

	ex.mu.Lock()
	defer ex.mu.Unlock()
	r := ex.result
	if r == nil {
		return nil, nil
	}
	if req != nil && req.Criteria != nil {
		ex.checkpoints = append(ex.checkpoints, checkpoint{
			met: r.MetCriteria, unmet: r.UnmetCriteria, inconclusive: r.InconclusiveCriteria, criteria: r.Criteria,
		})
		if r.Success {
			ex.result = nil
			return nil, nil
		}
		cp := ex.compiledCheckpointsLocked()
		r.MetCriteria, r.UnmetCriteria, r.InconclusiveCriteria, r.Criteria = cp.met, cp.unmet, cp.inconclusive, cp.criteria
		ex.merged = true
		return r, nil
	}
	cp := ex.compiledCheckpointsLocked()
	r.MetCriteria = concat(cp.met, r.MetCriteria)
	if len(cp.criteria) > 0 {
		r.Criteria = append(cp.criteria, r.Criteria...)
	}
	ex.merged = true
	return r, nil
}

func noAgentError(role AgentRole, content []Message) error {
	roleClass := "your agent"
	switch role {
	case AgentRoleUser:
		roleClass = "a scenario.NewUserSimulatorAgent()"
	case AgentRoleAgent:
		roleClass = "an agent adapter"
	case AgentRoleJudge:
		roleClass = "a scenario.NewJudgeAgent()"
	}
	if len(content) > 0 {
		return fmt.Errorf("cannot generate a message for role `%s` with content `%s` because no agent with this role was found, please add %s to the scenario `agents` list", role, content[0].Text(), roleClass)
	}
	return fmt.Errorf("cannot generate a message for role `%s` because no agent with this role was found, please add %s to the scenario `agents` list", role, roleClass)
}

// TurnHandle tracks an agent turn running in the background.
type TurnHandle struct {
	done chan struct{}
	err  error
	// taken is set (under Executor.mu) when an extension took the turn over
	// with TakePendingAgentTurn: it reports the turn's error itself.
	taken bool
}

// Done is closed when the turn finished.
func (h *TurnHandle) Done() <-chan struct{} { return h.done }

// Wait blocks until the turn finished and returns its error.
func (h *TurnHandle) Wait() error {
	<-h.done
	return h.err
}

// Finished reports whether the turn finished.
func (h *TurnHandle) Finished() bool {
	select {
	case <-h.done:
		return true
	default:
		return false
	}
}

// startTurn runs an agent turn in the background. Every turn started stays
// tracked until the run drains it, even when a later turn replaces it as the
// pending one, so none outlives the run. A panic in the turn becomes its
// error instead of crashing the process.
func (ex *Executor) startTurn(run func() error) *TurnHandle {
	h := &TurnHandle{done: make(chan struct{})}
	ex.mu.Lock()
	ex.pendingTurn = h
	kept := ex.inflight[:0]
	for _, t := range ex.inflight {
		// Finished turns no longer matter unless their error is unreported.
		if !t.Finished() || (t.err != nil && !t.taken) {
			kept = append(kept, t)
		}
	}
	ex.inflight = append(kept, h)
	ex.mu.Unlock()
	go func() {
		defer close(h.done)
		defer func() {
			if p := recover(); p != nil {
				h.err = fmt.Errorf("agent turn panicked: %v", p)
			}
		}()
		h.err = run()
	}()
	return h
}

// AgentNonBlocking starts an agent turn without waiting for it, the
// primitive behind voice barge-in tests. The script continues while the
// agent responds; the run waits for the turn before it ends, and its error
// fails the run. With content, the messages are the agent's turn instead of
// a response of the agent under test, as with AgentMessage.
func (ex *Executor) AgentNonBlocking(ctx context.Context, content ...Message) *TurnHandle {
	return ex.startTurn(func() error {
		_, err := ex.scriptCallAgent(ctx, AgentRoleAgent, content, nil)
		return err
	})
}

// ScheduleAgentTurnNonBlocking starts the agent under test's turn in the
// background when it is the next role to act, consuming it from the turn,
// and reports whether it did. BeforeProceedStepHook extensions use it to
// interrupt an agent mid-turn.
func (ex *Executor) ScheduleAgentTurnNonBlocking(ctx context.Context) (*TurnHandle, bool) {
	ex.mu.Lock()
	next := AgentRole("")
	for _, r := range ex.pendingRoles {
		if ex.nextAgentLocked(r) >= 0 {
			next = r
			break
		}
	}
	idx := ex.nextAgentLocked(AgentRoleAgent)
	if next != AgentRoleAgent || idx < 0 {
		ex.mu.Unlock()
		return nil, false
	}
	ex.pendingAgents[idx] = false
	ex.consumeUntilRoleLocked(AgentRoleAgent)
	if len(ex.pendingRoles) > 0 {
		ex.pendingRoles = ex.pendingRoles[1:]
	}
	ex.mu.Unlock()
	return ex.startTurn(func() error { return ex.callAgent(ctx, idx, AgentRoleAgent, nil) }), true
}

// PendingAgentTurn returns the last non-blocking agent turn, or nil.
func (ex *Executor) PendingAgentTurn() *TurnHandle {
	ex.mu.Lock()
	defer ex.mu.Unlock()
	return ex.pendingTurn
}

// TakePendingAgentTurn returns the last non-blocking agent turn and forgets
// it, for an extension that awaits it itself.
func (ex *Executor) TakePendingAgentTurn() *TurnHandle {
	ex.mu.Lock()
	defer ex.mu.Unlock()
	h := ex.pendingTurn
	ex.pendingTurn = nil
	if h != nil {
		h.taken = true
	}
	return h
}

// awaitPendingTurn waits for every non-blocking turn still in flight,
// including ones an extension took over or a later turn replaced, and
// returns the first error no extension took responsibility for.
func (ex *Executor) awaitPendingTurn() error {
	ex.mu.Lock()
	turns := ex.inflight
	ex.inflight = nil
	ex.pendingTurn = nil
	ex.mu.Unlock()
	var first error
	for _, h := range turns {
		err := h.Wait()
		ex.mu.Lock()
		taken := h.taken
		ex.mu.Unlock()
		if err != nil && !taken && first == nil {
			first = err
		}
	}
	return first
}
