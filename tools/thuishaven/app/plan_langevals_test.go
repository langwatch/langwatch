package app

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func langevalsPlan(t *testing.T, sel domain.Selection, repo string) []Child {
	t.Helper()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "test", Services: []domain.Service{{Name: domain.LangevalsService, Port: 45562}}}
	return o.planChildren(st, PlanOptions{Selection: sel}, repo, "")
}

// @scenario "Langevals is off until a worktree asks for it"
func TestLangevalsLaneIsNotPlannedByDefault(t *testing.T) {
	if _, ok := findChild(langevalsPlan(t, domain.DefaultSelection(), t.TempDir()), "langevals"); ok {
		t.Error("the langevals lane was planned for a worktree that never asked for it")
	}
}

// @scenario "A stack running langevals points the app at it"
func TestLangevalsLaneRunsTheCheckoutsServiceOnItsPortAndEveryLaneIsPointedAtIt(t *testing.T) {
	repo := t.TempDir()
	sel := domain.DefaultSelection()
	sel.Langevals = true
	children := langevalsPlan(t, sel, repo)
	lane, ok := findChild(children, "langevals")
	if !ok {
		t.Fatal("no langevals lane was planned for a selection that asked for one")
	}
	if lane.Dir != filepath.Join(repo, "services", "langevals") {
		t.Errorf("langevals lane runs in %q, want the checkout's services/langevals", lane.Dir)
	}
	if !strings.Contains(lane.Shell, "uv run") || !strings.Contains(lane.Shell, "langevals/server.py") {
		t.Errorf("langevals lane runs %q, want uv running the server", lane.Shell)
	}
	if !slices.Contains(lane.Env, "PORT=45562") {
		t.Errorf("langevals lane env %v does not bind the allocated port", lane.Env)
	}
	for _, name := range []string{APILane, GoLane} {
		child, ok := findChild(children, name)
		if !ok {
			t.Fatalf("no %s lane planned", name)
		}
		if !slices.Contains(child.Env, "LANGEVALS_ENDPOINT=http://127.0.0.1:45562") {
			t.Errorf("the %s lane is not pointed at this stack's langevals", name)
		}
	}
}
