package domain

import (
	"strings"
	"testing"
)

// @scenario "The developer tools are off until a worktree asks for them"
func TestDeveloperToolsAreOffByDefault(t *testing.T) {
	sel := DefaultSelection()
	if sel.DesignSystem {
		t.Error("the design system's Storybook is a tool, not a service — a fresh worktree must not start it")
	}
	if sel.MailRoom {
		t.Error("the mail studio is a tool, not a service — a fresh worktree must not start it")
	}

	// The status line is the only place the selection is discoverable, so an
	// unselected tool has to carry the exact command that adds it.
	got := sel.Describe()
	for _, want := range []string{"haven up +design-system", "haven up +mail-room"} {
		if !strings.Contains(got, want) {
			t.Errorf("Describe() = %q, want it to name %q", got, want)
		}
	}
}

// @scenario "Adding both developer tools is one command and it sticks"
func TestDeveloperToolDeltas(t *testing.T) {
	sel, err := ApplySelectionDeltas(DefaultSelection(), []string{"+design-system", "+mail-room"})
	if err != nil {
		t.Fatalf("+design-system +mail-room was rejected: %v", err)
	}
	if !sel.DesignSystem || !sel.MailRoom {
		t.Fatalf("got %+v, want both developer tools on", sel)
	}
	if !sel.Gateway || !sel.NLP {
		t.Error("adding a tool must leave the rest of the selection alone")
	}

	sel, err = ApplySelectionDeltas(sel, []string{"-design-system", "-mail-room"})
	if err != nil {
		t.Fatalf("-design-system -mail-room was rejected: %v", err)
	}
	if sel.DesignSystem || sel.MailRoom {
		t.Errorf("got %+v, want both developer tools off again", sel)
	}
}

// The old spellings ("storybook", "mail") must be refused by name, the same
// way `haven up ±workers` is refused — naming the flag that replaced each one,
// rather than falling through to "unknown service" (a typo) or silently doing
// nothing.
//
// @scenario "A renamed developer-tool lane is refused by its old name"
func TestStorybookAndMailAreRefusedByTheirOldNames(t *testing.T) {
	cases := []struct {
		delta string
		want  string
	}{
		{"+storybook", "+design-system"},
		{"-storybook", "-design-system"},
		{"+mail", "+mail-room"},
		{"-mail", "-mail-room"},
	}
	for _, c := range cases {
		_, err := ApplySelectionDeltas(DefaultSelection(), []string{c.delta})
		if err == nil {
			t.Fatalf("%s was accepted; the lane was renamed", c.delta)
		}
		if !strings.Contains(err.Error(), c.want) {
			t.Errorf("%s error = %q, want it to name %q", c.delta, err, c.want)
		}
	}
}

// A tool the stack serves itself reads back as selected; one resolved to a
// baseline stack's copy does not — the same rule every other service follows,
// and what lets a plain `up` tell "already matches" from "needs a restart".
//
// @scenario "Adding both developer tools is one command and it sticks"
func TestDeveloperToolSelectionDerivesFromStack(t *testing.T) {
	local := Stack{Services: []Service{
		{Name: DesignSystemService, Port: 46006},
		{Name: MailRoomService, Port: 45566},
	}}
	sel := SelectionFromStack(local)
	if !sel.DesignSystem || !sel.MailRoom {
		t.Errorf("got %+v, want both tools read back as running here", sel)
	}

	fallback := Stack{Services: []Service{
		{Name: DesignSystemService, Port: 46006, IsFallback: true},
		{Name: MailRoomService, Port: 45566, IsFallback: true},
	}}
	sel = SelectionFromStack(fallback)
	if sel.DesignSystem || sel.MailRoom {
		t.Errorf("got %+v, want a baseline fallback to read back as not selected", sel)
	}
}

