package app

import (
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
	"github.com/langwatch/langwatch/services/langyagent/internal/turnfold"
)

// frameSink is the app's ChatSink for a self-driven turn: every frame the coding
// agent produces is (1) folded into a turnfold.Accumulator so the app can post a
// self-sufficient durable final, and (2) pushed to the control-plane relay via the
// per-turn FrameStream. The stream may be nil (relay disabled — an older control
// plane with no runToken, or a missing endpoint): the turn still runs and
// finalizes, it just has no live edge.
type frameSink struct {
	stream FrameStream
	acc    *turnfold.Accumulator
}

func newFrameSink(stream FrameStream) *frameSink {
	return &frameSink{stream: stream, acc: turnfold.New()}
}

// Emit folds the frame into the durable-final accumulator and pushes it to the
// relay. A push error is returned (StreamSession stops on it), but the accumulate
// always happens first so the durable final is complete regardless of the push.
func (s *frameSink) Emit(f frames.Frame) error {
	s.acc.Observe(f)
	if s.stream == nil {
		return nil
	}
	return s.stream.Emit(f)
}

// result snapshots the accumulated final, mapping the frame-shaped tool calls
// turnfold returns to the durable-final shape the control-plane ingest expects
// (FinalToolCall). Called once, after the stream has returned.
func (s *frameSink) result() (text string, toolCalls []FinalToolCall) {
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
