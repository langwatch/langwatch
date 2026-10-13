package system

import (
	"runtime"
	"testing"
)

func TestLoadAverageReadsTheMachine(t *testing.T) {
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("no load average to read here")
	}
	if load := New().LoadAverage(); load < 0 {
		t.Fatalf("LoadAverage() = %v, want a reading", load)
	}
}

func BenchmarkLoadAverage(b *testing.B) {
	b.ReportAllocs()
	sys := New()
	for b.Loop() {
		_ = sys.LoadAverage()
	}
}
