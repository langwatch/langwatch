package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"

	"github.com/0xdeafcafe/moron/tui"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/dashboard"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/hubtui"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// runHub is bare `haven` in a terminal: the interactive hub. Opening a stack's
// git view — or handing off to the cleanup picker — quits the hub, runs the
// other full-screen program, and re-enters the hub when it closes: two
// full-screen programs take turns rather than nesting. Agents get the plain
// list; a TUI is useless to them.
func runHub(ctx context.Context, d deps) error {
	if d.isAgent {
		return d.orch.Status(false, d.worktree)
	}
	// The TUI owns the terminal: a stray zap line would scribble over the
	// interface, so the orchestrator's logs go to a file for this command.
	d.orch.RedirectLogsToFile("hub.log")
	for {
		out, err := hubtui.Run(ctx, d.hubActions())
		if err != nil {
			return err
		}
		switch {
		case out.RunCleanup:
			if err := runInteractiveClean(ctx, d, pruneStaleThreshold(invocation{})); err != nil {
				fmt.Fprintf(os.Stderr, "haven: cleanup failed: %v\n", err)
			}
		case out.OpenGitDir != "":
			if err := tui.Run(out.OpenGitDir); err != nil {
				// A stale row (e.g. the worktree dir was deleted underneath us)
				// shouldn't end the session — surface the error and re-enter the hub.
				fmt.Fprintf(os.Stderr, "haven: git view for %s failed: %v\n", out.OpenGitDir, err)
			}
		default:
			return nil
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
		Refresh: func() hubtui.View { return hubView(d.orch.HubView(d.worktree, d.worktree)) },
		Down:    d.orch.DownStack,
		Restart: func(ctx context.Context, slug string) error {
			return d.orch.RestartStack(ctx, slug, "")
		},
		OpenURL: openInBrowser,
		Destroy: func(ctx context.Context, dir string) error {
			return d.orch.DestroyWorktree(ctx, d.worktree, dir, d.worktree)
		},
		WebURL:     d.orch.DashboardURL(),
		HasCleanup: true,
	}
}

// hubView maps the app view onto the TUI's own types — the adapter never
// imports the app core, so the translation lives here in the composition root.
func hubView(v app.HubView) hubtui.View {
	out := hubtui.View{Summary: hubtui.Summary{
		TotalRAM:   v.Footprint.TotalRAM,
		StacksRSS:  v.Footprint.StacksRSS,
		ServerRSS:  v.Footprint.ServerRSS,
		AgentRSS:   v.Footprint.AgentRSS,
		AgentCount: v.Footprint.AgentCount,
		ToolingRSS: v.Footprint.ToolingRSS,
		OtherRSS:   v.Footprint.OtherRSS,
		Pressure:   v.Footprint.Pressure.String(),
	}}
	for i := range v.Stacks {
		hs := &v.Stacks[i]
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
		out.Stacks = append(out.Stacks, row)
	}
	for _, wt := range v.Worktrees {
		out.Worktrees = append(out.Worktrees, hubtui.WorktreeRow{
			Slug: wt.Slug, Branch: wt.Branch, Dir: wt.Dir,
			IsPrimary: wt.IsPrimary, IsCurrent: wt.IsCurrent,
		})
	}
	for _, ev := range v.Events {
		out.Events = append(out.Events, hubtui.Event{
			At: ev.At, Kind: ev.Kind, Target: ev.Target, Reason: ev.Reason,
		})
	}
	return out
}

// dashboardExtras maps the app view onto the web dashboard's own types — same
// composition-root translation the TUI gets, for the same reason: the adapter
// never imports the app core.
func dashboardExtras(v app.HubView) dashboard.Extras {
	out := dashboard.Extras{
		Summary: dashboard.SummaryView{
			TotalRAM:   v.Footprint.TotalRAM,
			StacksRSS:  v.Footprint.StacksRSS,
			ServerRSS:  v.Footprint.ServerRSS,
			AgentRSS:   v.Footprint.AgentRSS,
			AgentCount: v.Footprint.AgentCount,
			ToolingRSS: v.Footprint.ToolingRSS,
			OtherRSS:   v.Footprint.OtherRSS,
			Pressure:   v.Footprint.Pressure.String(),
		},
		StackRSS: map[int]uint64{},
	}
	for i := range v.Stacks {
		out.StackRSS[v.Stacks[i].Stack.LauncherPID] = v.Stacks[i].RSS
	}
	for _, wt := range v.Worktrees {
		out.Worktrees = append(out.Worktrees, dashboard.WorktreeView{
			Slug: wt.Slug, Branch: wt.Branch, Dir: wt.Dir,
			IsPrimary: wt.IsPrimary, IsCurrent: wt.IsCurrent,
		})
	}
	for _, ev := range v.Events {
		out.Events = append(out.Events, dashboard.EventView{
			At: ev.At, Kind: ev.Kind, Target: ev.Target, Reason: ev.Reason,
		})
	}
	return out
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
