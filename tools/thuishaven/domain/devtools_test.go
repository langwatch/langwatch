package domain

import (
	"strings"
	"testing"
)

// @scenario "The developer tools are off until a worktree asks for them"
func TestDeveloperToolsAreOffByDefault(t *testing.T) {
	sel := DefaultSelection()
	if sel.Storybook {
		t.Error("the design system's Storybook is a tool, not a service — a fresh worktree must not start it")
	}
	if sel.Mail {
		t.Error("the mail studio is a tool, not a service — a fresh worktree must not start it")
	}

	// The status line is the only place the selection is discoverable, so an
	// unselected tool has to carry the exact command that adds it.
	got := sel.Describe()
	for _, want := range []string{"haven up +storybook", "haven up +mail"} {
		if !strings.Contains(got, want) {
			t.Errorf("Describe() = %q, want it to name %q", got, want)
		}
	}
}

// @scenario "Adding both developer tools is one command and it sticks"
func TestDeveloperToolDeltas(t *testing.T) {
	sel, err := ApplySelectionDeltas(DefaultSelection(), []string{"+storybook", "+mail"})
	if err != nil {
		t.Fatalf("+storybook +mail was rejected: %v", err)
	}
	if !sel.Storybook || !sel.Mail {
		t.Fatalf("got %+v, want both developer tools on", sel)
	}
	if !sel.Gateway || !sel.NLP {
		t.Error("adding a tool must leave the rest of the selection alone")
	}

	sel, err = ApplySelectionDeltas(sel, []string{"-storybook", "-mail"})
	if err != nil {
		t.Fatalf("-storybook -mail was rejected: %v", err)
	}
	if sel.Storybook || sel.Mail {
		t.Errorf("got %+v, want both developer tools off again", sel)
	}
}

// A tool the stack serves itself reads back as selected; one resolved to a
// baseline stack's copy does not — the same rule every other service follows,
// and what lets a plain `up` tell "already matches" from "needs a restart".
//
// @scenario "Adding both developer tools is one command and it sticks"
func TestDeveloperToolSelectionDerivesFromStack(t *testing.T) {
	local := Stack{Services: []Service{
		{Name: StorybookService, Port: 46006},
		{Name: MailService, Port: 45566},
	}}
	sel := SelectionFromStack(local)
	if !sel.Storybook || !sel.Mail {
		t.Errorf("got %+v, want both tools read back as running here", sel)
	}

	fallback := Stack{Services: []Service{
		{Name: StorybookService, Port: 46006, IsFallback: true},
		{Name: MailService, Port: 45566, IsFallback: true},
	}}
	sel = SelectionFromStack(fallback)
	if sel.Storybook || sel.Mail {
		t.Errorf("got %+v, want a baseline fallback to read back as not selected", sel)
	}
}

// @scenario "A selected developer tool is reached by hostname"
func TestDeveloperToolsAreRoutedHostnames(t *testing.T) {
	roles := map[string]bool{}
	for _, svc := range PerWorktreeServices {
		roles[svc.Name] = true
	}
	for _, name := range []string{StorybookService, MailService} {
		if !roles[name] {
			t.Fatalf("%q is not in PerWorktreeServices, so provision would never route %s.<slug>", name, name)
		}
	}

	n := DefaultNaming("localhost")
	if got := n.Hostname(StorybookService, "portless"); got != "design-system.portless.langwatch.localhost" {
		t.Errorf("Storybook hostname = %q, want design-system.<slug>", got)
	}
	if got := n.Hostname(MailService, "portless"); got != "mails.design-system.portless.langwatch.localhost" {
		t.Errorf("mail studio hostname = %q, want the studio under the design system", got)
	}
}

