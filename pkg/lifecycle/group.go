package lifecycle

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
)

const (
	defaultGraceful   = 10 * time.Second
	defaultDrainDelay = 3 * time.Second
)

// Group manages ordered start/stop of services with graceful shutdown.
//
// Shutdown sequence (K8s-friendly):
//  1. SIGTERM/SIGINT, context cancellation, or fatal service error
//  2. Health registry marked draining (/readyz → 503)
//  3. Drain delay waits for load balancer to remove the pod
//  4. Services stopped in reverse registration order
type Group struct {
	logger     *zap.Logger
	health     *health.Registry
	services   []Service
	graceful   time.Duration
	drainDelay time.Duration
}

// Option configures a Group.
type Option func(*Group)

// WithGraceful sets the total shutdown timeout budget.
func WithGraceful(d time.Duration) Option {
	return func(g *Group) { g.graceful = d }
}

// WithDrainDelay sets the pause between marking draining and stopping services.
// This gives the load balancer time to remove the pod from endpoints.
func WithDrainDelay(d time.Duration) Option {
	return func(g *Group) { g.drainDelay = d }
}

// WithHealth sets the health registry for drain signaling.
func WithHealth(r *health.Registry) Option {
	return func(g *Group) { g.health = r }
}

// New creates a lifecycle Group.
func New(logger *zap.Logger, opts ...Option) *Group {
	g := &Group{
		logger:     logger,
		graceful:   defaultGraceful,
		drainDelay: defaultDrainDelay,
	}
	for _, o := range opts {
		o(g)
	}
	return g
}

// Add registers services. They start in order and stop in reverse.
func (g *Group) Add(svcs ...Service) {
	g.services = append(g.services, svcs...)
}

// Run starts all services, blocks until a shutdown trigger fires,
// then orchestrates graceful shutdown.
func (g *Group) Run(ctx context.Context) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	// Start services in registration order.
	started := 0
	for _, svc := range g.services {
		g.logger.Info("lifecycle_start", zap.Stringer("service", svc))
		if err := svc.Start(ctx); err != nil {
			cancel()
			g.stopN(context.Background(), started)
			return fmt.Errorf("start %s: %w", svc, err)
		}
		started++
	}

	// Merge fatal channels from services that can fail after Start.
	fatal := g.mergeFatal()

	// Wait for shutdown trigger.
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sig)

	var fatalErr error
	select {
	case s := <-sig:
		g.logger.Info("lifecycle_signal", zap.String("signal", s.String()))
	case err := <-fatal:
		fatalErr = err
		g.logger.Error("lifecycle_fatal", zap.Error(err))
	case <-ctx.Done():
		g.logger.Info("lifecycle_context_done")
	}

	// Cancel the services' context.
	cancel()

	shutCtx, shutCancel := context.WithTimeout(context.Background(), g.graceful)
	defer shutCancel()

	// Mark draining so /readyz returns 503.
	if g.health != nil {
		g.health.MarkDraining()
		g.logger.Info("lifecycle_draining")
	}

	// Pause for LB to remove the pod from endpoints.
	if g.drainDelay > 0 {
		g.logger.Info("lifecycle_drain_delay", zap.Duration("wait", g.drainDelay))
		select {
		case <-time.After(g.drainDelay):
		case <-shutCtx.Done():
		}
	}

	stopErr := g.stopN(shutCtx, started)

	if fatalErr != nil {
		return fatalErr
	}
	return stopErr
}

// stopN stops the first n services in reverse order.
func (g *Group) stopN(ctx context.Context, n int) error {
	var first error
	for i := n - 1; i >= 0; i-- {
		svc := g.services[i]
		g.logger.Info("lifecycle_stop", zap.Stringer("service", svc))
		if err := svc.Stop(ctx); err != nil {
			g.logger.Warn("lifecycle_stop_error",
				zap.Stringer("service", svc), zap.Error(err))
			if first == nil {
				first = fmt.Errorf("stop %s: %w", svc, err)
			}
		}
	}
	return first
}

// mergeFatal fans-in Fatal() channels from all registered services.
func (g *Group) mergeFatal() <-chan error {
	out := make(chan error, 1)
	for _, svc := range g.services {
		fr, ok := svc.(fatalReporter)
		if !ok {
			continue
		}
		go func(ch <-chan error) {
			if err, ok := <-ch; ok {
				select {
				case out <- err:
				default:
				}
			}
		}(fr.Fatal())
	}
	return out
}
