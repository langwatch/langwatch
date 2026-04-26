package cmd

import (
	"context"
	"fmt"
	"strings"

	"github.com/langwatch/langwatch/services/cli/internal/config"
	"github.com/langwatch/langwatch/services/cli/internal/wrapper"
)

func init() {
	register(&Command{
		Name:      "init",
		ShortHelp: "print a shell-eval snippet so all tools auto-route through the gateway",
		Run:       runInit,
	})
}

// runInit prints a snippet the user can `eval` in their shell rc to
// pre-export gateway env vars for any tool they invoke directly. This
// is the always-on alternative to `langwatch claude/codex/cursor`.
//
//	# .zshrc / .bashrc
//	eval "$(langwatch init zsh)"
func runInit(_ context.Context, args []string) error {
	shell := "zsh"
	if len(args) > 0 {
		shell = strings.ToLower(args[0])
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.LoggedIn() {
		return fmt.Errorf("# not logged in — run `langwatch login` first")
	}

	envs := []wrapper.EnvKV{}
	seen := map[string]bool{}
	for _, t := range []string{"claude", "codex", "cursor", "gemini"} {
		for _, kv := range wrapper.EnvForTool(cfg, t) {
			if seen[kv.Key] {
				continue
			}
			seen[kv.Key] = true
			envs = append(envs, kv)
		}
	}

	switch shell {
	case "fish":
		for _, e := range envs {
			fmt.Printf("set -gx %s %s\n", e.Key, shellQuote(e.Value))
		}
	case "cmd":
		for _, e := range envs {
			fmt.Printf("set %s=%s\n", e.Key, e.Value)
		}
	case "powershell", "pwsh":
		for _, e := range envs {
			fmt.Printf("$env:%s = '%s'\n", e.Key, e.Value)
		}
	default: // bash, zsh, sh
		for _, e := range envs {
			fmt.Printf("export %s=%s\n", e.Key, shellQuote(e.Value))
		}
	}
	return nil
}

func shellQuote(s string) string {
	if !strings.ContainsAny(s, " \t\n'\"$\\") {
		return s
	}
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
