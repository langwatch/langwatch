package cmd

import (
	"context"
	"fmt"
	"os"

	"github.com/0xdeafcafe/moron/tui"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/hubtui"
)

// runHub is `haven hub` (and bare `haven` in a terminal): the interactive hub.
// Opening a stack's git view quits the hub, runs the moron TUI, and re-enters
// the hub when it closes — two full-screen programs take turns rather than
// nesting. Agents get the plain list; a TUI is useless to them.
func runHub(ctx context.Context, d deps, _ []string) error {
	if d.isAgent {
		return d.orch.List(false)
	}
	for {
		dir, err := hubtui.Run(ctx, d.hubActions())
		if err != nil || dir == "" {
			return err
		}
		if err := tui.Run(dir); err != nil {
			// A stale row (e.g. the worktree dir was deleted underneath us)
			// shouldn't end the session — surface the error and re-enter the hub.
			fmt.Fprintf(os.Stderr, "haven: git view for %s failed: %v\n", dir, err)
		}
		if ctx.Err() != nil {
			return nil
		}
	}
}

// hubActions adapts the orchestrator to the hub's callback surface. Destroy is
// pinned to this repo and this launch directory, so the primary checkout and
// the worktree haven runs from are refused in the app layer no matter what the
// TUI asks for.
func (d deps) hubActions() hubtui.Actions {
	return hubtui.Actions{
		Rows: func() []hubtui.Row {
			var rows []hubtui.Row
			for _, hs := range d.orch.HubStacks() {
				rows = append(rows, hubtui.Row{
					Slug:          hs.Stack.Slug,
					Branch:        hs.Stack.Branch,
					Dir:           hs.Stack.WorktreeDir,
					IsLive:        hs.IsLive,
					RSS:           hs.RSS,
					ServicesUp:    hs.PortsUp,
					ServicesTotal: len(hs.Stack.Services),
				})
			}
			return rows
		},
		Down: d.orch.DownStack,
		Destroy: func(ctx context.Context, dir string) error {
			return d.orch.DestroyWorktree(ctx, d.worktree, dir, d.worktree)
		},
	}
}
