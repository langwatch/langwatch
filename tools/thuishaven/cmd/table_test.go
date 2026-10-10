package cmd

import (
	"context"
	"strings"
	"testing"
)

// allSpecs is every command, groups and their subcommands included.
func allSpecs() []commandSpec {
	out := make([]commandSpec, 0, len(tableByName))
	for _, spec := range tableByName {
		out = append(out, spec)
	}
	return out
}

func specByName(t *testing.T, name string) commandSpec {
	t.Helper()
	spec, ok := tableByName[name]
	if !ok {
		t.Fatalf("no command %q in the table", name)
	}
	return spec
}

// @scenario "A flag shorthand means one thing across the whole CLI"
func TestEveryShortFlagMeansOneThing(t *testing.T) {
	meaning := map[string]string{}
	for _, spec := range allSpecs() {
		for _, f := range spec.flags {
			if f.short == "" {
				continue
			}
			if prior, seen := meaning[f.short]; seen && prior != f.long {
				t.Errorf("short flag %q means %q on one command and %q on another — a shorthand has ONE meaning", f.short, prior, f.long)
			}
			meaning[f.short] = f.long
		}
	}
}

// @scenario "A flag shorthand means one thing across the whole CLI"
func TestLongFlagsAgreeOnValueTaking(t *testing.T) {
	takes := map[string]bool{}
	for _, spec := range allSpecs() {
		for _, f := range spec.flags {
			if prior, seen := takes[f.long]; seen && prior != f.takesValue {
				t.Errorf("flag %q takes a value on one command but not another", f.long)
			}
			takes[f.long] = f.takesValue
		}
	}
}

// @scenario "A retired spelling exits 64 with the exact new spelling"
func TestRetiredSpellingsExitWithTheNewSpelling(t *testing.T) {
	for spelling, now := range retired {
		err := deps{}.dispatch(context.Background(), spelling, nil)
		if ExitCode(err) != exitUsage {
			t.Fatalf("retired spelling %q exited %d (%v), want %d", spelling, ExitCode(err), err, exitUsage)
		}
		want := "removed, no replacement"
		if now != nil {
			want = "now: haven " + strings.Join(now(nil), " ")
		}
		if !strings.Contains(err.Error(), want) {
			t.Errorf("retired spelling %q answered %q, want it to say %q", spelling, err, want)
		}
	}
}

// @scenario "A retired spelling exits 64 with the exact new spelling"
func TestRetiredSpellingsAreNotCommands(t *testing.T) {
	for spelling := range retired {
		if _, ok := tableByName[spelling]; ok {
			t.Errorf("%q is both a retired spelling and a live command", spelling)
		}
	}
}

// @scenario "The pointer carries the caller's arguments over"
func TestRetiredPointerCarriesTheArguments(t *testing.T) {
	cases := map[string]struct {
		argv []string
		want string
	}{
		"a simulator's list": {[]string{"mail", "list", "--to", "a@b.test", "--json"}, "now: haven sim mail list --to a@b.test --json"},
		"a renamed sim verb": {[]string{"llm", "calls"}, "now: haven sim llm list"},
		"set --error":        {[]string{"mail", "set", "--error", "503"}, "now: haven sim mail fault 503"},
		"destroy":            {[]string{"destroy", "feat-x"}, "now: haven down --destroy --stack feat-x"},
		"play":               {[]string{"play", "4913"}, "now: haven pr 4913 --throwaway"},
		"seed status":        {[]string{"seed", "status"}, "now: haven db status"},
		"auth":               {[]string{"auth", "admin"}, "now: haven browser login --as admin"},
		"gateway":            {[]string{"gateway", "GET", "/v1/models"}, "now: haven api GET /v1/models --gateway"},
		"a group's old verb": {[]string{"sim", "payment", "clear-failures"}, "now: haven sim payment fault off"},
		"an idp tamper":      {[]string{"idp", "tamper", "acme", "none"}, "now: haven sim idp fault acme off"},
		"logs -t":            {[]string{"logs", "nlp", "-t"}, "now: haven logs nlp -f"},
		"up -f":              {[]string{"up", "-f"}, "now: haven up --force"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			err := deps{}.dispatch(context.Background(), c.argv[0], c.argv[1:])
			if ExitCode(err) != exitUsage || !strings.Contains(err.Error(), c.want) {
				t.Errorf("haven %s = %d %v, want 64 and %q", strings.Join(c.argv, " "), ExitCode(err), err, c.want)
			}
		})
	}
}

// @scenario "An unknown command fails with a pointer, not a guess"
func TestUnknownCommandSuggestsNearMisses(t *testing.T) {
	if code := ExitCode(deps{}.dispatch(context.Background(), "upp", nil)); code != exitUsage {
		t.Errorf("an unknown command exited %d, want %d", code, exitUsage)
	}
	got := closestCommands("upp")
	found := false
	for _, s := range got {
		if s == "up" {
			found = true
		}
	}
	if !found {
		t.Errorf("closestCommands(upp) = %v, want it to include %q", got, "up")
	}
}

