package app

import (
	"fmt"
	"os"
)

// Feature is an optional integration `haven setup` can install into this
// checkout. Optional is the operative word: these change how OTHER tools
// behave, so haven offers them and does not assume them — `up` installs
// nothing from this list.
type Feature struct {
	Name    string
	Summary string
	// Detail is the paragraph a human reads before choosing.
	Detail string
}

// Features is the list, in the order `haven setup` offers them.
var Features = []Feature{{
	Name:    "gate-hook",
	Summary: "queue heavy commands from Claude Code so parallel agents can't take the machine",
	Detail: "Registers `haven gate` as a PreToolUse hook in this worktree's\n" +
		"    .claude/settings.local.json (gitignored, so it stays yours). Test runs,\n" +
		"    typechecks and builds started by an agent then take a machine-wide slot\n" +
		"    instead of all landing at once. Hooks are read at session start, so new\n" +
		"    Claude Code sessions pick it up.",
}}

// InstallFeature installs one feature by name and reports whether it changed
// anything — so re-running setup is a no-op rather than a duplicate.
func (o *Orchestrator) InstallFeature(name string) (bool, error) {
	switch name {
	case "gate-hook":
		return o.installGateHook()
	default:
		return false, fmt.Errorf("unknown feature %q", name)
	}
}

// installGateHook registers the gate in this checkout's own Claude settings.
//
// .claude/settings.local.json, deliberately: .gitignore carries
// `**/.claude/settings.local.json*` while .claude/settings.json is checked in,
// so this configures the developer's checkout without committing a hook into
// everyone else's. The root comes from git's own toplevel, which in a worktree
// resolves to that worktree — so each gets its own, matching the fact that
// each already gets its own stack, slug and .env.portless.
func (o *Orchestrator) installGateHook() (bool, error) {
	if o.cfg.RepoRoot == "" {
		return false, fmt.Errorf("no repository root: run this from inside a checkout")
	}
	self, err := os.Executable()
	if err != nil || self == "" {
		// Without an absolute path the hook would depend on haven being on PATH,
		// which `make haven install` makes optional. A hook that cannot exec would
		// fire on every single tool call, so refuse rather than install a trap.
		return false, fmt.Errorf("cannot resolve haven's own path; run `make haven install` first")
	}
	return o.store.EnsureClaudeHook(o.cfg.RepoRoot, self+" gate")
}
