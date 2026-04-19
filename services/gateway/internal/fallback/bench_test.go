package fallback

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

// BenchmarkWalk_PrimarySuccess is the happy path: one chain slot, no
// failures, no fallback. Every /v1 request pays this exactly once.
func BenchmarkWalk_PrimarySuccess(b *testing.B) {
	eng := New(Options{})
	try := func(_ context.Context, cred string) (struct{}, error, bool) {
		return struct{}{}, nil, false
	}
	chain := []string{"pc_primary", "pc_secondary"}
	ctx := context.Background()
	spec := auth.FallbackSpec{}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _, _ = Walk(ctx, eng, spec, chain, try, nil)
	}
}

// BenchmarkWalk_FallsOver measures the cost when the primary fails
// and the secondary serves — worst case on the happy branch.
func BenchmarkWalk_FallsOver(b *testing.B) {
	eng := New(Options{})
	retry := &testErr{reason: ReasonRetryable5xx}
	try := func(_ context.Context, cred string) (struct{}, error, bool) {
		if cred == "pc_primary" {
			return struct{}{}, retry, true
		}
		return struct{}{}, nil, false
	}
	chain := []string{"pc_primary", "pc_secondary"}
	ctx := context.Background()
	spec := auth.FallbackSpec{}
	cls := func(err error) Reason {
		if te, ok := err.(*testErr); ok {
			return te.reason
		}
		return ReasonNonRetryable
	}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, _, _ = Walk(ctx, eng, spec, chain, try, cls)
	}
}
