package cmd

import (
	"context"
	"strings"
	"testing"
)

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
	for _, spec := range table {
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
	for _, spec := range table {
		for _, f := range spec.flags {
			if prior, seen := takes[f.long]; seen && prior != f.takesValue {
				t.Errorf("flag %q takes a value on one command but not another", f.long)
			}
			takes[f.long] = f.takesValue
		}
	}
}

// @scenario "Every command has exactly one name"
func TestRemovedSpellingsFailWithAPointer(t *testing.T) {
	for spelling, hint := range removed {
		err := deps{}.dispatch(context.Background(), spelling, nil)
		if err == nil {
			t.Fatalf("removed spelling %q dispatched successfully", spelling)
		}
		if !strings.Contains(err.Error(), hint) {
			t.Errorf("removed spelling %q error %q does not point at %q", spelling, err, hint)
		}
	}
}

// @scenario "Every command has exactly one name"
func TestRemovedSpellingsAreNotCommands(t *testing.T) {
	for spelling := range removed {
		if _, ok := tableByName[spelling]; ok {
			t.Errorf("%q is both a removed spelling and a live command", spelling)
		}
	}
}

// @scenario "An unknown command fails with a pointer, not a guess"
func TestUnknownCommandSuggestsNearMisses(t *testing.T) {
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

// @scenario "A flag shorthand means one thing across the whole CLI" — the
// --force half: it does not exist anywhere; --yes is the one confirmation.
func TestNoForceFlagExists(t *testing.T) {
	for _, spec := range table {
		for _, f := range spec.flags {
			if f.long == "--force" {
				t.Errorf("haven %s declares --force — it was removed CLI-wide (ADR-064)", spec.name)
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
		inv, err := parse(specByName(t, "hmr"), []string{"--ttl", "45s"})
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if got := inv.value("--ttl"); got != "45s" {
			t.Errorf("value = %q, want 45s", got)
		}
	})
	t.Run("equals-embedded value", func(t *testing.T) {
		inv, err := parse(specByName(t, "hmr"), []string{"--ttl=45s"})
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		if got := inv.value("--ttl"); got != "45s" {
			t.Errorf("value = %q, want 45s", got)
		}
	})
	t.Run("trailing value flag errors instead of silently defaulting", func(t *testing.T) {
		if _, err := parse(specByName(t, "hmr"), []string{"--ttl"}); err == nil {
			t.Error("parse accepted a trailing --ttl with no value")
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

// @scenario "Every command has exactly one name" — the help side: a command
// cannot exist without being documented.
func TestHelpDocumentsEveryVisibleCommand(t *testing.T) {
	help := commandsHelp()
	for _, spec := range table {
		if spec.hidden {
			continue
		}
		if !strings.Contains(help, spec.name) {
			t.Errorf("help's COMMANDS section is missing %q", spec.name)
		}
	}
	if strings.Contains(strings.ToLower(help), "alias") {
		t.Error("help mentions aliases — there are none")
	}
}
