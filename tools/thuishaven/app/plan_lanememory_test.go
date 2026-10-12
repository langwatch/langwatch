package app

import (
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestNodeLanesCarryTheirMemoryCeilings(t *testing.T) {
	caps := domain.LaneMemoryCaps{UIMB: 2048, APIMB: 2560, WorkerMB: 2560}
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir(), LaneMemory: caps}, proxy: stubProxy{}, store: &fakeStore{}}

	hmr := domain.DefaultSelection()
	hmr.Refresh = domain.RefreshHMR
	children := o.planChildren(domain.Stack{Slug: "b", WorktreeDir: repo, Refresh: domain.RefreshHMR}, PlanOptions{Selection: hmr, RepoRoot: repo}, repo)
	if ui, _ := findChild(children, "ui"); ui.MaxRSSBytes != 2<<30 {
		t.Errorf("ui lane: want 2 GiB, got %d", ui.MaxRSSBytes)
	}
	if api, _ := findChild(children, APILane); api.MaxRSSBytes != 5<<30 {
		t.Errorf("api lane (api and worker): want 5 GiB, got %d", api.MaxRSSBytes)
	}

	built := domain.DefaultSelection()
	children = o.planChildren(domain.Stack{Slug: "b", WorktreeDir: repo}, PlanOptions{Selection: built, RepoRoot: repo}, repo)
	if app, _ := findChild(children, AppLane); app.MaxRSSBytes != 0 {
		t.Errorf("built-UI app lane runs the UI build first: want no ceiling, got %d", app.MaxRSSBytes)
	}
}

func TestAnUncappedHalfLeavesTheSharedLaneUncapped(t *testing.T) {
	if got := (domain.LaneMemoryCaps{APIMB: 2560}).BackendBytes(); got != 0 {
		t.Fatalf("worker at 0 (off) should leave the api lane uncapped, got %d", got)
	}
}
