package app

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// devToolsPlan plans a stack whose two developer-tool hostnames have ports, so
// the lanes have something to bind, under the given selection.
func devToolsPlan(t *testing.T, sel domain.Selection) []Child {
	t.Helper()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	st := domain.Stack{Slug: "test", Services: []domain.Service{
		{Name: domain.DesignSystemService, Port: 46006},
		{Name: domain.MailRoomService, Port: 45566},
	}}
	return o.planChildren(st, PlanOptions{Selection: sel}, t.TempDir())
}

func findChild(children []Child, name string) (Child, bool) {
	for _, c := range children {
		if c.Name == name {
			return c, true
		}
	}
	return Child{}, false
}

// @scenario "The developer tools are off until a worktree asks for them"
func TestDeveloperToolLanesAreNotPlannedByDefault(t *testing.T) {
	children := devToolsPlan(t, domain.DefaultSelection())
	for _, lane := range []string{"design-system", "mail-room"} {
		if _, ok := findChild(children, lane); ok {
			t.Errorf("the %q lane was planned for a worktree that never asked for it", lane)
		}
	}
}

// The UI's dev server, not haven, starts each tool on its first visit and stops
// it once idle (apps/ui/vite/dormant-dev-tool.ts), so `pnpm dev` gets the same
// behaviour. Selecting a tool only routes its hostname to the port the ui lane
// is told to hold.
//
// @scenario "Adding both developer tools is one command and it sticks"
func TestSelectedDeveloperToolsAreNotHavenLanes(t *testing.T) {
	sel := domain.DefaultSelection()
	sel.DesignSystem, sel.MailRoom = true, true
	children := devToolsPlan(t, sel)

	for _, lane := range []string{"design-system", "mail-room"} {
		if child, ok := findChild(children, lane); ok {
			t.Errorf("haven planned a %q lane running %q; the ui lane's dev server owns the tool", lane, child.Shell)
		}
	}
}

// A stack that planned one of the two Node lanes boots and serves pages while
// quietly processing no jobs — so a developer tool must never be mistaken for
// one. Selecting both leaves ui and backend exactly as they were.
//
// @scenario "A developer tool is not one of the three Node lanes"
func TestDeveloperToolsDoNotDisturbTheThreeNodeLanes(t *testing.T) {
	sel := domain.DefaultSelection()
	sel.DesignSystem, sel.MailRoom = true, true
	children := devToolsPlan(t, sel)

	for lane, pkg := range map[string]string{"ui": UIPackage, APILane: BackendPackage} {
		child, ok := findChild(children, lane)
		if !ok {
			t.Fatalf("no %q lane was planned; every stack runs both", lane)
		}
		if !strings.Contains(child.Shell, pkg) {
			t.Errorf("%s lane runs %q, want it to filter %s", lane, child.Shell, pkg)
		}
	}
	// And a red prefix stays reserved for real failures.
	for _, c := range children {
		if c.Color == "31" {
			t.Errorf("lane %q uses red; red is reserved for real errors", c.Name)
		}
	}
}
