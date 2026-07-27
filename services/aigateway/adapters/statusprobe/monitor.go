// Package statusprobe watches the gateway's owned dependencies in the
// background and answers the public GET /health status-page endpoint.
//
// The public status page (status.langwatch.ai) polls /health as a plain
// HTTP monitor: 200 means the gateway is healthy, anything else means it
// is not. Two properties are load-bearing:
//
//   - Only dependencies LangWatch owns are watched. A model provider
//     outage (OpenAI, Anthropic, ...) is that provider's status, never
//     ours, so nothing in this package touches the dispatch path.
//   - The endpoint is public and unauthenticated, so a poll must never
//     fan out to anything. The monitor probes on its own clock and the
//     handler only reads the cached verdict; hammering /health costs the
//     gateway a mutex read, not a control-plane round-trip.
//
// The single owned dependency is the control plane: the gateway needs it
// for virtual-key resolution and config fetch on every cache miss. The
// auth cache's stale-while-error machinery keeps warm traffic serving
// through a short control-plane blip (soft bumps up to the hard grace
// cap), so the verdict tolerates UnhealthyAfter of unreachability before
// flipping: within the window the fleet is still serving normally, past
// it cold-cache requests are failing with auth_upstream errors and the
// status page should show it.
package statusprobe

import (
	"context"
	"fmt"
	"sync"
	"time"

	"go.uber.org/zap"
)

// Pinger performs one connectivity probe against the control plane.
// Implemented by the controlplane.Client via its signed health call, so a
// success also proves the shared HMAC secret matches: the misconfig where
// every pod looks green while every virtual-key resolve is refused.
type Pinger interface {
	Health(ctx context.Context) error
}

const (
	// DefaultInterval is how often the background probe runs.
	DefaultInterval = 15 * time.Second
	// DefaultUnhealthyAfter is how long the control plane may be
	// unreachable before the verdict flips. Sized to ride out a blip that
	// warm-cache serving absorbs (a rolling app deploy, a transient
	// network drop) while still reporting a sustained outage within one
	// status-page poll cycle or two.
	DefaultUnhealthyAfter = 60 * time.Second
	// DefaultProbeTimeout bounds a single probe attempt.
	DefaultProbeTimeout = 5 * time.Second
)

// Options configures a Monitor.
type Options struct {
	// Pinger performs the probe. A nil Pinger disables probing, which the
	// verdict then reads as a sustained outage once the tolerance elapses:
	// a monitor with no way to reach the control plane has no grounds to
	// call the gateway healthy, so this fails closed rather than pinning
	// the status page green on a half-wired deployment.
	Pinger Pinger
	Logger *zap.Logger
	// Interval between background probes. 0 uses DefaultInterval.
	Interval time.Duration
	// UnhealthyAfter is the unreachability tolerance. 0 uses
	// DefaultUnhealthyAfter.
	UnhealthyAfter time.Duration
	// ProbeTimeout bounds one probe attempt. 0 uses DefaultProbeTimeout.
	ProbeTimeout time.Duration
	// Now is a clock seam for tests. nil uses time.Now.
	Now func() time.Time
}

// Monitor runs the background probe loop and caches the latest verdict.
type Monitor struct {
	pinger         Pinger
	logger         *zap.Logger
	interval       time.Duration
	unhealthyAfter time.Duration
	probeTimeout   time.Duration
	now            func() time.Time

	stopOnce sync.Once
	stopCh   chan struct{}

	mu sync.Mutex
	// lastSuccess starts at construction time, not zero: a booting pod is
	// given one full UnhealthyAfter window to reach the control plane
	// before it reports unhealthy, so a rolling deploy does not blink the
	// public status page while the first probe is still in flight.
	lastSuccess time.Time
}

// New builds a Monitor. It does not start probing until Start.
func New(opts Options) *Monitor {
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}
	if opts.Interval <= 0 {
		opts.Interval = DefaultInterval
	}
	if opts.UnhealthyAfter <= 0 {
		opts.UnhealthyAfter = DefaultUnhealthyAfter
	}
	if opts.ProbeTimeout <= 0 {
		opts.ProbeTimeout = DefaultProbeTimeout
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	return &Monitor{
		pinger:         opts.Pinger,
		logger:         opts.Logger,
		interval:       opts.Interval,
		unhealthyAfter: opts.UnhealthyAfter,
		probeTimeout:   opts.ProbeTimeout,
		now:            opts.Now,
		stopCh:         make(chan struct{}),
		lastSuccess:    opts.Now(),
	}
}

// Start launches the probe loop. Matches the lifecycle.Worker shape.
func (m *Monitor) Start(ctx context.Context) {
	go m.loop(ctx)
}

// Stop signals the probe loop to exit. Safe to call more than once.
func (m *Monitor) Stop() {
	m.stopOnce.Do(func() { close(m.stopCh) })
}

// ControlPlane reports the cached control-plane verdict. The detail string
// is written verbatim into the public /health response body, so it names
// the condition and its duration only, never the error text, which can
// carry the control plane's URL or other internals.
func (m *Monitor) ControlPlane() (ok bool, detail string) {
	m.mu.Lock()
	last := m.lastSuccess
	m.mu.Unlock()
	elapsed := m.now().Sub(last)
	if elapsed <= m.unhealthyAfter {
		return true, "ok"
	}
	return false, fmt.Sprintf("unreachable for %ds", int(elapsed.Seconds()))
}

func (m *Monitor) loop(ctx context.Context) {
	m.probe(ctx)
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-m.stopCh:
			return
		case <-ticker.C:
			m.probe(ctx)
		}
	}
}

func (m *Monitor) probe(ctx context.Context) {
	if m.pinger == nil {
		return
	}
	probeCtx, cancel := context.WithTimeout(ctx, m.probeTimeout)
	defer cancel()
	if err := m.pinger.Health(probeCtx); err != nil {
		// The public detail string stays generic; the operator log gets
		// the real cause.
		m.logger.Warn("statusprobe_control_plane_unreachable", zap.Error(err))
		return
	}
	m.mu.Lock()
	m.lastSuccess = m.now()
	m.mu.Unlock()
}
