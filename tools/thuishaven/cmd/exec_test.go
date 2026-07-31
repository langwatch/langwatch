package cmd

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// @scenario "arguments after the terminator belong to the command"
func TestTerminatorHandsArgumentsToTheCommand(t *testing.T) {
	t.Run("when the command's flags would collide with haven's", func(t *testing.T) {
		inv, err := parse(specByName(t, "exec"), []string{"--", "pnpm", "vitest", "run", "--watch"})
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		want := []string{"pnpm", "vitest", "run", "--watch"}
		if !slices.Equal(inv.args, want) {
			t.Errorf("args = %v, want %v", inv.args, want)
		}
		if len(inv.flags) != 0 {
			t.Errorf("terminator leaked flags to haven: %v", inv.flags)
		}
	})

	t.Run("when a passed-through argument is the terminator itself", func(t *testing.T) {
		inv, err := parse(specByName(t, "exec"), []string{"--", "sh", "-c", "--"})
		if err != nil {
			t.Fatalf("parse: %v", err)
		}
		want := []string{"sh", "-c", "--"}
		if !slices.Equal(inv.args, want) {
			t.Errorf("args = %v, want %v", inv.args, want)
		}
	})
}

// The terminator is a parsing rule, not a permission: it says where haven's
// flags stop, never that a command has acquired arguments it does not declare.
// @scenario "arguments after the terminator belong to the command"
func TestTerminatorGrantsNoArgumentsToACommandThatDeclaresNone(t *testing.T) {
	if _, err := parse(specByName(t, "down"), []string{"--", "everything"}); err == nil {
		t.Error("the terminator smuggled a positional past a command that takes none")
	}
}

// @scenario "one command runs anything against the stack"
func TestExecNeedsACommandToRun(t *testing.T) {
	err := runExec(context.Background(), deps{}, invocation{})
	if err == nil {
		t.Fatal("bare `haven exec` did not fail")
	}
	if !strings.Contains(err.Error(), "haven exec -- <cmd>") {
		t.Errorf("error should show the shape of the fix, got %q", err)
	}
}

// @scenario "the langwatch CLI has a one-word spelling"
func TestCLINamesTheBuildCommandWhenTheEntryIsMissing(t *testing.T) {
	t.Run("when the CLI has not been built", func(t *testing.T) {
		err := runCLI(context.Background(), deps{worktree: t.TempDir()}, invocation{args: []string{"onboard"}})
		if err == nil {
			t.Fatal("an unbuilt CLI did not fail")
		}
		// An unbuilt CLI is the normal state of a fresh worktree, so the failure
		// has to route the developer to the build, not to a missing file.
		if !strings.Contains(err.Error(), "pnpm --filter langwatch build") {
			t.Errorf("error should name the build command, got %q", err)
		}
	})

	t.Run("when the CLI has been built it resolves to this checkout's copy", func(t *testing.T) {
		// runCLI itself ends in syscall.Exec, which would replace this test
		// binary, so the resolution it depends on is what gets asserted.
		worktree := t.TempDir()
		want := filepath.Join(worktree, sdkCLIEntry)
		if err := os.MkdirAll(filepath.Dir(want), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(want, []byte("#!/usr/bin/env node\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		got, err := cliEntry(worktree)
		if err != nil {
			t.Fatalf("cliEntry: %v", err)
		}
		if got != want {
			t.Errorf("entry = %q, want %q", got, want)
		}
	})
}
