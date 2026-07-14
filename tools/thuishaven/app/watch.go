package app

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Watch is the TUI: a live, auto-refreshing terminal dashboard of every running
// stack and its per-service health. In agent mode it degrades to a single plain
// `list` snapshot — no alt-screen, no colour, no redraws, no token waste.
func (o *Orchestrator) Watch(ctx context.Context) error {
	if o.cfg.IsAgent {
		return o.List(false)
	}
	fmt.Print("\x1b[?1049h\x1b[?25l")              // enter alt-screen, hide cursor
	defer fmt.Print("\x1b[?25h\x1b[?1049l\x1b[0m") // restore on quit (SIGINT cancels ctx)
	o.renderWatch()
	t := time.NewTicker(2 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-t.C:
			o.renderWatch()
		}
	}
}

func (o *Orchestrator) renderWatch() {
	var b strings.Builder
	b.WriteString("\x1b[H\x1b[2J") // cursor home + clear screen
	b.WriteString("\x1b[1m thuishaven \x1b[0m\x1b[2m— LangWatch local stacks · Ctrl-C to quit\x1b[0m\n\n")
	stacks := o.store.Stacks()
	if len(stacks) == 0 {
		b.WriteString("  \x1b[2mno stacks running — run 'pnpm dev' in a worktree\x1b[0m\n")
	}
	for _, s := range stacks {
		badge := "\x1b[32m live \x1b[0m"
		if !o.sys.ProcessAlive(s.LauncherPID) {
			badge = "\x1b[33m stale \x1b[0m"
		}
		b.WriteString(fmt.Sprintf("  \x1b[1m%s\x1b[0m %s \x1b[2m %s · redis db %d\x1b[0m\n", s.Slug, badge, s.Branch, s.RedisDB))
		b.WriteString(fmt.Sprintf("  \x1b[2m%s\x1b[0m\n", s.WorktreeDir))
		for _, svc := range s.Services {
			dot := "\x1b[31m●\x1b[0m"
			if o.sys.PortInUse(svc.Port) {
				dot = "\x1b[32m●\x1b[0m"
			}
			b.WriteString(fmt.Sprintf("    %s %-8s %s\n", dot, svc.Name, svc.URL))
		}
		b.WriteString("\n")
	}
	scheme, port := o.proxy.Endpoint()
	b.WriteString(fmt.Sprintf("  \x1b[2mdashboard\x1b[0m %s   \x1b[2mobservability\x1b[0m %s\n",
		o.cfg.Naming.URL(domain.HubService, "", scheme, port),
		o.cfg.Naming.URL("observability", "", scheme, port)))
	fmt.Print(b.String())
}
