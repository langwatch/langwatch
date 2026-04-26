// Command langwatch is the CLI for the LangWatch AI Gateway.
//
// It lets enterprise users authenticate against the gateway via SSO and
// transparently route their AI tools (Claude Code, Codex, Cursor, Gemini
// CLI, custom agents) through their organization's policy plane while
// preserving per-user attribution and budget enforcement.
//
// Subcommands:
//
//	langwatch login              SSO login via browser (RFC 8628 device flow)
//	langwatch logout             clear local credentials
//	langwatch whoami             print current identity + workspace
//	langwatch claude             run `claude` with gateway env vars injected
//	langwatch codex              run `codex` with gateway env vars injected
//	langwatch cursor             run `cursor` with gateway env vars injected
//	langwatch gemini             run `gemini` with gateway env vars injected
//	langwatch shell              spawn a subshell with gateway env vars set
//	langwatch dashboard          open the user's web dashboard
//	langwatch init <shell>       print shell-eval snippet (zsh|bash|fish)
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/langwatch/langwatch/services/cli/cmd"
)

// Version is set via -ldflags at build time.
var Version = "dev"

func main() {
	cmd.Version = Version

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := cmd.Run(ctx, os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "%s\n", err)
		os.Exit(1)
	}
}