// --force means one thing, forcing the lifecycle, only on up and down and
// only in its long form: -f is logs' --follow.
// @scenario "A flag shorthand means one thing across the whole CLI"
func TestForceIsLifecycleOnly(t *testing.T) {
	allowed := map[string]bool{"up": true, "down": true}
	for _, spec := range allSpecs() {
		for _, f := range spec.flags {
			if f.long == "--force" && (!allowed[spec.display()] || f.short != "") {
				t.Errorf("haven %s declares %s/--force — only up/down force their lifecycle, long form only", spec.display(), f.short)
			}
		}
	}
}

// The play half of the constitution: teardown destruction is disclosed up
// front (in the summary the help renders), not confirmed at the end — so play
// carries neither --yes (nothing to confirm: the data is ephemeral by
// contract) nor --force (lifecycle-only, up/down). Its one risk flag,
// --allow-untrusted, is about running code, not about data.
// @scenario "Destruction is disclosed up front, not confirmed at the end"
func TestPlayDisclosesDestructionInsteadOfConfirming(t *testing.T) {
	spec := specByName(t, "pr")
	if !strings.Contains(strings.ToLower(spec.summary), "destroy") {
		t.Errorf("pr's summary %q must disclose that quitting destroys everything", spec.summary)
	}
	for _, f := range spec.flags {
		if f.long == "--yes" || f.long == "--force" {
			t.Errorf("pr declares %s — teardown is disclosed up front, never confirmed or forced", f.long)
		}
	}
}

// @scenario "Agent mode never prompts about trust"
func TestAllowUntrustedIsDeclaredOnPlay(t *testing.T) {
	found := false
	for _, f := range specByName(t, "pr").flags {
		if f.long == "--allow-untrusted" {
			found = true
			if f.short != "" {
				t.Errorf("--allow-untrusted must have no shorthand — accepting untrusted code is typed out in full")
			}
		}
	}
	if !found {
		t.Error("pr does not declare --allow-untrusted — agent mode would have no way to proceed")
	}
	for _, spec := range allSpecs() {
		if spec.display() == "pr" {
			continue
		}
		for _, f := range spec.flags {
			if f.long == "--allow-untrusted" {
				t.Errorf("haven %s declares --allow-untrusted — it belongs to pr --throwaway alone", spec.display())
			}
		}
	}
}

func TestParseRejectsUndeclaredFlags(t *testing.T) {
	if _, err := parse(specByName(t, "logs"), []string{"--nope"}); err == nil {
		t.Error("parse accepted an undeclared flag")
	}
	if _, err := parse(specByName(t, "logs"), []string{"-x"}); err == nil {
		t.Error("parse accepted an undeclared short flag")
	}
}

func TestParseRejectsUnexpectedPositionals(t *testing.T) {
	// The old CLI silently ignored unexpected positionals (`haven seed demo` ran
	// the default seed); the parser makes the footgun impossible everywhere.
	if _, err := parse(specByName(t, "down"), []string{"everything"}); err == nil {
		t.Error("parse accepted a positional on a command that declares none")
	}
}

func TestParseValueFlags(t *testing.T) {
	t.Run("space-separated value", func(t *testing.T) {
		inv, err := parse(specByName(t, "wait"), []string{"--timeout", "45s"})
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if got := inv.value("--timeout"); got != "45s" {
			t.Errorf("value = %q, want 45s", got)
		}
	})
	t.Run("equals-embedded value", func(t *testing.T) {
		inv, err := parse(specByName(t, "wait"), []string{"--timeout=45s"})
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if got := inv.value("--timeout"); got != "45s" {
			t.Errorf("value = %q, want 45s", got)
		}
	})
	t.Run("trailing value flag errors instead of silently defaulting", func(t *testing.T) {
		if _, err := parse(specByName(t, "wait"), []string{"--timeout"}); err == nil {
			t.Error("parse accepted a trailing --timeout with no value")
		}
	})
}

func TestParseShortFlagExpandsToLong(t *testing.T) {
	inv, err := parse(specByName(t, "logs"), []string{"-f"})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !inv.has("--follow") {
		t.Error("-f did not register as --follow")
	}
}

// The help side of one-name: a command cannot exist without being documented.
// @scenario "The daily verbs are top level and the tools are grouped"
func TestHelpDocumentsEveryVisibleCommand(t *testing.T) {
	help := commandsHelp()
	for _, spec := range table {
		if spec.hidden {
			continue
		}
		if !strings.Contains(help, spec.name) {
			t.Errorf("help's command sections are missing %q", spec.name)
		}
		for _, sub := range spec.subs {
			if !sub.hidden && !strings.Contains(renderCommandHelp(spec), sub.name) {
				t.Errorf("haven help %s is missing %q", spec.name, sub.name)
			}
		}
	}
	if strings.Contains(strings.ToLower(help), "alias") {
		t.Error("help mentions aliases — there are none")
	}
}
