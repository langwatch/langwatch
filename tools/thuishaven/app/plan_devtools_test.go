package app

import (
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// devToolsPlan plans a stack whose two developer-tool hostnames have ports, so
// the lanes have something to bind, under the given selection.
func devToolsPlan(t *testing.T, sel domain.Selection) []Child {
	t.Helper()
	sel.BundledUI = true // the split lanes these tests name
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

// Both developer tools are haven's own lanes: the Storybook and the mail studio
// built to static files and served by this binary, never a dev server.
//
// @scenario "Adding both developer tools is one command and it sticks"
// @scenario "Every haven console is served built, never by a dev server"
func TestSelectedDeveloperToolsAreServedBuiltByHaven(t *testing.T) {
	sel := domain.DefaultSelection()
	sel.DesignSystem, sel.MailRoom = true, true
	children := devToolsPlan(t, sel)
	for lane, wants := range map[string][]string{
		"design-system": {"NX_LOAD_DOT_ENV_FILES=false pnpm --silent exec nx run @langwatch/design-system:build:storybook", "storybook-static", " static design-system ", "46006"},
		"mail-room":     {"NX_LOAD_DOT_ENV_FILES=false pnpm --silent exec nx run @langwatch/mail:build:studio", "packages/mail/preview/dist", " static mail-room ", "45566"},
	} {
		child, ok := findChild(children, lane)
		if !ok {
			t.Fatalf("no %s lane was planned for a worktree that selected it", lane)
		}
		for _, want := range wants {
			if !strings.Contains(child.Shell, want) {
				t.Errorf("%s lane runs %q, want it to contain %q", lane, child.Shell, want)
			}
		}
		if strings.Contains(child.Shell, "storybook dev") || strings.Contains(child.Shell, "--filter @langwatch/mail dev") {
			t.Errorf("%s lane runs a dev server: %q", lane, child.Shell)
		}
	}
	if !slices.Contains(domain.Stack{Slug: "test"}.OverlayEnv(), "LANGWATCH_SKIP_MAIL_PREVIEW=1") {
		t.Error("the ui lane would start the mail studio's dev server beside haven's lane")
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
