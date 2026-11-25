package app

import (
	"context"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// downProxy is a proxy whose liveness a test sets, counting starts and stops.
type downProxy struct {
	fakeProxy
	running   bool
	ensured   int
	shutdowns int
}

func (p *downProxy) Running() bool      { return p.running }
func (p *downProxy) EnsureReady() error { p.ensured++; p.running = true; return nil }
func (p *downProxy) Shutdown() error    { p.shutdowns++; return nil }

func downOrchestrator(stacks []domain.Stack, proxy *downProxy) *Orchestrator {
	store := &fakeStore{stacks: stacks, slugCache: map[string]string{"/wt/a": "a"}}
	return &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming("")},
		store: store, sys: &fakeSystem{alive: map[int]bool{}}, proxy: proxy, log: zap.NewNop(),
	}
}

// @scenario "Taking one stack down leaves the shared proxy running"
func TestDownLeavesTheSharedProxyAlone(t *testing.T) {
	proxy := &downProxy{running: true}
	o := downOrchestrator([]domain.Stack{{Slug: "a"}, {Slug: "b"}}, proxy)

	if err := o.Down(context.Background(), UpParams{WorktreeDir: "/wt/a", IsLinkedWorktree: true}, true); err != nil {
		t.Fatalf("Down: %v", err)
	}
	if proxy.shutdowns != 0 {
		t.Errorf("down must never stop the shared proxy, got %d shutdowns", proxy.shutdowns)
	}
	if proxy.ensured != 0 {
		t.Errorf("a running proxy must be left alone, got %d starts", proxy.ensured)
	}
}

// @scenario "Taking one stack down leaves the shared proxy running"
func TestDownRestartsAProxyThatDiedWhileAnotherStackIsRegistered(t *testing.T) {
	proxy := &downProxy{running: false}
	o := downOrchestrator([]domain.Stack{{Slug: "a"}, {Slug: "b"}}, proxy)

	if err := o.Down(context.Background(), UpParams{WorktreeDir: "/wt/a", IsLinkedWorktree: true}, false); err != nil {
		t.Fatalf("Down: %v", err)
	}
	if proxy.ensured != 1 || proxy.shutdowns != 0 {
		t.Errorf("want one start and no stop, got starts=%d stops=%d", proxy.ensured, proxy.shutdowns)
	}
}

func TestDownDoesNotStartAProxyWhenNoStackRemains(t *testing.T) {
	proxy := &downProxy{running: false}
	o := downOrchestrator([]domain.Stack{{Slug: "a"}}, proxy)

	if err := o.Down(context.Background(), UpParams{WorktreeDir: "/wt/a", IsLinkedWorktree: true}, false); err != nil {
		t.Fatalf("Down: %v", err)
	}
	if proxy.ensured != 0 {
		t.Errorf("no stack left, so no proxy to keep, got %d starts", proxy.ensured)
	}
}

// @scenario "Bringing a stack up starts a missing proxy"
func TestUpStartsAMissingProxy(t *testing.T) {
	proxy := &downProxy{running: false}
	o := downOrchestrator(nil, proxy)

	if err := o.ensurePortlessProxy(); err != nil {
		t.Fatalf("ensurePortlessProxy: %v", err)
	}
	if proxy.ensured != 1 || !proxy.running {
		t.Errorf("up must start an absent proxy, starts=%d running=%v", proxy.ensured, proxy.running)
	}
}
