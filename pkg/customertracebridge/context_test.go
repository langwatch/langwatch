package customertracebridge

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestWithTraceParent_roundtrips(t *testing.T) {
	tp := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	ctx := WithTraceParent(context.Background(), tp)
	assert.Equal(t, tp, TraceParent(ctx))
}

func TestWithTraceParent_empty_returns_original_context(t *testing.T) {
	ctx := context.Background()
	got := WithTraceParent(ctx, "")
	assert.Empty(t, TraceParent(got))
}

func TestTraceParent_missing_returns_empty(t *testing.T) {
	assert.Empty(t, TraceParent(context.Background()))
}
