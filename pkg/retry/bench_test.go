package retry

import (
	"context"
	"errors"
	"testing"
)

var errRetryableBench = errors.New("upstream 503")
var errFatalBench = errors.New("upstream 400")

func retryableClassifierBench(err error) Reason {
	if errors.Is(err, errRetryableBench) {
		return ReasonRetryable5xx
	}
	return ReasonNonRetryable
}

// BenchmarkWalk_PrimarySuccess is the happy path: one chain slot, no
// failures, no fallback. Every /v1 request pays this exactly once.
func BenchmarkWalk_PrimarySuccess(b *testing.B) {
	attempt := func(_ context.Context, _ string) (struct{}, error) {
		return struct{}{}, nil
	}
	chain := []string{"pc_primary", "pc_secondary"}
	ctx := context.Background()
	opts := Options{}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, el, _ := Walk(ctx, opts, chain, attempt, retryableClassifierBench)
		el.Release()
	}
}

// BenchmarkWalk_FallsOver measures the cost when the primary fails
// and the secondary serves.
func BenchmarkWalk_FallsOver(b *testing.B) {
	attempt := func(_ context.Context, slot string) (struct{}, error) {
		if slot == "pc_primary" {
			return struct{}{}, errRetryableBench
		}
		return struct{}{}, nil
	}
	chain := []string{"pc_primary", "pc_secondary"}
	ctx := context.Background()
	opts := Options{}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, el, _ := Walk(ctx, opts, chain, attempt, retryableClassifierBench)
		el.Release()
	}
}

// BenchmarkWalk_NonRetryableStops verifies fast exit on non-retryable error.
func BenchmarkWalk_NonRetryableStops(b *testing.B) {
	attempt := func(_ context.Context, _ string) (struct{}, error) {
		return struct{}{}, errFatalBench
	}
	chain := []string{"pc_primary", "pc_secondary", "pc_tertiary"}
	ctx := context.Background()
	opts := Options{}
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_, el, _ := Walk(ctx, opts, chain, attempt, retryableClassifierBench)
		el.Release()
	}
}
