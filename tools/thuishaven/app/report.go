package app

import (
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
			"dashboard":     shared(o.cfg.Naming.Project),
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
	fmt.Printf("\ndashboard %s\n", shared(o.cfg.Naming.Project))
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
	obsPort := o.cfg.ObservabilityPort
	if obsPort == 0 {
		obsPort = 3000
	}
	fmt.Printf("%s portless proxy running (%s on :%d)\n", ok(o.proxy.Running()), scheme, port)
	fmt.Printf("%s haven daemon (pid %d) -> %s\n", ok(daemonUp && o.sys.ProcessAlive(info.PID)), info.PID, url(o.cfg.Naming.Project))
	fmt.Printf("%s grafana observability on :%d -> %s\n", ok(o.sys.PortInUse(obsPort)), obsPort, url("observability"))
	fmt.Printf("     stacks running: %d   tld: .%s\n", len(o.store.Stacks()), o.cfg.Naming.TLD)
	return nil
}
