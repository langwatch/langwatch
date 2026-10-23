package app

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/semaphore"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// lanesSupervisor records the lanes Supervise was handed.
type lanesSupervisor struct {
	fakeSupervisor
	lanes []Child
}

func (s *lanesSupervisor) Supervise(_ context.Context, children []Child) {
	s.lanes = append(s.lanes, children...)
}

func docsSoloOrchestrator(t *testing.T, store *fakeStore, sys *fakeSystem) (*Orchestrator, *lanesSupervisor, *routingProxy) {
	t.Helper()
	sup, proxy := &lanesSupervisor{}, &routingProxy{}
	return &Orchestrator{
		cfg:   Config{Home: t.TempDir(), Naming: domain.DefaultNaming("")},
		sys:   sys,
		sup:   sup,
		proxy: proxy,
		store: store,
		sem:   &fakeSemaphore{},
		log:   zap.NewNop(),
	}, sup, proxy
}

// writeDocsOnly records a live docs-only run by pid in p's log directory.
func writeDocsOnly(t *testing.T, p UpParams, pid string) {
	t.Helper()
	logDir, _ := domain.StackLogPaths(p.WorktreeDir, p.ExplicitSlug)
	if err := os.MkdirAll(logDir, 0o750); err != nil {
		t.Fatal(err)
	}
	marker := `{"pid":` + pid + `,"url":"https://docs.feat-x.langwatch.localhost","logDir":"` + logDir + `"}`
	if err := os.WriteFile(filepath.Join(logDir, docsOnlyFile), []byte(marker), 0o600); err != nil {
		t.Fatal(err)
	}
}

// @scenario "The docs site runs alone without the stack"
func TestRunDocsSoloRunsOnlyTheDocsSite(t *testing.T) {
	o, sup, proxy := docsSoloOrchestrator(t, &fakeStore{}, &fakeSystem{})
	p := UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()}
	if err := o.RunDocsSolo(t.Context(), p); err != nil {
		t.Fatalf("RunDocsSolo: %v", err)
	}
	if len(sup.lanes) != 1 || !strings.Contains(sup.lanes[0].Shell, "--base-path /docs") ||
		!strings.HasSuffix(sup.lanes[0].Shell, " /docs") {
		t.Fatalf("supervised %v, want the docs built and mounted alone, with no app behind them", sup.lanes)
	}
	logDir, _ := domain.StackLogPaths(p.WorktreeDir, "feat-x")
	if sup.lanes[0].LogPath != filepath.Join(logDir, "docs.log") {
		t.Errorf("docs lane captures to %q, want docs.log in the worktree's log directory", sup.lanes[0].LogPath)
	}
	if !slices.Equal(proxy.registered, []string{"docs|feat-x", "app|feat-x"}) || len(proxy.removed) != 2 {
		t.Errorf("registered %v removed %v, want docs.feat-x and app.feat-x routed and removed on exit", proxy.registered, proxy.removed)
	}
	if _, ok := o.DocsOnly(p); ok {
		t.Error("the docs-only record outlived the run")
	}
}

func TestRunDocsSoloRefusesBesideARunningStack(t *testing.T) {
	store := &fakeStore{stacks: []domain.Stack{{Slug: "feat-x", LauncherPID: 42}}}
	o, sup, _ := docsSoloOrchestrator(t, store, &fakeSystem{alive: map[int]bool{42: true}})
	err := o.RunDocsSolo(t.Context(), UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "haven up +docs") || len(sup.lanes) != 0 {
		t.Fatalf("err %v, ran %v; want a refusal naming haven up +docs", err, sup.lanes)
	}
}

func TestRunDocsSoloRefusesASecondRun(t *testing.T) {
	o, sup, _ := docsSoloOrchestrator(t, &fakeStore{}, &fakeSystem{alive: map[int]bool{7: true}})
	p := UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()}
	writeDocsOnly(t, p, "7")
	if err := o.RunDocsSolo(t.Context(), p); err == nil || len(sup.lanes) != 0 {
		t.Fatalf("err %v, ran %v; want a refusal naming the running docs", err, sup.lanes)
	}
}

