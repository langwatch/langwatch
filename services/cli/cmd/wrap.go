package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"syscall"

	"github.com/langwatch/langwatch/services/cli/internal/auth"
	"github.com/langwatch/langwatch/services/cli/internal/config"
	"github.com/langwatch/langwatch/services/cli/internal/wrapper"
)

func init() {
	register(&Command{
		Name:      "claude",
		ShortHelp: "run `claude` (Claude Code) routed through the gateway",
		Run:       wrapTool("claude"),
	})
	register(&Command{
		Name:      "codex",
		ShortHelp: "run `codex` (OpenAI Codex CLI) routed through the gateway",
		Run:       wrapTool("codex"),
	})
	register(&Command{
		Name:      "cursor",
		ShortHelp: "run `cursor` routed through the gateway",
		Run:       wrapTool("cursor"),
	})
	register(&Command{
		Name:      "gemini",
		ShortHelp: "run `gemini` (Gemini CLI) routed through the gateway",
		Run:       wrapTool("gemini"),
	})
	register(&Command{
		Name:      "shell",
		ShortHelp: "spawn a subshell with gateway env vars set for all tools",
		Run:       runShell,
	})
}

func wrapTool(toolName string) func(context.Context, []string) error {
	return func(ctx context.Context, args []string) error {
		cfg, err := config.Load()
		if err != nil {
			return err
		}
		client := &auth.Client{BaseURL: cfg.ControlPlaneURL}
		if err := auth.EnsureFresh(ctx, cfg, client, nil); err != nil {
			if errors.Is(err, auth.ErrSessionRevoked) {
				return errors.New(err.Error())
			}
			return err
		}
		envKV := wrapper.EnvForTool(cfg, toolName)
		return wrapper.Run(cfg, wrapper.Tool{
			Name:    toolName,
			EnvVars: envKV,
		}, args)
	}
}

func runShell(ctx context.Context, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if !cfg.LoggedIn() {
		return errors.New("not logged in — run `langwatch login` first")
	}
	client := &auth.Client{BaseURL: cfg.ControlPlaneURL}
	if err := auth.EnsureFresh(ctx, cfg, client, nil); err != nil {
		return err
	}

	shell := os.Getenv("SHELL")
	if shell == "" {
		switch runtime.GOOS {
		case "windows":
			shell = "cmd.exe"
		default:
			shell = "/bin/sh"
		}
	}

	env := os.Environ()
	for _, kv := range allToolEnv(cfg) {
		env = append(env, kv.Key+"="+kv.Value)
	}
	env = append(env, "LANGWATCH_SHELL=1")

	fmt.Fprintf(os.Stderr, "» Entering langwatch shell (gateway: %s). Type `exit` to leave.\n", cfg.GatewayURL)

	if runtime.GOOS == "windows" {
		c := exec.Command(shell, args...)
		c.Env = env
		c.Stdin = os.Stdin
		c.Stdout = os.Stdout
		c.Stderr = os.Stderr
		return c.Run()
	}
	return syscall.Exec(shell, append([]string{shell}, args...), env)
}

// allToolEnv returns the union of env vars across all wrapped tools, so
// `langwatch shell` can be used to drive any of them.
func allToolEnv(cfg *config.Config) []wrapper.EnvKV {
	var out []wrapper.EnvKV
	seen := map[string]bool{}
	for _, t := range []string{"claude", "codex", "cursor", "gemini"} {
		for _, kv := range wrapper.EnvForTool(cfg, t) {
			if seen[kv.Key] {
				continue
			}
			seen[kv.Key] = true
			out = append(out, kv)
		}
	}
	return out
}
