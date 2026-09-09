package app

import (
	"fmt"
	"os"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
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
}, {
	Name:    "codex-gate-hook",
	Summary: "queue heavy commands from Codex through the same machine-wide gate",
	Detail: "Registers `haven gate` in this worktree's .codex/hooks.json.\n" +
		"    Existing hooks and settings remain intact. In a trusted Codex project,\n" +
		"    open /hooks to review and trust the new hook before it can run. Hooks\n" +
		"    are enabled by default; this does not change your feature settings.",
}}

// InstallFeature installs one feature by name and reports whether it changed
// anything — so re-running setup is a no-op rather than a duplicate.
func (o *Orchestrator) InstallFeature(name string) (bool, error) {
	switch name {
	case "gate-hook":
		return o.installGateHook(o.claude, "")
	case "codex-gate-hook":
		return o.installGateHook(o.codex, "codex")
	default:
		return false, fmt.Errorf("unknown feature %q", name)
	}
}

// installGateHook registers the gate in this checkout's selected agent settings.
//
// Each adapter writes a gitignored file under this worktree, so opting in
// does not install a hook for another checkout or change shared settings.
func (o *Orchestrator) installGateHook(settings AgentHookSettings, client string) (bool, error) {
	if o.cfg.RepoRoot == "" {
		return false, fmt.Errorf("no repository root: run this from inside a checkout")
	}
	if settings == nil {
		return false, fmt.Errorf("no agent hook settings writer is wired in")
	}
	self, err := os.Executable()
	if err != nil || self == "" {
		// Without an absolute path the hook would depend on haven being on PATH,
		// which `make haven install` makes optional. A hook that cannot exec would
		// fire on every single tool call, so refuse rather than install a trap.
		return false, fmt.Errorf("cannot resolve haven's own path; run `make haven install` first")
	}
	// Quoted, because the path is the one thing here haven does not choose: a
	// checkout under a directory with a space would otherwise install a hook that
	// splits into two words and fails on every tool call.
	command := domain.ShellQuote(self) + " gate"
	if client != "" {
		command += " --client " + client
	}
	return settings.EnsureHook(o.cfg.RepoRoot, command)
}