// @scenario "A stack refuses to start beside docs running alone"
func TestUpRefusesBesideDocsOnly(t *testing.T) {
	for _, withDocs := range []bool{false, true} {
		name := "without docs"
		if withDocs {
			name = "with docs"
		}
		t.Run(name, func(t *testing.T) {
			o, sup, proxy := docsSoloOrchestrator(t, &fakeStore{}, &fakeSystem{alive: map[int]bool{7: true}})
			o.cfg.PortlessDisabled = true
			p := UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()}
			writeDocsOnly(t, p, "7")
			err := o.Up(t.Context(), p, PlanOptions{Selection: domain.Selection{Docs: withDocs}})
			if err == nil || !strings.Contains(err.Error(), "haven down") || !strings.Contains(err.Error(), "pid 7") {
				t.Fatalf("Up = %v, want a refusal naming the live docs launcher and haven down", err)
			}
			if len(proxy.registered) != 0 || len(sup.lanes) != 0 || len(sup.shells) != 0 {
				t.Fatalf("registered %v and ran %v/%v beside solo docs", proxy.registered, sup.lanes, sup.shells)
			}
			sem := o.sem.(*fakeSemaphore)
			if sem.lastName != "up-feat-x" || sem.acquired != 1 || sem.released != 1 {
				t.Fatalf("startup lock = %+v, want the same per-slug lock taken and released once", sem)
			}
		})
	}
}

// @scenario "Cancelling docs startup during stack registration starts nothing"
func TestRunDocsSoloWaitsForStackRegistration(t *testing.T) {
	o, sup, proxy := docsSoloOrchestrator(t, &fakeStore{}, &fakeSystem{})
	sem := semaphore.New(t.TempDir())
	o.sem = sem
	release, _, err := sem.Acquire(t.Context(), "up-feat-x", 1)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	ctx, cancel := context.WithTimeout(t.Context(), 250*time.Millisecond)
	defer cancel()
	err = o.RunDocsSolo(ctx, UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("RunDocsSolo = %v, want cancellation while the stack registration lock is held", err)
	}
	if len(proxy.registered) != 0 || len(sup.lanes) != 0 {
		t.Fatalf("registered %v and ran %v before stack registration finished", proxy.registered, sup.lanes)
	}
}

type docsCleanupProxy struct {
	routingProxy
	recordPath             string
	recordPresentAtRemoval bool
}

func (p *docsCleanupProxy) Remove(service, slug string) {
	_, err := os.Stat(p.recordPath)
	p.recordPresentAtRemoval = err == nil
	p.routingProxy.Remove(service, slug)
}

// @scenario "Solo docs keep their startup claim until their route is removed"
func TestRunDocsSoloRemovesRouteBeforeStartupRecord(t *testing.T) {
	o, _, _ := docsSoloOrchestrator(t, &fakeStore{}, &fakeSystem{alive: map[int]bool{1: true}})
	p := UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()}
	logDir, _ := domain.StackLogPaths(p.WorktreeDir, p.ExplicitSlug)
	proxy := &docsCleanupProxy{recordPath: filepath.Join(logDir, docsOnlyFile)}
	o.proxy = proxy
	if err := o.RunDocsSolo(t.Context(), p); err != nil {
		t.Fatal(err)
	}
	if !proxy.recordPresentAtRemoval || len(proxy.removed) != 2 {
		t.Fatalf("removed %v with startup record present = %v, want the solo claim held through route cleanup", proxy.removed, proxy.recordPresentAtRemoval)
	}
	if _, ok := o.DocsOnly(p); ok {
		t.Fatal("the startup record outlived solo route cleanup")
	}
	sem := o.sem.(*fakeSemaphore)
	if sem.acquired != 1 || sem.released != 1 {
		t.Fatalf("startup lock = %+v, want it released exactly once", sem)
	}
}

