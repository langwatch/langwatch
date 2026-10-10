package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/dashboard"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// dashboardCLIReads are the stack console's reads: each answers exactly the
// rows `haven <name> --json` prints, through the same datasource.
func dashboardCLIReads(orch *app.Orchestrator) map[string]dashboard.CLIRead {
	reads := map[string]dashboard.CLIRead{
		"sims":    func(slug string) (any, error) { return simRows(orch.SessionSnapshot(slug).Services), nil },
		"browser": func(slug string) (any, error) { return browserStatus(slug), nil },
	}
	for _, name := range tabCommands {
		reads[name] = func(slug string) (any, error) { return tabRows(orch, slug, name) }
	}
	return reads
}

// tabRows is runTabCmd's read without the printing: one viewer tab, polled once.
func tabRows(orch *app.Orchestrator, slug, name string) (any, error) {
	m := newViewerModel(slug, orch.LogPath(slug), orch.LogDir(slug))
	m.enableDashboard(sessionActions{Snapshot: func() app.SessionReport { return orch.SessionSnapshot(slug) }}, false)
	m.ingest()
	tab, ok := m.tabs[name]
	if !ok {
		return nil, fmt.Errorf("no such tab %q", name)
	}
	tab.Poll()
	return tab.Rows(), nil
}

// browserStatus is `haven browser status --json`: never starts a browser.
func browserStatus(slug string) map[string]any {
	reply := map[string]any{"running": false}
	if daemon, ok := readBrowserDaemon(browserDir(slug)); ok {
		if daemon.call(context.Background(), "status", map[string]any{}, &reply) != nil {
			reply = map[string]any{"running": false}
		}
	}
	return reply
}

// openLane answers the running daemon when lane is one it holds open; the
// console only looks at lanes, so it never opens one or names a file path.
func openLane(slug, lane string) (browserDaemon, error) {
	daemon, ok := readBrowserDaemon(browserDir(slug))
	var status struct {
		Lanes []string `json:"lanes"`
	}
	if ok && daemon.call(context.Background(), "status", map[string]any{}, &status) == nil && slices.Contains(status.Lanes, lane) {
		return daemon, nil
	}
	return browserDaemon{}, fmt.Errorf("no open browser lane %q on %s", lane, slug)
}

// dashboardBrowser is `haven browser snapshot|screenshot --lane <lane>` for the console.
func dashboardBrowser() dashboard.Browser {
	return dashboard.Browser{
		Snapshot: func(ctx context.Context, slug, lane string) (any, error) {
			daemon, err := openLane(slug, lane)
			if err != nil {
				return nil, err
			}
			var reply map[string]any
			err = daemon.call(ctx, "snapshot", map[string]any{"lane": lane, "timeoutMs": 10_000}, &reply)
			return reply, err
		},
		Screenshot: func(ctx context.Context, slug, lane string) ([]byte, error) {
			daemon, err := openLane(slug, lane)
			if err != nil {
				return nil, err
			}
			out := filepath.Join(browserDir(slug), "console", lane+".png")
			if err := daemon.call(ctx, "screenshot", map[string]any{"lane": lane, "out": out, "timeoutMs": 10_000}, nil); err != nil {
				return nil, err
			}
			return os.ReadFile(out)
		},
	}
}
