package cmd

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// runHeavy is `haven run` — take a machine-wide slot, run the command, release.
//
// The command arrives as ONE argument on --sh rather than as trailing argv,
// because the gate hands over a shell string and splicing it bare would let
// everything after an operator run outside the slot.
func runHeavy(ctx context.Context, d deps, inv invocation) error {
	shell := inv.value("--sh")
	if shell == "" {
		return fmt.Errorf("haven run needs a command: haven run --sh 'pnpm test:unit'")
	}
	return d.orch.RunHeavy(ctx, app.HeavyRun{
		Shell:   shell,
		Dir:     d.lwDir,
		AgentID: inv.value("--agent-id"),
		// A terminal on stdout means a human is watching, and a human waiting is
		// not an idle API session — so they keep the long failsafe rather than an
		// agent's tighter ceiling.
		Interactive: stdoutIsTTY(),
	})
}

// runGate is `haven gate` — answer one Claude Code PreToolUse hook.
//
// It always exits 0. Exit code 2 BLOCKS the tool call, and an unrecovered Go
// panic exits with exactly 2, so returning an error from here would risk
// converting a haven bug into a machine-wide tool-call blocker. Every failure
// inside Gate already resolves to "defer".
func runGate(_ context.Context, d deps, inv invocation) error {
	if inv.has("--install") {
		return installGateHook()
	}
	d.orch.Gate(os.Stdin, os.Stdout)
	return nil
}

// installGateHook registers `haven gate` as a PreToolUse hook in the user's
// Claude Code settings.
//
// Deliberately NOT part of `haven up`, although up bootstraps everything else
// it needs. Installing portless and trusting a CA are things haven does to make
// ITSELF work; this reconfigures a different tool, globally, for every project
// on the machine. That is a decision to ask for rather than assume — so `up`
// only points at this command, and this command is the one that writes.
//
// The write merges rather than replaces: an existing hooks block is preserved,
// and a haven entry that is already there is left alone rather than duplicated.
func installGateHook() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("cannot locate the home directory: %w", err)
	}
	path := filepath.Join(home, ".claude", "settings.json")

	settings := map[string]any{}
	existing, readErr := os.ReadFile(path)
	if readErr == nil {
		if err := json.Unmarshal(existing, &settings); err != nil {
			return fmt.Errorf("%s is not valid JSON; not touching it: %w", path, err)
		}
	}

	self, err := os.Executable()
	if err != nil || self == "" {
		self = "haven"
	}
	command := self + " gate"

	if !mergeGateHook(settings, command) {
		fmt.Printf("haven gate is already installed in %s\n", path)
		return nil
	}
	if readErr != nil {
		existing = nil // nothing was there, so there is nothing to back up
	}
	if err := writeSettings(path, settings, existing); err != nil {
		return err
	}

	fmt.Printf("installed %q as a PreToolUse hook in %s\n", command, path)
	fmt.Println("hooks are read at session start, so this affects new Claude Code sessions.")
	return nil
}

// mergeGateHook adds the hook entry unless one is already present. It reports
// whether anything changed, so an install that is a no-op says so instead of
// rewriting the file for nothing.
func mergeGateHook(settings map[string]any, command string) bool {
	hooks, _ := settings["hooks"].(map[string]any)
	if hooks == nil {
		hooks = map[string]any{}
	}
	entries, _ := hooks["PreToolUse"].([]any)
	if slices.ContainsFunc(entries, func(e any) bool {
		return strings.Contains(fmt.Sprint(e), " gate")
	}) {
		return false
	}
	hooks["PreToolUse"] = append(entries, map[string]any{
		"matcher": "Bash|Agent",
		"hooks": []any{map[string]any{
			"type":    "command",
			"command": command,
			"timeout": 10,
		}},
	})
	settings["hooks"] = hooks
	return true
}

// writeSettings backs the file up and then replaces it. The backup matters
// because this is the user's own editor configuration: a merge that goes wrong
// should be one `mv` away from undone.
// previous is nil when there was no file to begin with, so there is nothing to
// back up.
func writeSettings(path string, settings map[string]any, previous []byte) error {
	if previous != nil {
		// #nosec G703 -- path is os.UserHomeDir() joined with two fixed segments;
		// no part of it comes from user input.
		if err := os.WriteFile(path+".haven-backup", previous, 0o600); err != nil {
			return fmt.Errorf("could not back up %s: %w", path, err)
		}
	}
	body, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	// #nosec G703 -- same fixed path as above.
	return os.WriteFile(path, append(body, '\n'), 0o600)
}
