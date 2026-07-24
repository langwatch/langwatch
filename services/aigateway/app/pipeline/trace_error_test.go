package pipeline

// Tests for upstream-error visibility on customer traces. A failed request
// (e.g. upstream 504) must still end the customer span with the provider's
// status + error class stamped, instead of early-returning and dropping the
// trace (which left users unable to see failed requests at all).

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestClassifyUpstream(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantType   string
	}{
		{"upstream 504", &domain.UpstreamError{StatusCode: 504}, 504, "provider_timeout"},
		{"upstream 408", &domain.UpstreamError{StatusCode: 408}, 408, "provider_timeout"},
		{"upstream 429", &domain.UpstreamError{StatusCode: 429}, 429, "rate_limited"},
		{"upstream 500", &domain.UpstreamError{StatusCode: 500}, 500, "provider_error"},
		{"upstream 400", &domain.UpstreamError{StatusCode: 400}, 400, "bad_request"},
		{"upstream 404", &domain.UpstreamError{StatusCode: 404}, 404, "not_found"},
		{"non-upstream error", assert.AnError, 502, "provider_error"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			status, errType := classifyUpstream(tt.err)
			assert.Equal(t, tt.wantStatus, status)
			assert.Equal(t, tt.wantType, errType)
		})
	}
}

// erroringStub is a StreamIterator that yields no chunks and reports a terminal
// error, mimicking an upstream that dropped the stream before any content.
type erroringStub struct{ err error }

func (s *erroringStub) Next(_ context.Context) bool { return false }
func (s *erroringStub) Chunk() []byte               { return nil }
func (s *erroringStub) Usage() domain.Usage         { return domain.Usage{} }
func (s *erroringStub) Err() error                  { return s.err }
func (s *erroringStub) Close() error                { return s.err }

func TestTraceStreamWrapper_StampsUpstreamErrorOnClose(t *testing.T) {
	captured := newCapturedEnd()
	wrapper := &traceStreamWrapper{
		inner:   &erroringStub{err: &domain.UpstreamError{StatusCode: 504, Message: "upstream timeout"}},
		end:     captured.End,
		bundle:  &domain.Bundle{ProjectID: "proj_test"},
		req:     &domain.Request{Type: domain.RequestTypeMessages, Resolved: &domain.ResolvedModel{ModelID: "claude-opus-4-7"}},
		meta:    &Meta{},
		spanCtx: context.Background(),
	}
	for wrapper.Next(context.Background()) {
		_ = wrapper.Chunk()
	}
	captured.WaitForEnd(t)

	assert.Equal(t, 504, captured.params.UpstreamStatusCode,
		"a stream that errored mid-flight must stamp the upstream status on the trace")
	assert.Equal(t, "provider_timeout", captured.params.UpstreamErrorType)
}

func TestTraceStreamWrapper_NoErrorLeavesStatusZero(t *testing.T) {
	// A clean stream must NOT stamp any error status (0 = success).
	stub := newChunkedStub([][]byte{[]byte("data: {}\n\n")})
	captured := newCapturedEnd()
	wrapper := &traceStreamWrapper{
		inner:   stub,
		end:     captured.End,
		bundle:  &domain.Bundle{ProjectID: "proj_test"},
		req:     &domain.Request{Type: domain.RequestTypeMessages, Resolved: &domain.ResolvedModel{ModelID: "claude-opus-4-7"}},
		meta:    &Meta{},
		spanCtx: context.Background(),
	}
	for wrapper.Next(context.Background()) {
		_ = wrapper.Chunk()
	}
	captured.WaitForEnd(t)
	require.NoError(t, wrapper.Err())
	assert.Equal(t, 0, captured.params.UpstreamStatusCode)
	assert.Empty(t, captured.params.UpstreamErrorType)
}
