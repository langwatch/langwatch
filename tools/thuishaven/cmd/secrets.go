package cmd

import (
	"context"
	"os"
	"os/exec"
	"syscall"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// secretsCommand is the 1Password half of local secrets: `haven secrets move`
// takes the credential lines out of .env into the LangWatch item (ADR-132).
func secretsCommand() commandSpec {
	move := commandSpec{
		name:    "move",
		summary: "move every credential line of .env into 1Password (Private/LangWatch haven secrets); a dry run naming keys unless --apply",
		flags: []flagSpec{
			{long: "--apply", summary: "write the item, then delete the moved lines and set LANGWATCH_OP_ACCOUNT in .env"},
			{long: "--account", takesValue: true, value: "<shorthand>", summary: "the 1Password account (default: LANGWATCH_OP_ACCOUNT)"},
		},
		run: func(_ context.Context, d deps, inv invocation) error {
			return d.orch.SecretsMove(app.SecretsMoveParams{
				WorktreeDir: d.params.WorktreeDir, Account: inv.value("--account"), Apply: inv.has("--apply"),
			}, os.Stdout)
		},
	}
	run := commandSpec{
		name:    "exec",
		summary: "run a command with the 1Password item's fields the shell and .env leave unset (values never printed)",
		args:    "-- <command> [args…]",
		maxArgs: -1,
		run: func(_ context.Context, d deps, inv invocation) error {
			if len(inv.args) == 0 {
				return usageErr("usage: haven secrets exec -- <command> [args…]")
			}
			path, err := exec.LookPath(inv.args[0])
			if err != nil {
				return err
			}
			return syscall.Exec(path, inv.args, app.SecretsExecEnv(d.params.WorktreeDir))
		},
	}
	return commandSpec{name: "secrets", summary: "local credentials in 1Password: move | exec", subs: []commandSpec{move, run}}
}
