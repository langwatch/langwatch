package app

import (
	"fmt"
	"os"

	"go.uber.org/zap"

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
		"    Claude Code sessions pick it up. `haven up` now registers this automatically\n" +
		"    for every worktree it starts, so running this by hand is only needed to\n" +
		"    install it early or to turn it back on. `haven setup gate-hook --off` removes\n" +
		"    it and stops `haven up` from reinstalling it here.",
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

// OptOutFeature turns a feature back off for this worktree, so a later install
// - including the automatic one `haven up` makes for the gate hook - leaves it
// alone. It reports whether anything actually changed.
func (o *Orchestrator) OptOutFeature(name string) (bool, error) {
	switch name {
	case "gate-hook":
		return o.offGateHook(o.claude)
	case "codex-gate-hook":
		return o.offGateHook(o.codex)
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
	command, err := havenGateCommand(client)
	if err != nil {
		return false, err
	}
	return settings.EnsureHook(o.cfg.RepoRoot, command)
}

// offGateHook opts this checkout's selected agent settings back out of the gate.
func (o *Orchestrator) offGateHook(settings AgentHookSettings) (bool, error) {
	if o.cfg.RepoRoot == "" {
		return false, fmt.Errorf("no repository root: run this from inside a checkout")
	}
	if settings == nil {
		return false, fmt.Errorf("no agent hook settings writer is wired in")
	}
	return settings.Off(o.cfg.RepoRoot)
}

// havenGateCommand is the shell command every gate-hook installer writes:
// haven's own absolute path (quoted, for a checkout under a directory with a
// space), the gate subcommand, and a client flag for anything other than
// Claude's own protocol.
func havenGateCommand(client string) (string, error) {
	self, err := os.Executable()
	if err != nil || self == "" {
		// Without an absolute path the hook would depend on haven being on PATH,
		// which `make haven install` makes optional. A hook that cannot exec would
		// fire on every single tool call, so refuse rather than install a trap.
		return "", fmt.Errorf("cannot resolve haven's own path; run `make haven install` first")
	}
	// Quoted, because the path is the one thing here haven does not choose: a
	// checkout under a directory with a space would otherwise install a hook that
	// splits into two words and fails on every tool call.
	command := domain.ShellQuote(self) + " gate"
	if client != "" {
		command += " --client " + client
	}
	return command, nil
}

// EnsureGateHookForUp installs the Claude gate hook for the worktree `haven
// up` is starting, so governance no longer depends on remembering `haven
// setup` in every checkout - the defect that let three unguarded lanes put
// thirty forks on the machine.
//
// Best-effort and silent on the happy path: a write failure here must never
// fail `up` itself, since the hook is a convenience a developer can always
// install by hand. EnsureHook is itself already a no-op for a worktree opted
// out with `haven setup gate-hook --off`, so this needs no opt-out check of
// its own.
func (o *Orchestrator) EnsureGateHookForUp(worktreeDir string) {
	if o.claude == nil || worktreeDir == "" {
		return
	}
	command, err := havenGateCommand("")
	if err != nil {
		return
	}
	if _, err := o.claude.EnsureHook(worktreeDir, command); err != nil {
		o.log.Warn("could not register the Claude gate hook for this worktree",
			zap.String("worktree", worktreeDir), zap.Error(err))
	}
}
