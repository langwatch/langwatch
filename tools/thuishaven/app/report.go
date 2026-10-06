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
func (o *Orchestrator) Status(asJSON bool, worktreeDir string, reveal bool) error {
	r := o.collectStatus(worktreeDir)
	if asJSON {
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(map[string]any{
			"stacks":        o.stackStatuses(r.stacks),
			"dashboard":     r.shared(domain.HubService),
			"observability": r.shared("observability"),
			"telemetry":     r.shared("telemetry"),
			"proxy":         r.proxy,
			"daemon":        r.daemon,
			"servers":       r.servers,
			"footprint":     map[string]any{"live": r.live, "rssBytes": r.rss},
			"selection":     r.selection,
			"overlay":       o.worktreeOverlay(worktreeDir, reveal),
			"nxDaemons":     r.nxDaemons,
		})
	}
	if r.haveSelection {
		fmt.Printf("this worktree — %s\n\n", r.selection.Describe())
	}
	o.printStacks(r)
	fmt.Println()
	o.printShared(r)
	o.printWorktreeOverlay(worktreeDir, reveal)
	fmt.Printf("\nstacks: %d (%d live, ~%s RAM)   dashboard %s   tld: .%s\n",
		len(r.stacks), r.live, domain.HumanBytes(int64(r.rss)), r.shared(domain.HubService), o.cfg.Naming.TLD)
	return nil
}

// statusReport is everything Status reports, gathered once for either form.
type statusReport struct {
	stacks        []domain.Stack
	shared        func(svc string) string
	proxy, daemon health
	servers       map[string]health
	nxDaemons     []NxDaemon
	stackRSS      map[int]uint64
	live          int
	rss           uint64
	selection     domain.Selection
	haveSelection bool
}

func (o *Orchestrator) collectStatus(worktreeDir string) statusReport {
	scheme, port := o.proxy.Endpoint()
	info, daemonUp := o.store.Daemon()
	r := statusReport{
		stacks:   o.store.Stacks(),
		shared:   func(svc string) string { return o.cfg.Naming.URL(svc, "", scheme, port) },
		proxy:    health{OK: o.proxy.Running(), Detail: fmt.Sprintf("%s on :%d", scheme, port)},
		daemon:   health{OK: daemonUp && o.sys.ProcessAlive(info.PID), Detail: fmt.Sprintf("pid %d", info.PID)},
		servers:  o.serverHealth(context.Background()),
		stackRSS: o.StackRSSByLauncher(),
	}
	r.nxDaemons = o.NxDaemons()
	r.live, r.rss = o.stackFootprint(r.stackRSS)
	r.selection, r.haveSelection = o.store.ReadSelection(worktreeDir)
	if !r.haveSelection && worktreeDir != "" {
		r.selection = domain.DefaultSelection()
		r.haveSelection = true
	}
	return r
}

// serverHealth is the health of each shared server haven manages here.
func (o *Orchestrator) serverHealth(ctx context.Context) map[string]health {
	servers := map[string]health{}
	probes := []struct {
		name      string
		isManaged bool
		probe     func() (bool, string)
	}{
		{"observability", o.obs != nil, func() (bool, string) { return o.obs.Health(ctx) }},
		{"clickhouse", o.ch != nil && o.cfg.ShouldManageClickHouse, func() (bool, string) { return o.ch.Health(ctx) }},
		{"postgres", o.pg != nil && o.cfg.ShouldManagePostgres, func() (bool, string) { return o.pg.Health(ctx) }},
		{"redis", o.rds != nil && o.cfg.ShouldManageRedis, func() (bool, string) { return o.rds.Health(ctx) }},
	}
	for _, p := range probes {
		if p.isManaged {
			ok, detail := p.probe()
			servers[p.name] = health{OK: ok, Detail: detail}
		}
	}
	return servers
}

// printStacks is one line per stack, with its RAM, and a dot per service that
// is listening.
func (o *Orchestrator) printStacks(r statusReport) {
	if len(r.stacks) == 0 {
		fmt.Println("no stacks running — start one with `haven up` in a worktree")
	}
	for _, s := range r.stacks {
		ram := ""
		if treeRSS := r.stackRSS[s.LauncherPID]; treeRSS > 0 && o.sys.ProcessAlive(s.LauncherPID) {
			ram = "  ~" + domain.HumanBytes(int64(treeRSS))
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
}

func statusMark(b bool) string {
	if b {
		return "ok  "
	}
	return "MISS"
}

// printShared is the proxy, the daemon, each managed server and the nx daemons.
func (o *Orchestrator) printShared(r statusReport) {
	fmt.Printf("%s portless proxy (%s)\n", statusMark(r.proxy.OK), r.proxy.Detail)
	fmt.Printf("%s haven daemon (%s) -> %s\n", statusMark(r.daemon.OK), r.daemon.Detail, r.shared(o.cfg.Naming.Project))
	for _, name := range []string{"observability", "clickhouse", "postgres", "redis"} {
		h, managed := r.servers[name]
		if !managed {
			continue
		}
		fmt.Printf("%s %s — %s\n", statusMark(h.OK), name, h.Detail)
	}
	for _, d := range r.nxDaemons {
		fmt.Printf("ok   nx daemon pid %d (%s, ~%s)\n", d.PID, d.Worktree, domain.HumanBytes(d.RSS))
	}
}

// worktreeOverlay is what this worktree's stack resolved to. Nothing writes it
// to a file any more, so the report is where a person reads it back: without it
// the only way to see the URLs and database this stack is actually using would
// be to attach to a lane and print its environment. Masked exactly like `haven
// env` unless reveal is set — this is the JSON form an agent pipes around, so
// it must never be the unmasked one by default (see domain.SecretClasses).
func (o *Orchestrator) worktreeOverlay(worktreeDir string, reveal bool) map[string]string {
	if worktreeDir == "" {
		return nil
	}
	st, ok := o.stackByWorktree(worktreeDir)
	if !ok {
		return nil
	}
	env := domain.EnvMap(st.OverlayEnv())
	if reveal {
		return env
	}
	classes := domain.SecretClasses(worktreeDir)
	masked := make(map[string]string, len(env))
	for key, value := range env {
		masked[key] = domain.MaskEnvValue(classes, key, value)
	}
	return masked
}

// printWorktreeOverlay renders the same set for a human, keys sorted, and says
// where to get it into a shell. Silent when this worktree has no stack.
func (o *Orchestrator) printWorktreeOverlay(worktreeDir string, reveal bool) {
	if worktreeDir == "" {
		return
	}
	st, ok := o.stackByWorktree(worktreeDir)
	if !ok {
		return
	}
	env := st.OverlayEnv()
	values := domain.EnvMap(env)
	var classes map[string]domain.SecretClass
	if !reveal {
		classes = domain.SecretClasses(worktreeDir)
	}
	fmt.Printf("\nthis worktree resolved to (eval \"$(haven env --reveal)\" to load it in a shell):\n")
	for _, key := range overlayKeys(env) {
		value := values[key]
		if !reveal {
			value = domain.MaskEnvValue(classes, key, value)
		}
		fmt.Printf("  %-38s %s\n", key, value)
	}
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
	// Services list cannot answer this on its own: `ui` and (additively) `api`
	// have their own hostnames, but the worker lane holds only a loopback
	// metrics port, so a reader asking "is this stack actually running the
	// whole application" had nowhere to look for it.
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
