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
	stackRSS := o.StackRSSByLauncher()
	live, rss := o.stackFootprint(stackRSS)
	selection, haveSelection := o.store.ReadSelection(worktreeDir)
	if !haveSelection && worktreeDir != "" {
		selection = domain.DefaultSelection()
		haveSelection = true
	}

	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(map[string]any{
			"stacks":        o.stackStatuses(stacks),
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
			if treeRSS := stackRSS[s.LauncherPID]; treeRSS > 0 {
				ram = "  ~" + domain.HumanBytes(int64(treeRSS))
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

// stackStatus is a stack as the JSON report renders it: the persisted record
// plus the liveness a reader cannot derive from it. "Registered" and "running"
// are not the same thing: a stack stays on record from `up` until the daemon
// reaps it, so a script that reads a listed stack as a live one sends its
// requests to a hostname with nothing behind it.
type stackStatus struct {
	domain.Stack
	// Live is whether the launcher process is still running.
	Live bool `json:"live"`
	// Services shadows the embedded record's list to add per-service liveness.
	Services []serviceStatus `json:"services"`
	// Lanes are the three Node applications the stack supervises. The routed
	// Services list cannot answer this on its own: only `ui` has a hostname —
	// api and workers hold loopback ports — so a reader asking "is this stack
	// actually running the whole application" had nowhere to look.
	Lanes []laneStatus `json:"lanes"`
}

// laneStatus is one supervised Node lane plus whether its port answers.
type laneStatus struct {
	domain.Lane
	Listening bool `json:"listening"`
}

// serviceStatus is one routed service plus whether anything is actually
// accepting connections on the port its hostname points at.
type serviceStatus struct {
	domain.Service
	Listening bool `json:"listening"`
}

// stackStatuses renders every registered stack for the JSON report. It always
// returns a list, never nil: `stacks: null` and `stacks: []` decode the same in
// most clients but read differently to a person debugging, and "no stack is
// registered" is exactly the state a reader has to be able to tell apart from
// "a stack is registered but dead".
func (o *Orchestrator) stackStatuses(stacks []domain.Stack) []stackStatus {
	out := make([]stackStatus, 0, len(stacks))
	for _, s := range stacks {
		svcs := make([]serviceStatus, 0, len(s.Services))
		for _, svc := range s.Services {
			svcs = append(svcs, serviceStatus{Service: svc, Listening: svc.Port != 0 && o.sys.PortInUse(svc.Port)})
		}
		lanes := make([]laneStatus, 0, len(s.Lanes()))
		for _, lane := range s.Lanes() {
			lanes = append(lanes, laneStatus{Lane: lane, Listening: lane.Port != 0 && o.sys.PortInUse(lane.Port)})
		}
		out = append(out, stackStatus{
			Stack:    s,
			Live:     s.LauncherPID != 0 && o.sys.ProcessAlive(s.LauncherPID),
			Services: svcs,
			Lanes:    lanes,
		})
	}
	return out
}

func (o *Orchestrator) liveness(s domain.Stack) string {
	if o.sys.ProcessAlive(s.LauncherPID) {
		return "live"
	}
	return "stale"
}

// stackFootprint sums the live stacks' whole-tree RSS — the "what are my
// dev stacks actually costing this machine" number.
func (o *Orchestrator) stackFootprint(stackRSS map[int]uint64) (live int, rss uint64) {
	for _, s := range o.store.Stacks() {
		if o.sys.ProcessAlive(s.LauncherPID) {
			live++
			rss += stackRSS[s.LauncherPID]
		}
	}
	return live, rss
}
