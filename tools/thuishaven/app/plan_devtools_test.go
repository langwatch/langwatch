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
		{Name: domain.StorybookService, Port: 46006},
		{Name: domain.MailService, Port: 45566},
	}}
	return o.planChildren(st, PlanOptions{Selection: sel}, t.TempDir(), "")
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
	for _, lane := range []string{"storybook", "mail"} {
		if _, ok := findChild(children, lane); ok {
			t.Errorf("the %q lane was planned for a worktree that never asked for it", lane)
		}
	}
}

// Each tool is handed the port haven allocated for its hostname, because both
// otherwise bind a fixed default (6006, 5566) that a second worktree would find
// busy — and vite, left to itself, quietly moves to the next free port, leaving
// the routed hostname pointing at nothing.
//
// @scenario "Adding both developer tools is one command and it sticks"
func TestDeveloperToolLanesRunTheirOwnPackageOnTheAllocatedPort(t *testing.T) {
	sel := domain.DefaultSelection()
	sel.Storybook, sel.Mail = true, true
	children := devToolsPlan(t, sel)

	t.Run("when the Storybook lane is selected", func(t *testing.T) {
		child, ok := findChild(children, "storybook")
		if !ok {
			t.Fatal("no storybook lane was planned for a selection that asked for one")
		}
		for _, want := range []string{DesignSystemPackage, "storybook", "--port 46006", "--ci"} {
			if !strings.Contains(child.Shell, want) {
				t.Errorf("storybook lane runs %q, want %q in it", child.Shell, want)
			}
		}
	})

	t.Run("when the mail studio lane is selected", func(t *testing.T) {
		child, ok := findChild(children, "mail")
		if !ok {
			t.Fatal("no mail lane was planned for a selection that asked for one")
		}
		for _, want := range []string{MailPackage, "dev", "--port 45566", "--strictPort"} {
			if !strings.Contains(child.Shell, want) {
				t.Errorf("mail lane runs %q, want %q in it", child.Shell, want)
			}
		}
	})
}

// Both tools load the stack's own environment, so the studio renders templates
// against this worktree's URLs rather than whatever a bare .env last said.
//
// @scenario "Adding both developer tools is one command and it sticks"
func TestDeveloperToolLanesCarryTheStackEnvironment(t *testing.T) {
	sel := domain.DefaultSelection()
	sel.Storybook, sel.Mail = true, true
	children := devToolsPlan(t, sel)

	for _, lane := range []string{"storybook", "mail"} {
		child, ok := findChild(children, lane)
		if !ok {
			t.Fatalf("no %q lane was planned", lane)
		}
		env := strings.Join(child.Env, "\n")
		for _, want := range []string{"LANGWATCH_SLUG=test", "NODE_ENV=development"} {
			if !strings.Contains(env, want) {
				t.Errorf("%s lane env %v lacks %q", lane, child.Env, want)
			}
		}
	}
}

// A stack that planned two of the three Node lanes boots, serves pages and
// quietly processes no jobs — so a developer tool must never be mistaken for
// one. Selecting both leaves ui, api and workers exactly as they were.
//
// @scenario "A developer tool is not one of the three Node lanes"
func TestDeveloperToolsDoNotDisturbTheThreeNodeLanes(t *testing.T) {
	sel := domain.DefaultSelection()
	sel.Storybook, sel.Mail = true, true
	children := devToolsPlan(t, sel)

	for lane, pkg := range map[string]string{"ui": UIPackage, "api": APIPackage, "workers": WorkerPackage} {
		child, ok := findChild(children, lane)
		if !ok {
			t.Fatalf("no %q lane was planned; every stack runs all three", lane)
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
