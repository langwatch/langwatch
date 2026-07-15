package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"

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
				row := hubtui.Row{
					Slug:          hs.Stack.Slug,
					Branch:        hs.Stack.Branch,
					Dir:           hs.Stack.WorktreeDir,
					IsLive:        hs.IsLive,
					RSS:           hs.RSS,
					ServicesUp:    hs.PortsUp,
					ServicesTotal: len(hs.Stack.Services),
				}
				for _, svc := range hs.Stack.Services {
					if svc.Name == "app" {
						row.AppURL = svc.URL
					}
					row.Services = append(row.Services, hubtui.ServiceRow{
						Name: svc.Name, Port: svc.Port, URL: svc.URL,
						IsUp: hs.ServiceUp[svc.Name], IsFallback: svc.IsFallback,
					})
				}
				rows = append(rows, row)
			}
			return rows
		},
		Down: d.orch.DownStack,
		Restart: func(ctx context.Context, slug string) error {
			return d.orch.RestartStack(ctx, slug, "")
		},
		OpenURL: openInBrowser,
		Destroy: func(ctx context.Context, dir string) error {
			return d.orch.DestroyWorktree(ctx, d.worktree, dir, d.worktree)
		},
	}
}

func openInBrowser(url string) error {
	opener := "open" // macOS
	if runtime.GOOS != "darwin" {
		opener = "xdg-open"
	}
	cmd := exec.Command(opener, url)
	if err := cmd.Start(); err != nil {
		return err
	}
	// Reap in the background so repeated opens don't accumulate zombies while
	// the hub stays up.
	go func() { _ = cmd.Wait() }()
	return nil
}
