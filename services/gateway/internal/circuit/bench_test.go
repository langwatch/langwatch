package circuit

import (
	"strconv"
	"testing"
	"time"
)

// BenchmarkAllow_Closed — hottest path: every provider call pays this
// before the fallback engine dispatches to bifrost. Closed breaker on
// a single slot should be nanosecond-level.
func BenchmarkAllow_Closed(b *testing.B) {
	r := NewRegistry(Options{FailureLimit: 10, Window: 30 * time.Second, OpenFor: 60 * time.Second})
	_ = r.Allow("pc_primary")
	r.RecordSuccess("pc_primary")
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = r.Allow("pc_primary")
	}
}

// BenchmarkRecordFailure_SlidingWindow — exercises the prune path
// with ~full-window history. This is the worst case cost when a
// provider is steadily failing.
func BenchmarkRecordFailure_SlidingWindow(b *testing.B) {
	r := NewRegistry(Options{FailureLimit: 100, Window: 30 * time.Second, OpenFor: 60 * time.Second})
	for i := 0; i < 50; i++ {
		_ = r.Allow("pc_primary")
		r.RecordFailure("pc_primary")
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		r.RecordFailure("pc_primary")
	}
}

// BenchmarkAllow_ManySlots measures the slot-lookup cost across a
// realistic multi-tenant scale (one slot per active credential; big
// customers reach hundreds).
func BenchmarkAllow_ManySlots(b *testing.B) {
	r := NewRegistry(Options{FailureLimit: 10, Window: 30 * time.Second, OpenFor: 60 * time.Second})
	// Prime the map so Allow is a pure RLock/map read.
	for i := 0; i < 500; i++ {
		_ = r.Allow("pc_" + strconv.Itoa(i))
	}
	b.ResetTimer()
	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		_ = r.Allow("pc_" + strconv.Itoa(i%500))
	}
}
