package analyticssim

import (
	"testing"
	"time"
)

func BenchmarkStoreAddAtCapacity(b *testing.B) {
	s := newStore(5000, 64<<10)
	batch := []Record{{Provider: ProviderPostHog, Kind: KindEvent, DistinctID: "u"}}
	for range 5000 {
		s.add(batch, time.Time{})
	}
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		s.add(batch, time.Time{})
	}
}
