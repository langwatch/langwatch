package cmd

import (
	"fmt"
	"os"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// applyDeploymentMode refuses a mode whose required values nobody supplied,
// and warns for each mode variable the root .env overrides (.env beats the
// overlay, so that variable is not what the mode says).
func applyDeploymentMode(opts *app.PlanOptions, mode domain.DeploymentMode, worktree string) error {
	if mode.Name == "" {
		return nil
	}
	dotenv := domain.LoadDotenv(worktree)
	if missing := mode.Missing(os.LookupEnv, dotenv); len(missing) > 0 {
		return fmt.Errorf("deployment mode %s needs %s from your shell or .env; nothing license-bearing is committed",
			mode.Name, strings.Join(missing, ", "))
	}
	opts.DeploymentMode = mode
	opts.ModeOverriddenBy = mode.OverriddenBy(dotenv)
	for _, key := range opts.ModeOverriddenBy {
		fmt.Fprintf(os.Stderr, "haven: mode %s sets %s, but the root .env sets it too and .env wins\n", mode.Name, key)
	}
	return nil
}
