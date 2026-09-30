package app

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"sync/atomic"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// overlapProxy records whether a second route registration arrived while the
// first was still in flight: the first call waits for one, up to two seconds.
type overlapProxy struct {
	fakeProxy
	calls      atomic.Int32
	arrived    chan struct{}
	overlapped atomic.Bool
}

func (p *overlapProxy) Register(string, string, int) error {
	if p.calls.Add(1) == 1 {
		select {
		case <-p.arrived:
			p.overlapped.Store(true)
		case <-time.After(2 * time.Second):
		}
		return nil
	}
	select {
	case p.arrived <- struct{}{}:
	default:
	}
	return nil
}

// @scenario "A stack's routes are registered side by side"
func TestProvisionRegistersRoutesInParallel(t *testing.T) {
	proxy := &overlapProxy{arrived: make(chan struct{}, 1)}
	o := &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming("")},
		store: &fakeStore{slugCache: map[string]string{"/wt/x": "x"}}, sys: &playPortSystem{}, proxy: proxy, log: zap.NewNop(),
	}
	p := UpParams{WorktreeDir: "/wt/x", IsLinkedWorktree: true, Branch: "x"}

	_, cleanup, err := o.provision(context.Background(), p, PlanOptions{Selection: domain.DefaultSelection()}, false)
	if err != nil {
		t.Fatalf("provision: %v", err)
	}
	defer cleanup()

	if proxy.calls.Load() < 2 {
		t.Fatalf("registered %d routes, want every routed service", proxy.calls.Load())
	}
	if !proxy.overlapped.Load() {
		t.Error("route registrations ran one after another; each is a CLI start, so they must run side by side")
	}
}

// @scenario "The one-shot jobs reuse the stack's Node compile cache"
func TestPrepareJobsShareTheStackCompileCache(t *testing.T) {
	home, wt := t.TempDir(), t.TempDir()
	// An install stamp newer than the lockfile, so no install runs.
	lock := filepath.Join(wt, "pnpm-lock.yaml")
	stamp := filepath.Join(wt, "node_modules", ".modules.yaml")
	if err := os.MkdirAll(filepath.Dir(stamp), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{lock, stamp} {
		if err := os.WriteFile(f, nil, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	past := time.Now().Add(-time.Hour)
	if err := os.Chtimes(lock, past, past); err != nil {
		t.Fatal(err)
	}
	sup := &fakeSupervisor{}
	o := &Orchestrator{cfg: Config{Home: home, Naming: domain.DefaultNaming("")}, sup: sup, sys: &fakeSystem{}, log: zap.NewNop()}

	if err := o.prepareWorktree(context.Background(), UpParams{WorktreeDir: wt}, domain.Stack{Slug: "feat-x", WorktreeDir: wt}); err != nil {
		t.Fatalf("prepareWorktree: %v", err)
	}

	want := "NODE_COMPILE_CACHE=" + filepath.Join(home, "node-compile-cache", "feat-x")
	if len(sup.shells) < 2 {
		t.Fatalf("ran %v, want at least codegen and prepare", sup.shells)
	}
	for i, shell := range sup.shells {
		if !slices.Contains(sup.envs[i], want) {
			t.Errorf("%q ran without the stack's compile cache (%s)", shell, want)
		}
	}
}