func TestRunDocsSoloStopsWhenItCannotRecordTheRun(t *testing.T) {
	o, sup, proxy := docsSoloOrchestrator(t, &fakeStore{}, &fakeSystem{})
	p := UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()}
	logDir, _ := domain.StackLogPaths(p.WorktreeDir, p.ExplicitSlug)
	if err := os.MkdirAll(filepath.Dir(logDir), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(logDir, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	err := o.RunDocsSolo(t.Context(), p)
	if err == nil || !strings.Contains(err.Error(), "docs log directory") {
		t.Fatalf("RunDocsSolo = %v, want the failed docs-only record reported", err)
	}
	if len(sup.lanes) != 0 || len(proxy.removed) != len(proxy.registered) {
		t.Fatalf("ran %v, registered %v removed %v; want nothing started and every route removed", sup.lanes, proxy.registered, proxy.removed)
	}
}

func TestDocsOnlyReadsALiveRun(t *testing.T) {
	o, _, _ := docsSoloOrchestrator(t, &fakeStore{}, &fakeSystem{alive: map[int]bool{7: true}})
	p := UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()}
	writeDocsOnly(t, p, "7")
	run, ok := o.DocsOnly(p)
	if !ok || run.URL != "https://docs.feat-x.langwatch.localhost" || run.PID != 7 {
		t.Errorf("DocsOnly = %+v, %v", run, ok)
	}
}

func TestStopDocsOnlyTerminatesTheRun(t *testing.T) {
	sys := &fakeSystem{alive: map[int]bool{7: true}}
	o, _, _ := docsSoloOrchestrator(t, &fakeStore{}, sys)
	p := UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()}
	if o.StopDocsOnly(t.Context(), p) {
		t.Fatal("StopDocsOnly reported a run where none was recorded")
	}
	writeDocsOnly(t, p, "7")
	if !o.StopDocsOnly(t.Context(), p) {
		t.Fatal("StopDocsOnly missed the recorded run")
	}
	if len(sys.terminated) != 1 || sys.terminated[0] != 7 {
		t.Errorf("terminated %v, want the docs-only launcher", sys.terminated)
	}
}

// docsRouteProxy records where each hostname was last routed; provision routes in parallel.
type docsRouteProxy struct {
	fakeProxy
	mu     sync.Mutex
	routes map[string]int
}

func (p *docsRouteProxy) Register(service, slug string, port int) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.routes[service+"|"+slug] = port
	return nil
}

// @scenario "The docs site is built and mounted at /docs on the app"
func TestAppHostnameRoutesThroughTheDocsMountOnlyWithTheDocsOn(t *testing.T) {
	for _, docs := range []bool{false, true} {
		proxy := &docsRouteProxy{routes: map[string]int{}}
		o := &Orchestrator{
			cfg:   Config{Naming: domain.DefaultNaming("")},
			store: &fakeStore{slugCache: map[string]string{"/wt/x": "x"}}, sys: &playPortSystem{}, proxy: proxy, log: zap.NewNop(),
		}
		sel := domain.DefaultSelection()
		sel.Docs = docs
		st, cleanup, err := o.provision(t.Context(), UpParams{WorktreeDir: "/wt/x", IsLinkedWorktree: true, Branch: "x"}, PlanOptions{Selection: sel}, false)
		if err != nil {
			t.Fatalf("provision: %v", err)
		}
		cleanup()
		app, _ := serviceByName(st.Services, "app")
		docsSvc, _ := serviceByName(st.Services, domain.DocsService)
		want := app.Port
		if docs {
			want = docsSvc.Port
		}
		if got := proxy.routes["app|x"]; got != want || app.RouteTarget() != want || want == 0 {
			t.Errorf("docs on = %v: app.x routes to %d (target %d), want %d", docs, got, app.RouteTarget(), want)
		}
		if docs && app.Port == docsSvc.Port {
			t.Error("the mount must hand app paths to the app's own port, not itself")
		}
	}
}