// @scenario "A selected developer tool is reached by hostname"
func TestDeveloperToolsAreRoutedHostnames(t *testing.T) {
	roles := map[string]bool{}
	for _, svc := range PerWorktreeServices {
		roles[svc.Name] = true
	}
	for _, name := range []string{DesignSystemService, MailRoomService} {
		if !roles[name] {
			t.Fatalf("%q is not in PerWorktreeServices, so provision would never route %s.<slug>", name, name)
		}
	}

	n := DefaultNaming("localhost")
	if got := n.Hostname(DesignSystemService, "portless"); got != "design-system.portless.langwatch.localhost" {
		t.Errorf("Storybook hostname = %q, want design-system.<slug>", got)
	}
	if got := n.Hostname(MailRoomService, "portless"); got != "mail-room.portless.langwatch.localhost" {
		t.Errorf("mail studio hostname = %q, want mail-room.<slug>", got)
	}
}

// Nobody should have to remember which spelling was chosen, so `ds` is the
// design system short form. The mail studio has no alias — its hostname is
// mail-room.<slug>, full stop. Every alias resolves to the same listener as
// the service's own hostname; only the canonical one is printed and linked.
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
		DesignSystemService: {"ds.portless.langwatch.localhost"},
	}
	for service, wanted := range want {
		got := strings.Join(hosts(service), " ")
		for _, host := range wanted {
			if !strings.Contains(got, host) {
				t.Errorf("%s aliases = %q, want %q among them", service, got, host)
			}
		}
	}
	if aliases := ServiceHostAliases[MailRoomService]; len(aliases) != 0 {
		t.Errorf("MailRoomService aliases = %v, want none — no compatibility aliases", aliases)
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

// The hostname and the CLI spelling are the same word for both developer
// tools now, so `haven logs design-system` and `haven restart mail-room` name
// exactly what the supervisor labels — no extra join is needed.
//
// @scenario "A selected developer tool is reached by hostname"
func TestDeveloperToolsAreNamedByTheirHostnameOnTheCLI(t *testing.T) {
	if got := CLIServiceName(DesignSystemService); got != "design-system" {
		t.Errorf("CLIServiceName(%q) = %q, want design-system", DesignSystemService, got)
	}
	if got := CLIServiceName(MailRoomService); got != "mail-room" {
		t.Errorf("CLIServiceName(%q) = %q, want mail-room", MailRoomService, got)
	}
}

// @scenario "The application frames the Storybook the stack is already running"
func TestOverlayNamesTheStorybookPortOnlyWhenThereIsOne(t *testing.T) {
	base := Stack{Slug: "happy-tiger", APIPort: 41001, Services: []Service{{Name: "app", Port: 44000}}}

	t.Run("given a worktree running the Storybook lane", func(t *testing.T) {
		st := base
		st.Services = append(st.Services, Service{Name: DesignSystemService, Port: 46006})
		if got := valueOf(st.OverlayEnv(), "LANGWATCH_STORYBOOK_PORT"); got != "46006" {
			t.Fatalf("LANGWATCH_STORYBOOK_PORT = %q, want the port haven allocated — "+
				"otherwise the ui lane derives its own and starts a second Storybook", got)
		}
	})

	t.Run("given a worktree that did not select it", func(t *testing.T) {
		st := base
		st.Services = append(st.Services, Service{Name: DesignSystemService})
		if hasKey(st.OverlayEnv(), "LANGWATCH_STORYBOOK_PORT") {
			t.Fatal("a port-less Storybook must name no port; the ui lane keeps its own start-on-first-visit behavior")
		}
	})
}

// @scenario "A developer tool is not one of the three Node lanes"
func TestDeveloperToolsAreNotNodeLanes(t *testing.T) {
	st := Stack{APIPort: 41001, WorkerMetricsPort: 41002, Services: []Service{
		{Name: "app", Port: 44000},
		{Name: DesignSystemService, Port: 46006},
		{Name: MailRoomService, Port: 45566},
	}}
	lanes := st.Lanes()
	if len(lanes) != 2 {
		t.Fatalf("Lanes() = %v, want exactly the two Node lanes", lanes)
	}
	names := []string{}
	for _, l := range lanes {
		names = append(names, l.Name)
		if l.Name == "design-system" || l.Name == "mail-room" {
			t.Errorf("%q is a developer tool, not a Node lane", l.Name)
		}
	}
	if strings.Join(names, ",") != "ui,backend" {
		t.Errorf("Lanes() = %v, want ui, backend", names)
	}
}
