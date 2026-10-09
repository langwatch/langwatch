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

// The design system is haven's own lane: its Storybook built to static files and
// served by this binary, never `storybook dev`. The mail studio still lives in the
// ui lane's dev server (apps/ui/vite/mail-preview.ts), so haven plans no lane for it.
//
// @scenario "Adding both developer tools is one command and it sticks"
// @scenario "Every haven console is served built, never by a dev server"
func TestSelectedStorybookIsServedBuiltByHaven(t *testing.T) {
	sel := domain.DefaultSelection()
	sel.DesignSystem, sel.MailRoom = true, true
	children := devToolsPlan(t, sel)

	ds, ok := findChild(children, "design-system")
	if !ok {
		t.Fatal("no design-system lane was planned for a worktree that selected it")
	}
	for _, want := range []string{"build:storybook", "storybook-static", " static design-system ", "46006"} {
		if !strings.Contains(ds.Shell, want) {
			t.Errorf("design-system lane runs %q, want it to contain %q", ds.Shell, want)
		}
	}
	if strings.Contains(ds.Shell, "storybook dev") || strings.Contains(ds.Shell, " storybook --port") {
		t.Errorf("design-system lane runs a dev server: %q", ds.Shell)
	}
	if child, ok := findChild(children, "mail-room"); ok {
		t.Errorf("haven planned a mail-room lane running %q; the ui lane's dev server owns the studio", child.Shell)
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