// Nobody should have to remember which spelling was chosen, so `ds` is the
// design system short form and the studio answers to both `mail` and `mails`
// under either. Every alias resolves to the same listener as the service's own
// hostname; only the canonical one is printed and linked.
//
// @scenario "A selected developer tool is reached by hostname"
func TestDeveloperToolHostAliases(t *testing.T) {
	n := DefaultNaming("localhost")
	hosts := func(service string) []string {
		var out []string
		for _, alias := range ServiceHostAliases[service] {
			out = append(out, n.Hostname(alias, "portless"))
		}
		return out
	}

	want := map[string][]string{
		StorybookService: {"ds.portless.langwatch.localhost"},
		MailService: {
			"mail.design-system.portless.langwatch.localhost",
			"mails.ds.portless.langwatch.localhost",
			"mail.ds.portless.langwatch.localhost",
		},
	}
	for service, wanted := range want {
		got := strings.Join(hosts(service), " ")
		for _, host := range wanted {
			if !strings.Contains(got, host) {
				t.Errorf("%s aliases = %q, want %q among them", service, got, host)
			}
		}
	}

	// An alias is an extra way in, never a second identity: the canonical
	// hostname must not be repeated as one of its own aliases.
	for service, aliases := range ServiceHostAliases {
		for _, alias := range aliases {
			if alias == service {
				t.Errorf("%q lists itself as an alias", service)
			}
		}
	}
}

// The hostname says design-system because that is what a person is looking at;
// every
// command a person TYPES says storybook, because that is the tool running. The
// two are joined here, so `haven logs storybook` and `haven restart storybook`
// name the same thing the supervisor labels.
//
// @scenario "A selected developer tool is reached by hostname"
func TestStorybookIsNamedStorybookOnTheCLI(t *testing.T) {
	if got := CLIServiceName(StorybookService); got != "storybook" {
		t.Errorf("CLIServiceName(%q) = %q, want storybook", StorybookService, got)
	}
	if got := CLIServiceName(MailService); got != "mail" {
		t.Errorf("CLIServiceName(%q) = %q, want mail", MailService, got)
	}
}

// @scenario "The application frames the Storybook the stack is already running"
func TestOverlayNamesTheStorybookPortOnlyWhenThereIsOne(t *testing.T) {
	base := Stack{Slug: "happy-tiger", APIPort: 41001, Services: []Service{{Name: "app", Port: 44000}}}

	t.Run("given a worktree running the Storybook lane", func(t *testing.T) {
		st := base
		st.Services = append(st.Services, Service{Name: StorybookService, Port: 46006})
		if got := valueOf(st.OverlayEnv(), "LANGWATCH_STORYBOOK_PORT"); got != "46006" {
			t.Fatalf("LANGWATCH_STORYBOOK_PORT = %q, want the port haven allocated — "+
				"otherwise the ui lane derives its own and starts a second Storybook", got)
		}
	})

	t.Run("given a worktree that did not select it", func(t *testing.T) {
		st := base
		st.Services = append(st.Services, Service{Name: StorybookService})
		if hasKey(st.OverlayEnv(), "LANGWATCH_STORYBOOK_PORT") {
			t.Fatal("a port-less Storybook must name no port; the ui lane keeps its own start-on-first-visit behavior")
		}
	})
}

// @scenario "A developer tool is not one of the three Node lanes"
func TestDeveloperToolsAreNotNodeLanes(t *testing.T) {
	st := Stack{APIPort: 41001, WorkerMetricsPort: 41002, Services: []Service{
		{Name: "app", Port: 44000},
		{Name: StorybookService, Port: 46006},
		{Name: MailService, Port: 45566},
	}}
	lanes := st.Lanes()
	if len(lanes) != 3 {
		t.Fatalf("Lanes() = %v, want exactly the three Node lanes", lanes)
	}
	names := []string{}
	for _, l := range lanes {
		names = append(names, l.Name)
		if l.Name == "storybook" || l.Name == "mail" {
			t.Errorf("%q is a developer tool, not a Node lane", l.Name)
		}
	}
	if strings.Join(names, ",") != "ui,api,workers" {
		t.Errorf("Lanes() = %v, want ui, api, workers", names)
	}
}
