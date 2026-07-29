package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// health is one shared component's status line, JSON-shaped for agents.
type health struct {
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

// Status is haven's one reporting surface: every stack (liveness, services,
// per-service health, RAM footprint) plus the shared machinery (proxy, daemon,
// observability, the managed database servers) in a single one-shot report.
// asJSON is the agent-friendly form.
func (o *Orchestrator) Status(asJSON bool, worktreeDir string) error {
	ctx := context.Background()
	stacks := o.store.Stacks()
	scheme, port := o.proxy.Endpoint()
	shared := func(svc string) string { return o.cfg.Naming.URL(svc, "", scheme, port) }

	info, daemonUp := o.store.Daemon()
	proxy := health{OK: o.proxy.Running(), Detail: fmt.Sprintf("%s on :%d", scheme, port)}
	daemon := health{OK: daemonUp && o.sys.ProcessAlive(info.PID), Detail: fmt.Sprintf("pid %d", info.PID)}
	servers := map[string]health{}
	if o.obs != nil {
		ok, detail := o.obs.Health(ctx)
		servers["observability"] = health{OK: ok, Detail: detail}
	}
	if o.ch != nil && o.cfg.ShouldManageClickHouse {
		ok, detail := o.ch.Health(ctx)
		servers["clickhouse"] = health{OK: ok, Detail: detail}
	}
	if o.pg != nil && o.cfg.ShouldManagePostgres {
		ok, detail := o.pg.Health(ctx)
		servers["postgres"] = health{OK: ok, Detail: detail}
	}
	if o.rds != nil && o.cfg.ShouldManageRedis {
		ok, detail := o.rds.Health(ctx)
		servers["redis"] = health{OK: ok, Detail: detail}
	}
	live, rss := o.stackFootprint()
	selection, haveSelection := o.store.ReadSelection(worktreeDir)
	if !haveSelection && worktreeDir != "" {
		selection = domain.DefaultSelection()
		haveSelection = true
	}

	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(map[string]any{
			"stacks":        stacks,
			"dashboard":     shared(domain.HubService),
			"observability": shared("observability"),
			"telemetry":     shared("telemetry"),
			"proxy":         proxy,
			"daemon":        daemon,
			"servers":       servers,
			"footprint":     map[string]any{"live": live, "rssBytes": rss},
			"selection":     selection,
		})
	}

	if haveSelection {
		fmt.Printf("this worktree — %s\n\n", selection.Describe())
	}
	if len(stacks) == 0 {
		fmt.Println("no stacks running — start one with `haven up` in a worktree")
	}
	for _, s := range stacks {
		ram := ""
		if o.sys.ProcessAlive(s.LauncherPID) {
			if groupRSS := o.sys.GroupRSS(s.LauncherPID); groupRSS > 0 {
				ram = "  ~" + domain.HumanBytes(int64(groupRSS))
			}
		}
		fmt.Printf("%-18s %-6s %s  (%s)%s\n", s.Slug, o.liveness(s), s.Branch, s.WorktreeDir, ram)
		for _, svc := range s.Services {
			dot := "·"
			if o.sys.PortInUse(svc.Port) {
				dot = "●"
			}
			fmt.Printf("  %s %-10s %s\n", dot, svc.Name, svc.URL)
		}
	}
	fmt.Println()

	ok := func(b bool) string {
		if b {
			return "ok  "
		}
		return "MISS"
	}
	fmt.Printf("%s portless proxy (%s)\n", ok(proxy.OK), proxy.Detail)
	fmt.Printf("%s haven daemon (%s) -> %s\n", ok(daemon.OK), daemon.Detail, shared(o.cfg.Naming.Project))
	for _, name := range []string{"observability", "clickhouse", "postgres", "redis"} {
		h, managed := servers[name]
		if !managed {
			continue
		}
		fmt.Printf("%s %s — %s\n", ok(h.OK), name, h.Detail)
	}
	fmt.Printf("\nstacks: %d (%d live, ~%s RAM)   dashboard %s   tld: .%s\n",
		len(stacks), live, domain.HumanBytes(int64(rss)), shared(domain.HubService), o.cfg.Naming.TLD)
	return nil
}

func (o *Orchestrator) liveness(s domain.Stack) string {
	if o.sys.ProcessAlive(s.LauncherPID) {
		return "live"
	}
	return "stale"
}

// stackFootprint sums the live stacks' process-group RSS — the "what are my
// dev stacks actually costing this machine" number.
func (o *Orchestrator) stackFootprint() (live int, rss uint64) {
	for _, s := range o.store.Stacks() {
		if o.sys.ProcessAlive(s.LauncherPID) {
			live++
			rss += o.sys.GroupRSS(s.LauncherPID)
		}
	}
	return live, rss
}
