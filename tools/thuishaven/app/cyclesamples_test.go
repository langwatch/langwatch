package app

import (
	"testing"
	"time"

	"go.uber.org/zap"
)

// countingSystem counts the `ps` forks a caller asks for.
type countingSystem struct {
	*fakeSystem
	samples int
}

func (c *countingSystem) ProcessSamples() []ProcessSample {
	c.samples++
	return c.fakeSystem.ProcessSamples()
}

func TestAMonitorTickForksOnePSForItsSweeps(t *testing.T) {
	sys := &countingSystem{fakeSystem: &fakeSystem{now: time.Now()}}
	o := &Orchestrator{sys: sys, store: &fakeStore{}, log: zap.NewNop()}

	end := o.shareCycleSamples()
	o.processSamples()
	o.NxDaemons()
	o.sampleProcs()
	end()
	if sys.samples != 1 {
		t.Errorf("one tick forked ps %d times, want 1", sys.samples)
	}

	o.NxDaemons()
	if sys.samples != 2 {
		t.Errorf("outside a tick ps ran %d times in all, want a fresh one (2)", sys.samples)
	}
}
