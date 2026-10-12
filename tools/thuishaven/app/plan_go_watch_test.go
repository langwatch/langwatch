package app

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "A watched go lane runs haven's own Go watch, not air"
func TestWatchedGoLaneRunsHavensGoWatch(t *testing.T) {
	repo := t.TempDir()
	o := &Orchestrator{cfg: Config{Home: t.TempDir(), GoWatchArgv: []string{"/opt/haven", "go-watch"}}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "branch", WorktreeDir: repo}
	for _, watch := range []bool{false, true} {
		children := o.planChildren(st, PlanOptions{Selection: domain.DefaultSelection(), RepoRoot: repo, ShouldGoWatch: watch}, repo)
		child, ok := findChild(children, GoLane)
		if !ok {
			t.Fatalf("no go lane with watch=%v", watch)
		}
		if strings.Contains(child.Shell, "service-watch") {
			t.Fatalf("go lane still runs air: %s", child.Shell)
		}
		isWatch := strings.Contains(child.Shell, "exec '/opt/haven' 'go-watch' '.bin/combined/go' 'aigateway'")
		if isWatch != watch {
			t.Fatalf("watch=%v but go lane shell is %s", watch, child.Shell)
		}
	}
}
