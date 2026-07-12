package app

import "github.com/langwatch/langwatch/services/langyagent/internal/turnfold"

// accumulatingSink is a ChatSink that tees the turn's frame stream into a
// turnfold.Accumulator as it forwards it, so the app can assemble a durable final
// (text + tool calls) to POST independently of the relay — without changing the
// Worker/StreamEvents contract. The embedded ChatSink carries Begin/ErrorEvent/
// Flush through unchanged; only Write is intercepted, to observe each line before
// forwarding it.
type accumulatingSink struct {
	ChatSink
	acc *turnfold.Accumulator
}

func newAccumulatingSink(inner ChatSink) *accumulatingSink {
	return &accumulatingSink{ChatSink: inner, acc: turnfold.New()}
}

func (s *accumulatingSink) Write(p []byte) (int, error) {
	s.acc.Observe(p)
	return s.ChatSink.Write(p)
}

// result snapshots the accumulated final, mapping the frame-shaped tool calls
// turnfold returns to the durable-final shape the control-plane ingest expects
// (FinalToolCall). Called once, after the stream has returned.
func (s *accumulatingSink) result() (text string, toolCalls []FinalToolCall) {
	text, tools := s.acc.Result()
	toolCalls = make([]FinalToolCall, 0, len(tools))
	for _, t := range tools {
		toolCalls = append(toolCalls, FinalToolCall{
			ID:      t.ID,
			Name:    t.Name,
			Input:   t.Input,
			Output:  t.Output,
			IsError: t.IsError,
		})
	}
	return text, toolCalls
}
