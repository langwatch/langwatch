package statusprobe

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeClock is a mutable clock seam so verdict windows are exercised
// deterministically instead of with sleeps.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// countingPinger fails or succeeds on command and counts probe attempts.
type countingPinger struct {
	calls atomic.Int64
	fail  atomic.Bool
}

func (p *countingPinger) Health(context.Context) error {
	p.calls.Add(1)
	if p.fail.Load() {
		return errors.New("dial tcp 10.0.0.1:5560: connection refused")
	}
	return nil
}

// @scenario "control plane blip within the warm-cache window stays healthy"
// A short stretch of failed probes must not flip the verdict: warm-cache
// traffic is unaffected during a blip and the public status page must not
// flap on what customers cannot feel.
func TestMonitor_BlipWithinToleranceStaysHealthy(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	m := New(Options{Now: clock.Now})

	clock.Advance(30 * time.Second)

	ok, detail := m.ControlPlane()
	assert.True(t, ok)
	assert.Equal(t, "ok", detail)
}

// @scenario "sustained control plane outage flips health to 503"
// Monitor-level half of the scenario: past the tolerance the component
// verdict goes unhealthy with a duration-only detail. The route-level 503
// mapping is covered in httpapi's statushealth_test.go.
func TestMonitor_SustainedOutageGoesUnhealthy(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	m := New(Options{Now: clock.Now})

	clock.Advance(DefaultUnhealthyAfter + 30*time.Second)

	ok, detail := m.ControlPlane()
	assert.False(t, ok)
	assert.Contains(t, detail, "unreachable")
	// The public detail must never carry error internals: probe failures
	// embed the control plane's host and port in their error strings.
	assert.NotContains(t, detail, "http")
	assert.NotContains(t, detail, "5560")
	assert.NotContains(t, detail, ":")
}

// @scenario "recovery after an outage returns health to 200"
// Once the control plane answers again, the next background probe restores
// the healthy verdict without a restart.
func TestMonitor_RecoversAfterSuccessfulProbe(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	pinger := &countingPinger{}
	pinger.fail.Store(true)

	m := New(Options{
		Pinger:   pinger,
		Now:      clock.Now,
		Interval: 2 * time.Millisecond,
	})
	t.Cleanup(m.Stop)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	m.Start(ctx)

	// Outage: probes fail while the clock moves past the tolerance.
	clock.Advance(DefaultUnhealthyAfter + time.Minute)
	require.Eventually(t, func() bool {
		ok, _ := m.ControlPlane()
		return !ok
	}, 2*time.Second, 5*time.Millisecond, "verdict should flip after the tolerance")

	// Control plane comes back; the loop's next probe succeeds and stamps
	// lastSuccess with the current clock.
	pinger.fail.Store(false)
	require.Eventually(t, func() bool {
		ok, _ := m.ControlPlane()
		return ok
	}, 2*time.Second, 5*time.Millisecond, "verdict should recover after a successful probe")
}

// @scenario "health response carries no tenant data or internal endpoints"
// Monitor-level half of the scenario, against a probe that really failed:
// the transport error a dead control plane produces embeds its host and
// port, and that string must not reach the public detail. Asserted here
// rather than only on a monitor that never probed, since a detail built
// from the error would otherwise look clean in every test.
func TestMonitor_PublicDetailNeverCarriesTheProbeError(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	pinger := &countingPinger{}
	pinger.fail.Store(true)

	m := New(Options{Pinger: pinger, Now: clock.Now, Interval: time.Millisecond})
	t.Cleanup(m.Stop)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	m.Start(ctx)

	require.Eventually(t, func() bool {
		return pinger.calls.Load() >= 2
	}, 2*time.Second, time.Millisecond, "the loop should have observed real failures")
	clock.Advance(DefaultUnhealthyAfter + time.Minute)

	ok, detail := m.ControlPlane()
	require.False(t, ok)
	for _, leak := range []string{"dial", "tcp", "10.0.0.1", "5560", "connection refused"} {
		assert.NotContains(t, detail, leak, "probe error internals must stay out of the public body")
	}
}

// A half-wired monitor fails closed. With no Pinger nothing can ever
// refresh the verdict, so it must go unhealthy at the tolerance rather
// than pin the public status page green forever. The loop runs on a fast
// ticker throughout, so a probe that treated "no pinger" as success would
// keep stamping lastSuccess and pull the verdict back to healthy.
func TestMonitor_WithoutAPingerFailsClosed(t *testing.T) {
	clock := &fakeClock{t: time.Unix(1_700_000_000, 0)}
	m := New(Options{Now: clock.Now, Interval: time.Millisecond})
	t.Cleanup(m.Stop)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	m.Start(ctx)

	ok, _ := m.ControlPlane()
	require.True(t, ok, "the boot grace window still applies")

	clock.Advance(DefaultUnhealthyAfter + time.Second)

	// Never, not Eventually: the verdict is already unhealthy the instant
	// the clock moves, so Eventually would pass on the first read, before
	// the loop had run at all. Holding it unhealthy across ~200 ticks is
	// what proves the loop cannot talk itself back to healthy.
	require.Never(t, func() bool {
		ok, _ := m.ControlPlane()
		return ok
	}, 200*time.Millisecond, time.Millisecond, "a monitor with no pinger must not refresh its own verdict")

	ok, detail := m.ControlPlane()
	require.False(t, ok)
	assert.Contains(t, detail, "unreachable")
}

// The loop probes on its own clock and Stop halts it. The endpoint's
// no-fan-out property depends on the ticker being the only probe driver.
func TestMonitor_ProbesOnItsOwnClockAndStops(t *testing.T) {
	pinger := &countingPinger{}
	m := New(Options{Pinger: pinger, Interval: 2 * time.Millisecond})

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	m.Start(ctx)

	require.Eventually(t, func() bool {
		return pinger.calls.Load() >= 3
	}, 2*time.Second, time.Millisecond, "loop should keep probing on the ticker")

	m.Stop()
	// Idempotent stop must not panic.
	m.Stop()

	settled := pinger.calls.Load()
	time.Sleep(20 * time.Millisecond)
	assert.LessOrEqual(t, pinger.calls.Load(), settled+1, "probing should halt after Stop")
}

// Reading the verdict never triggers a probe: ControlPlane is a cached
// read, whatever the poll rate.
func TestMonitor_VerdictReadsDoNotProbe(t *testing.T) {
	pinger := &countingPinger{}
	m := New(Options{Pinger: pinger})

	for range 100 {
		ok, detail := m.ControlPlane()
		assert.True(t, ok)
		assert.NotContains(t, detail, "unreachable")
	}
	assert.Zero(t, pinger.calls.Load())
}
