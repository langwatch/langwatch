package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func docsSoloOrchestrator(t *testing.T, store *fakeStore, sys *fakeSystem) (*Orchestrator, *fakeSupervisor, *routingProxy) {
	t.Helper()
	sup, proxy := &fakeSupervisor{}, &routingProxy{}
	return &Orchestrator{
		cfg:   Config{Home: t.TempDir(), Naming: domain.DefaultNaming("")},
		sys:   sys,
		sup:   sup,
		proxy: proxy,
		store: store,
		log:   zap.NewNop(),
	}, sup, proxy
}

// @scenario "The docs site runs alone without the stack"
func TestRunDocsSoloRunsOnlyTheDocsSite(t *testing.T) {
	o, sup, proxy := docsSoloOrchestrator(t, &fakeStore{}, &fakeSystem{})
	p := UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()}
	if err := o.RunDocsSolo(t.Context(), p); err != nil {
		t.Fatalf("RunDocsSolo: %v", err)
	}
	if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "--filter @langwatch/docs-site dev") {
		t.Fatalf("ran %v, want the docs dev server alone", sup.shells)
	}
	if len(proxy.registered) != 1 || proxy.registered[0] != "docs|feat-x" || len(proxy.removed) != 1 {
		t.Errorf("registered %v removed %v, want docs.feat-x routed and removed on exit", proxy.registered, proxy.removed)
	}
	if o.DocsOnlyURL(p) != "" {
		t.Error("the docs-only record outlived the run")
	}
}

func TestRunDocsSoloRefusesBesideARunningStack(t *testing.T) {
	store := &fakeStore{stacks: []domain.Stack{{Slug: "feat-x", LauncherPID: 42}}}
	o, sup, _ := docsSoloOrchestrator(t, store, &fakeSystem{alive: map[int]bool{42: true}})
	err := o.RunDocsSolo(t.Context(), UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()})
	if err == nil || !strings.Contains(err.Error(), "haven up +docs") || len(sup.shells) != 0 {
		t.Fatalf("err %v, ran %v; want a refusal naming haven up +docs", err, sup.shells)
	}
}

func TestDocsOnlyURLReadsALiveRun(t *testing.T) {
	o, _, _ := docsSoloOrchestrator(t, &fakeStore{}, &fakeSystem{alive: map[int]bool{7: true}})
	p := UpParams{ExplicitSlug: "feat-x", WorktreeDir: t.TempDir()}
	logDir, _ := domain.StackLogPaths(p.WorktreeDir, "feat-x")
	if err := os.MkdirAll(logDir, 0o750); err != nil {
		t.Fatal(err)
	}
	marker := `{"pid":7,"url":"https://docs.feat-x.langwatch.localhost"}`
	if err := os.WriteFile(filepath.Join(logDir, docsOnlyFile), []byte(marker), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := o.DocsOnlyURL(p); got != "https://docs.feat-x.langwatch.localhost" {
		t.Errorf("DocsOnlyURL = %q", got)
	}
}
