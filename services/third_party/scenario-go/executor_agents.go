package scenario

import (
	"context"
	"fmt"
	"slices"
	"time"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

func messageRoleFor(role AgentRole) Role {
	if role == AgentRoleUser {
		return RoleUser
	}
	return RoleAssistant
}

// callAgent runs one agent call inside its span: builds the input, calls
// the agent, records time, and adds the returned messages (stamped with the
// call's trace id) or the verdict. It returns the result the call's verdict
// set, nil when the agent returned messages.
func (ex *Executor) callAgent(ctx context.Context, idx int, role AgentRole, req *JudgmentRequest) (*ScenarioResult, error) {
	return ex.prepareAgentCall(ctx, idx, role, req).run()
}

// agentCall is an agent call whose span and input are taken, waiting to
// call the agent.
type agentCall struct {
	ex        *Executor
	idx       int
	role      AgentRole
	agent     AgentAdapter
	spanCtx   context.Context
	span      trace.Span
	stream    *MessageStream
	input     AgentInput
	delivered uint64
}

// prepareAgentCall starts the call's span under the current turn and takes
// the agent's input, the part of a call that runs before the agent does. A
// non-blocking turn prepares synchronously, as JS does before its first
// await, so a later script step neither leaks into the input nor moves the
// call to its turn.
func (ex *Executor) prepareAgentCall(ctx context.Context, idx int, role AgentRole, req *JudgmentRequest) *agentCall {
	agent := ex.cfg.Agents[idx]
	parent := ex.TurnContext(ctx)
	// The span starts with its whole attribute list. The input is encoded
	// up front when the parent records (the span then records too under the
	// default parent-based sampling), else only once the span turned out to
	// record, appended last as before.
	inputFirst := trace.SpanFromContext(parent).IsRecording()
	var input string
	if inputFirst {
		input = ex.state.chatMessagesInput()
	}
	spanCtx, span := ex.spans.start(parent, ex.spanNames[idx], agentSpanAttributes(ex.cfg.ThreadID, role, input, inputFirst))
	if !inputFirst && span.IsRecording() {
		span.SetAttributes(langwatch.AttributeLangWatchInput.String(ex.state.chatMessagesInput()))
	}

	ex.mu.Lock()
	// Clipped, so an agent appending to it cannot write into the queue's
	// spare capacity, where the next broadcast lands.
	newMessages := slices.Clip(ex.pendingMessages[idx])
	// Every message broadcast so far has a sequence number up to delivered;
	// later broadcasts get higher ones.
	delivered := ex.broadcastSeq
	ex.mu.Unlock()

	var stream *MessageStream
	if role != AgentRoleJudge {
		stream = ex.emitter.newStream(messageRoleFor(role))
	}
	history := ex.state.messagesView()
	if !readsHistoryOnly(agent) {
		history = slices.Clip(slices.Clone(history))
	}
	agentInput := AgentInput{
		ThreadID:           ex.cfg.ThreadID,
		Messages:           history,
		NewMessages:        newMessages,
		RequestedRole:      role,
		JudgmentRequest:    req,
		PropagationHeaders: propagationHeaders(spanCtx),
		ScenarioState:      ex.state,
		ScenarioConfig:     ex.cfg,
		Executor:           ex,
		Stream:             stream,
	}
	return &agentCall{ex: ex, idx: idx, role: role, agent: agent, spanCtx: spanCtx, span: span,
		stream: stream, input: agentInput, delivered: delivered}
}

// run calls the agent and records what it returned.
func (c *agentCall) run() (*ScenarioResult, error) {
	ex, idx, role, agent, spanCtx, span, stream, delivered := c.ex, c.idx, c.role, c.agent, c.spanCtx, c.span, c.stream, c.delivered
	defer span.End()

	started := time.Now()
	ret, err := agent.Call(spanCtx, c.input)
	elapsed := time.Since(started)

	ex.mu.Lock()
	ex.agentTimes[idx] += elapsed
	ex.dropDeliveredLocked(idx, delivered)
	ex.mu.Unlock()

	if err != nil {
		ex.emitter.streamFinished(stream)
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		name := agentName(agent)
		if name == "" {
			name = "Agent"
		}
		return nil, fmt.Errorf("[%s] %w", name, err)
	}
	if verdict, ok := ret.Verdict(); ok {
		ex.emitter.streamFinished(stream)
		return ex.setResult(verdictResult(verdict)), nil
	}

	msgs := ret.Messages(messageRoleFor(role))
	// encoded holds each message's model JSON when the output was recorded;
	// the state keeps it for the next span input instead of encoding again.
	var encoded [][]byte
	if len(msgs) > 0 && span.IsRecording() {
		encoded = encodeModelMessages(msgs)
		span.SetAttributes(langwatch.AttributeLangWatchOutput.String(chatMessagesJSON(encoded)))
	}
	if role == AgentRoleUser && len(ex.hooks.transformers) > 0 {
		encoded = nil // the transformers may change the messages
		if msgs, err = ex.transformUserTurn(spanCtx, agent, msgs); err != nil {
			ex.emitter.streamFinished(stream)
			return nil, fmt.Errorf("[%s] %w", agentName(agent), err)
		}
	}
	traceID := ""
	if sc := span.SpanContext(); sc.IsValid() {
		traceID = sc.TraceID().String()
	}
	var last Message
	for i, m := range msgs {
		m.TraceID = traceID
		id := stream.bindID(m.Role)
		var bound *MessageStream
		if id != "" {
			bound = stream
		}
		var model []byte
		if encoded != nil {
			model = encoded[i]
		}
		last = ex.addEncodedMessage(m, id, idx, bound, model)
	}
	ex.emitter.streamFinished(stream)
	if role == AgentRoleUser && len(msgs) > 0 {
		for _, h := range ex.hooks.generatedUser {
			if err := h.AfterGeneratedUserTurn(spanCtx, ex, last); err != nil {
				return nil, err
			}
		}
	}
	return nil, nil
}

// readsHistoryOnly reports whether the agent is one of the built-in agents
// (user simulator, judge), which only read AgentInput.Messages and copy it
// before handing it to an extension; the executor gives them a view of the
// stored conversation instead of a copy. Other agents, including types that
// embed a built-in one, get their own copy, as AgentInput.Messages
// documents. The check is on the exact type for that reason.
func readsHistoryOnly(a AgentAdapter) bool {
	switch a.(type) {
	case *UserSimulatorAgent, *JudgeAgent:
		return true
	}
	return false
}

// transformUserTurn applies the UserTurnTransformer extensions.
func (ex *Executor) transformUserTurn(ctx context.Context, producer AgentAdapter, msgs []Message) ([]Message, error) {
	var err error
	for _, t := range ex.hooks.transformers {
		if msgs, err = t.TransformUserTurn(ctx, ex, producer, msgs); err != nil {
			return nil, err
		}
	}
	return msgs, nil
}

// addMessage stores m (with id when given), reports it to the emitter and
// broadcasts it to every agent but the sender.
func (ex *Executor) addMessage(m Message, id string, from int, stream *MessageStream) Message {
	return ex.addEncodedMessage(m, id, from, stream, nil)
}

// addEncodedMessage is addMessage with m's model JSON already encoded (nil
// when not).
func (ex *Executor) addEncodedMessage(m Message, id string, from int, stream *MessageStream, model []byte) Message {
	stored := ex.emitter.messageAdded(func() (Message, int) { return ex.state.addEncoded(m, id, model) }, stream)
	ex.mu.Lock()
	ex.broadcastSeq++
	seq := ex.broadcastSeq
	for i := range ex.pendingMessages {
		if i == from {
			continue
		}
		q, seqs := ex.pendingMessages[i], ex.pendingSeqs[i]
		if q == nil {
			// A turn usually queues one or two messages per agent (the judge
			// hears both the user and the agent): size for two at once.
			q = make([]Message, 0, 2)
			seqs = make([]uint64, 0, 2)
		}
		ex.pendingMessages[i] = append(q, stored)
		ex.pendingSeqs[i] = append(seqs, seq)
	}
	ex.mu.Unlock()
	return stored
}

// dropDeliveredLocked drops from agent idx's queue the messages it was
// handed, those broadcast up to sequence number delivered. The queue is in
// broadcast order, and what was rolled back or cleared during the call is
// already gone, so they are its leading entries with a number up to
// delivered; later broadcasts stay queued.
func (ex *Executor) dropDeliveredLocked(idx int, delivered uint64) {
	seqs := ex.pendingSeqs[idx]
	n := 0
	for n < len(seqs) && seqs[n] <= delivered {
		n++
	}
	if n == len(seqs) {
		ex.pendingMessages[idx], ex.pendingSeqs[idx] = nil, nil
		return
	}
	ex.pendingMessages[idx] = ex.pendingMessages[idx][n:]
	ex.pendingSeqs[idx] = seqs[n:]
}

// onRollback drops removed messages from the pending queues and reconciles
// the reported conversation.
func (ex *Executor) onRollback(removed map[string]bool) {
	ex.mu.Lock()
	for i, q := range ex.pendingMessages {
		seqs := ex.pendingSeqs[i]
		kept, keptSeqs := q[:0:0], seqs[:0:0]
		for j, m := range q {
			if !removed[m.ID] {
				kept = append(kept, m)
				keptSeqs = append(keptSeqs, seqs[j])
			}
		}
		ex.pendingMessages[i], ex.pendingSeqs[i] = kept, keptSeqs
	}
	ex.mu.Unlock()
	ex.emitter.rolledBack()
}
