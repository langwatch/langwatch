package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"

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
	if len(sup.lanes) != 1 || !strings.Contains(sup.lanes[0].Shell, "--filter @langwatch/docs-site dev") {
		t.Fatalf("supervised %v, want the docs dev server alone", sup.lanes)
	}
	logDir, _ := domain.StackLogPaths(p.WorktreeDir, "feat-x")
	if sup.lanes[0].LogPath != filepath.Join(logDir, "docs.log") {
		t.Errorf("docs lane captures to %q, want docs.log in the worktree's log directory", sup.lanes[0].LogPath)
	}
	if len(proxy.registered) != 1 || proxy.registered[0] != "docs|feat-x" || len(proxy.removed) != 1 {
		t.Errorf("registered %v removed %v, want docs.feat-x routed and removed on exit", proxy.registered, proxy.removed)
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
