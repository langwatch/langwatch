package gatewaymetrics

import (
	"context"
	"sync"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// streamCounter keeps the open-stream gauge honest and reports streams
// that closed without the provider ever declaring token usage. Those
// debit nothing, so they slip past budget enforcement silently, and an
// operator needs the rate to know whether callers should be sending
// `stream_options: {include_usage: true}`.
//
// A stream ends either by running dry (Next returns false) or by the
// caller closing it, and both can happen on the same stream, so the
// bookkeeping is guarded by a sync.Once.
type streamCounter struct {
	inner    domain.StreamIterator
	recorder *Recorder
	provider string
	model    string
	once     sync.Once
}

// CountStream wraps an iterator so the open-stream gauge and the
// missing-usage counter track it. Model must already be sanitized.
func CountStream(inner domain.StreamIterator, recorder *Recorder, provider, model string) domain.StreamIterator {
	if recorder == nil || inner == nil {
		return inner
	}
	recorder.StreamOpened()
	return &streamCounter{inner: inner, recorder: recorder, provider: provider, model: model}
}

func (s *streamCounter) Next(ctx context.Context) bool {
	if !s.inner.Next(ctx) {
		s.finish()
		return false
	}
	return true
}

func (s *streamCounter) Chunk() []byte       { return s.inner.Chunk() }
func (s *streamCounter) Usage() domain.Usage { return s.inner.Usage() }
func (s *streamCounter) Err() error          { return s.inner.Err() }

func (s *streamCounter) Close() error {
	s.finish()
	return s.inner.Close()
}

// RawFraming delegates so writers can still detect raw-framed (Gemini
// passthrough) streams through wrapper chains.
func (s *streamCounter) RawFraming() bool {
	if rf, ok := s.inner.(domain.RawFramer); ok {
		return rf.RawFraming()
	}
	return false
}

func (s *streamCounter) finish() {
	s.once.Do(func() {
		s.recorder.StreamClosed(s.provider, s.model, s.inner.Usage())
	})
}
