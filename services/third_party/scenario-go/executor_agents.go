package scenario

import (
	"context"
	"fmt"
	"time"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"go.opentelemetry.io/otel/attribute"
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
	spanCtx, span := ex.tracer.Start(parent, agentSpanName(agent), trace.WithAttributes(
		attribute.String(threadIDKey, ex.cfg.ThreadID),
		attribute.String("scenario.role", string(role)),
	))
	defer span.End()
	span.SetType(langwatch.SpanTypeAgent)
	if span.IsRecording() {
		span.SetAttributes(langwatch.AttributeLangWatchInput.String(ex.state.chatMessagesInput()))
	}

	ex.mu.Lock()
	newMessages := ex.pendingMessages[idx]
	ex.mu.Unlock()

	var stream *MessageStream
	if role != AgentRoleJudge {
		stream = ex.emitter.newStream(messageRoleFor(role))
	}
	input := AgentInput{
		ThreadID:           ex.cfg.ThreadID,
		Messages:           ex.state.Messages(),
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
	ret, err := agent.Call(spanCtx, input)
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
	if len(msgs) > 0 && span.IsRecording() {
		span.SetAttributes(langwatch.AttributeLangWatchOutput.String(chatMessagesValue(msgs)))
	}
	if role == AgentRoleUser {
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
	for _, m := range msgs {
		m.TraceID = traceID
		id := stream.bindID(m.Role)
		var bound *MessageStream
		if id != "" {
			bound = stream
		}
		last = ex.addMessage(m, id, idx, bound)
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
	stored, index := ex.state.add(m, id)
	ex.emitter.messageAdded(stored, index, stream)
	ex.mu.Lock()
	for i := range ex.pendingMessages {
		if i != from {
			ex.pendingMessages[i] = append(ex.pendingMessages[i], stored)
		}
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
