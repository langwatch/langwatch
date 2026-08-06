package app

import (
	"os"

	"go.uber.org/zap"
)

// The gate hook is registered per checkout, in this worktree's own
// .claude/settings.local.json, and `haven up` writes it the same way it writes
// .env.portless.
//
// Three things make that the right home rather than the user's global config.
//
// It is SCOPED: it governs heavy commands in this repo, so it belongs to this
// repo, not to every project on the machine. It is UNTRACKED — .gitignore
// carries `**/.claude/settings.local.json*`, while .claude/settings.json is
// checked in — so writing here configures your checkout without committing a
// hook to everyone else's. And it is PER WORKTREE: `git rev-parse
// --show-toplevel` resolves to the worktree's own root, so each one gets its
// own file, which is exactly right when each also gets its own stack.
//
// That scoping is why this can be part of `up` at all. Reaching into
// ~/.claude to change how a different tool behaves everywhere would be a
// decision to ask for; writing a dev-environment setting into the checkout
// haven is already provisioning is the same thing haven does with the overlay.
func (o *Orchestrator) ensureGateHook() {
	if o.cfg.RepoRoot == "" {
		return
	}
	self, err := os.Executable()
	if err != nil || self == "" {
		// Without an absolute path the hook would depend on haven being on PATH,
		// which `make haven install` makes optional. Better no hook than one that
		// fails to exec on every tool call.
		return
	}
	installed, err := o.store.EnsureClaudeHook(o.cfg.RepoRoot, self+" gate")
	switch {
	case err != nil:
		// Never fatal to `up`. A stack that will not start because a hook could
		// not be written would be a worse trade than a machine without a governor.
		o.log.Warn("could not register the haven gate hook", zap.Error(err))
	case installed:
		o.log.Info("registered haven gate in this worktree's .claude/settings.local.json",
			zap.String("note", "hooks are read at session start, so new Claude Code sessions pick it up"))
	}
}
