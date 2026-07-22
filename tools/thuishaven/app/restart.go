package app

import (
	"context"
	"fmt"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// restartTarget is one supervised child `haven restart` can bounce: a name and
// the loopback port its process listens on.
type restartTarget struct {
	Name string
	Port int
}

// Restart bounces one supervised service (or all of them when name is empty)
// without tearing the stack down: it SIGTERMs the process group listening on
// the service's port and lets the launcher's supervisor restart it — exactly
// the crash-restart loop, triggered on purpose. Perfect for services without
// hot reloading. The shared databases (ClickHouse/Postgres/Redis) are not
// restartable this way; they are machine-wide servers, not stack children.
func (o *Orchestrator) Restart(ctx context.Context, p UpParams, name string) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	return o.RestartStack(ctx, slug, name)
}

// RestartStack is Restart addressed by slug — what the hub (which acts on any
// registered stack, not just the current worktree's) calls.
func (o *Orchestrator) RestartStack(ctx context.Context, slug, name string) error {
	// The observability stack is shared, not a stack child — bounce it directly.
	// It keeps no volume, so a restart is also how collected telemetry is reset.
	if name == "obs" {
		return o.restartObservability(ctx)
	}
	st, ok := o.stackBySlug(slug)
	if !ok {
		return fmt.Errorf("no registered stack %q — is it up? (haven up)", slug)
	}
	if !o.sys.ProcessAlive(st.LauncherPID) {
		return fmt.Errorf("stack %q is not running (its launcher is gone) — start it with `haven up`", slug)
	}
	targets := restartTargets(st, name)
	if len(targets) == 0 {
		return fmt.Errorf("unknown service %q — restartable: %s", name, strings.Join(restartableNames(st), ", "))
	}
	for _, t := range targets {
		pids := o.sys.PIDsOnPort(t.Port)
		if len(pids) == 0 {
			fmt.Printf("  %-10s nothing listening on :%d — the supervisor will (re)start it on its own\n", t.Name, t.Port)
			continue
		}
		for _, pid := range pids {
			// Never signal the launcher's own group: that would take the whole
			// stack down instead of one child.
			if pid == st.LauncherPID {
				continue
			}
			o.sys.TerminateGroup(pid)
		}
		fmt.Printf("  %-10s restarting (killed :%d — the supervisor brings it back)\n", t.Name, t.Port)
	}
	return nil
}

// restartTargets resolves which children to bounce. Only supervised children
// qualify: the routed per-worktree services this stack runs itself (not
// baseline fallbacks), plus the API (a backend of app, on its own port) and the
// standalone workers lane when it exists. The workers lane is a target only when
// the stack actually runs one (HasStandaloneWorkers); in the default in-process
// mode the API child holds WorkerMetricsPort, so exposing `workers` there would
// bounce the API instead. name=="" means all of them.
func restartTargets(st domain.Stack, name string) []restartTarget {
	var all []restartTarget
	for _, r := range domain.PerWorktreeServices {
		for _, svc := range st.Services {
			if svc.Name == r.Name && !svc.IsFallback && svc.Port != 0 {
				all = append(all, restartTarget{Name: svc.Name, Port: svc.Port})
			}
		}
	}
	if st.APIPort != 0 {
		all = append(all, restartTarget{Name: "api", Port: st.APIPort})
	}
	if st.HasStandaloneWorkers && st.WorkerMetricsPort != 0 {
		all = append(all, restartTarget{Name: "workers", Port: st.WorkerMetricsPort})
	}
	if name == "" {
		return all
	}
	for _, t := range all {
		if t.Name == name {
			return []restartTarget{t}
		}
	}
	return nil
}

// restartableNames lists what restartTargets would accept, for the error hint.
func restartableNames(st domain.Stack) []string {
	var names []string
	for _, t := range restartTargets(st, "") {
		names = append(names, t.Name)
	}
	return names
}

// ResolveSlug exposes slug resolution to the composition root (for log paths,
// detached up).
func (o *Orchestrator) ResolveSlug(p UpParams) (string, error) { return o.resolveSlug(p) }

// restartObservability stops and re-ensures the shared LGTM stack, re-routing
// its hostname. Telemetry starts fresh — the stack keeps no volume by design.
func (o *Orchestrator) restartObservability(ctx context.Context) error {
	if o.obs == nil {
		return fmt.Errorf("observability is not managed here")
	}
	_ = o.obs.Stop(ctx)
	endpoints, err := o.obs.Ensure(ctx)
	if err != nil {
		return err
	}
	o.routeObservability()
	fmt.Printf("observability restarted — grafana %s (telemetry starts fresh; it keeps no volume)\n", endpoints.GrafanaURL())
	return nil
}
