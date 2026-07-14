package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// List prints every running stack — which worktree owns which slug and where
// each service is reachable. asJSON is the agent-friendly form.
func (o *Orchestrator) List(asJSON bool) error {
	stacks := o.store.Stacks()
	scheme, port := o.proxy.Endpoint()
	shared := func(svc string) string { return o.cfg.Naming.URL(svc, "", scheme, port) }
	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(map[string]any{
			"stacks":        stacks,
			"dashboard":     shared(domain.HubService),
			"observability": shared("observability"),
			"telemetry":     shared("telemetry"),
		})
	}
	if len(stacks) == 0 {
		fmt.Println("no stacks running — start one with `pnpm dev` in a worktree")
		return nil
	}
	for _, s := range stacks {
		fmt.Printf("%-18s %-6s %s  (%s)\n", s.Slug, o.liveness(s), s.Branch, s.WorktreeDir)
		for _, svc := range s.Services {
			fmt.Printf("    %-8s %s\n", svc.Name, svc.URL)
		}
	}
	fmt.Printf("\ndashboard %s\n", shared(domain.HubService))
	return nil
}

func (o *Orchestrator) liveness(s domain.Stack) string {
	if o.sys.ProcessAlive(s.LauncherPID) {
		return "live"
	}
	return "stale"
}

// Doctor reports on the moving parts so a human or agent can self-diagnose.
func (o *Orchestrator) Doctor() error {
	ok := func(b bool) string {
		if b {
			return "ok  "
		}
		return "MISS"
	}
	scheme, port := o.proxy.Endpoint()
	url := func(svc string) string { return o.cfg.Naming.URL(svc, "", scheme, port) }
	info, daemonUp := o.store.Daemon()
	fmt.Printf("%s portless proxy running (%s on :%d)\n", ok(o.proxy.Running()), scheme, port)
	fmt.Printf("%s haven daemon (pid %d) -> %s\n", ok(daemonUp && o.sys.ProcessAlive(info.PID)), info.PID, url(o.cfg.Naming.Project))
	if o.obs != nil {
		obsOK, detail := o.obs.Health(context.Background())
		fmt.Printf("%s observability — %s -> %s\n", ok(obsOK), detail, url(domain.ObservabilityService))
	}
	if o.ch != nil && o.cfg.ShouldManageClickHouse {
		chOK, detail := o.ch.Health(context.Background())
		fmt.Printf("%s managed clickhouse — %s\n", ok(chOK), detail)
	}
	if o.pg != nil && o.cfg.ShouldManagePostgres {
		pgOK, detail := o.pg.Health(context.Background())
		fmt.Printf("%s managed postgres — %s\n", ok(pgOK), detail)
	}
	if o.rds != nil && o.cfg.ShouldManageRedis {
		rdsOK, detail := o.rds.Health(context.Background())
		fmt.Printf("%s managed redis — %s\n", ok(rdsOK), detail)
	}
	live, rss := o.stackFootprint()
	fmt.Printf("     stacks running: %d (%d live, ~%s RAM)   tld: .%s\n", len(o.store.Stacks()), live, humanBytes(int64(rss)), o.cfg.Naming.TLD)
	return nil
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
