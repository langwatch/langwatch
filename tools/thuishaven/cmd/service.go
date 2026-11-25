package cmd

import (
	"context"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// serviceCommand is `haven service on|off <name>`: one service of this stack
// switched in place. It saves the selection like `haven up ±name`, but keeps
// the running stack's mode and starts or stops only the lanes it touches.
func serviceCommand() commandSpec {
	verb := func(name string, on bool) commandSpec {
		summary := "start one service in the running stack and keep it on for every later haven up"
		if !on {
			summary = "stop one service in the running stack and keep it off for every later haven up"
		}
		return commandSpec{
			name: name, args: "<service>", maxArgs: 1, summary: summary,
			run: func(ctx context.Context, d deps, inv invocation) error {
				sign := "+"
				if !on {
					sign = "-"
				}
				inv.args = append([]string{sign}, inv.args...)
				return runServiceSwitch(ctx, d, inv)
			},
		}
	}
	return commandSpec{
		name:    "service",
		summary: "switch one service on or off in place; `app` is the ui, api and worker together",
		subs:    []commandSpec{verb("on", true), verb("off", false)},
	}
}

// runServiceSwitch takes the sign the verb chose, then the service it names.
func runServiceSwitch(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) != 2 {
		return usageErr("name one service: %s", strings.Join(domain.SelectableServices, ", "))
	}
	sel, err := d.orch.ResolveSelection(d.worktree, []string{inv.args[0] + inv.args[1]})
	if err != nil {
		return err
	}
	sel, mode, err := d.orch.ResolveMode(d.worktree, sel, "")
	if err != nil {
		return err
	}
	if err := applyDeploymentMode(&d.opts, mode, d.worktree); err != nil {
		return err
	}
	d.opts.Selection = sel
	return d.orch.SwitchService(ctx, d.params, d.opts)
}
