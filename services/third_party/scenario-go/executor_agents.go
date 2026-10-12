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
// call's trace id) or the verdict.
func (ex *Executor) callAgent(ctx context.Context, idx int, role AgentRole, req *JudgmentRequest) error {
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
	defer span.End()
	if !inputFirst && span.IsRecording() {
		span.SetAttributes(langwatch.AttributeLangWatchInput.String(ex.state.chatMessagesInput()))
	}

	ex.mu.Lock()
	// Clipped, so an agent appending to it cannot write into the queue's
	// spare capacity, where the next broadcast lands.
	newMessages := slices.Clip(ex.pendingMessages[idx])
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

	started := time.Now()
	ret, err := agent.Call(spanCtx, agentInput)
	elapsed := time.Since(started)

	ex.mu.Lock()
	ex.agentTimes[idx] += elapsed
	// Drop the messages the agent received; later broadcasts stay queued.
	if q := ex.pendingMessages[idx]; len(q) >= len(newMessages) {
		ex.pendingMessages[idx] = q[len(newMessages):]
		if len(ex.pendingMessages[idx]) == 0 {
			ex.pendingMessages[idx] = nil
		}
	}
	ex.mu.Unlock()

	if err != nil {
		ex.emitter.streamFinished(stream)
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		name := agentName(agent)
		if name == "" {
			name = "Agent"
		}
		return fmt.Errorf("[%s] %w", name, err)
	}
	if verdict, ok := ret.Verdict(); ok {
		ex.emitter.streamFinished(stream)
		ex.setResult(verdictResult(verdict))
		return nil
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
			return fmt.Errorf("[%s] %w", agentName(agent), err)
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
				return err
			}
		}
	}
	return nil
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
	for i := range ex.pendingMessages {
		if i == from {
			continue
		}
		q := ex.pendingMessages[i]
		if q == nil {
			// A turn usually queues one or two messages per agent (the judge
			// hears both the user and the agent): size for two at once.
			q = make([]Message, 0, 2)
		}
		ex.pendingMessages[i] = append(q, stored)
	}
	ex.mu.Unlock()
	return stored
}

// onRollback drops removed messages from the pending queues and reconciles
// the reported conversation.
func (ex *Executor) onRollback(removed map[string]bool) {
	ex.mu.Lock()
	for i, q := range ex.pendingMessages {
		kept := q[:0:0]
		for _, m := range q {
			if !removed[m.ID] {
				kept = append(kept, m)
			}
		}
		ex.pendingMessages[i] = kept
	}
	ex.mu.Unlock()
	ex.emitter.rolledBack()
}
