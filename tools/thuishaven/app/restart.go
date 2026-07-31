package app

import (
	"context"
	"fmt"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Restart's scopes: one named service, every supervised child, or only the ones
// that stopped answering (RestartUnhealthy). All three go through bounce(),
// which signals process groups and lets the launcher's supervisor bring the
// children back — haven never restarts a child itself.

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
func (o *Orchestrator) Restart(ctx context.Context, p UpParams, name string, rebuild bool) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	if rebuild {
		if name != "langy" {
			return fmt.Errorf("--rebuild applies to container services — `haven restart langy --rebuild`")
		}
		if err := o.rebuildLangyImage(ctx, p, slug); err != nil {
			return err
		}
	}
	return o.RestartStack(ctx, slug, name)
}

// rebuildLangyImage force-builds the current source into the RUNNING stack's
// image tag, so the bounce that follows picks the fresh bytes up without a
// re-plan. (The tag then names newer content than its hash until the next up
// re-derives it — fine for a dev escape hatch.)
func (o *Orchestrator) rebuildLangyImage(ctx context.Context, p UpParams, slug string) error {
	st, ok := o.stackBySlug(slug)
	if !ok {
		return fmt.Errorf("no registered stack %q — is it up? (haven up)", slug)
	}
	if !st.LangyTier.RunsInContainer() {
		return fmt.Errorf("langy runs on the host here (no image) — a plain `haven restart langy` picks up source changes")
	}
	_, err := o.prepareLangyContainer(ctx, p.WorktreeDir, st.LangyImage, true)
	return err
}

// RestartStack is Restart addressed by slug — what the hub (which acts on any
// registered stack, not just the current worktree's) calls. It prints each
// bounce; the interactive dashboard uses RestartStackQuiet instead.
func (o *Orchestrator) RestartStack(ctx context.Context, slug, name string) error {
	// The observability stack is shared, not a stack child — bounce it directly.
	// It keeps no volume, so a restart is also how collected telemetry is reset.
	if name == "obs" {
		return o.restartObservability(ctx)
	}
	msgs, err := o.restartServices(slug, name)
	for _, m := range msgs {
		fmt.Printf("  %s\n", m)
	}
	return err
}

// RestartStackQuiet bounces a service like RestartStack but returns a one-line
// summary instead of printing it. The attached session dashboard owns the
// screen (bubbletea's alt-screen), so a stray write to stdout would corrupt the
// render — the dashboard shows the summary as a toast instead. Observability is
// not offered here: it is shared machinery, bounced from the CLI (`restart obs`).
func (o *Orchestrator) RestartStackQuiet(slug, name string) (string, error) {
	msgs, err := o.restartServices(slug, name)
	if err != nil {
		return "", err
	}
	return strings.Join(msgs, " · "), nil
}

// restartServices SIGTERMs the process group of each supervised child the name
// resolves to (all of them when name is empty) and lets the launcher's
// supervisor bring it back — the crash-restart loop, triggered on purpose. It
// returns one human line per child and never touches the launcher's own group.
func (o *Orchestrator) restartServices(slug, name string) ([]string, error) {
	st, err := o.runningStack(slug)
	if err != nil {
		return nil, err
	}
	targets := restartTargets(st, name)
	if len(targets) == 0 {
		return nil, fmt.Errorf("unknown service %q — restartable: %s", name, strings.Join(restartableNames(st), ", "))
	}
	return o.bounce(st, targets), nil
}

// RestartUnhealthy bounces only the supervised children whose port has stopped
// answering, leaving a working stack alone — "restart what is broken" rather
// than the blanket bounce of a plain `haven restart`. It returns the names it
// bounced (nil when everything answers), so the caller can follow exactly those.
func (o *Orchestrator) RestartUnhealthy(_ context.Context, p UpParams) ([]string, error) {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return nil, err
	}
	st, err := o.runningStack(slug)
	if err != nil {
		return nil, err
	}
	sick := unhealthyTargets(restartTargets(st, ""), o.sys.PortInUse)
	if len(sick) == 0 {
		fmt.Printf("  every supervised service on %q is answering — nothing to bounce\n", slug)
		return nil, nil
	}
	for _, m := range o.bounce(st, sick) {
		fmt.Printf("  %s\n", m)
	}
	names := make([]string, len(sick))
	for i, t := range sick {
		names[i] = t.Name
	}
	return names, nil
}

// unhealthyTargets picks the restart targets whose port is not answering. A
// target with no port cannot be probed, so it is left alone rather than bounced
// on a guess — `haven restart` with no argument is what bounces regardless.
func unhealthyTargets(targets []restartTarget, portUp func(int) bool) []restartTarget {
	var out []restartTarget
	for _, t := range targets {
		if t.Port == 0 || portUp(t.Port) {
			continue
		}
		out = append(out, t)
	}
	return out
}

// runningStack resolves a slug to a stack that can actually be acted on: one
// that is registered, and whose launcher is still alive to restart what we
// signal. Both refusals name the command that fixes them.
func (o *Orchestrator) runningStack(slug string) (domain.Stack, error) {
	st, ok := o.stackBySlug(slug)
	if !ok {
		return domain.Stack{}, fmt.Errorf("no registered stack %q — is it up? (haven up)", slug)
	}
	if !o.sys.ProcessAlive(st.LauncherPID) {
		return domain.Stack{}, fmt.Errorf("stack %q is not running (its launcher is gone) — start it with `haven up`", slug)
	}
	return st, nil
}

// bounce SIGTERMs each target's process group and lets the launcher's supervisor
// bring it back, returning one human line per child. It never signals the
// launcher's own group: that would take the whole stack down instead of a child.
func (o *Orchestrator) bounce(st domain.Stack, targets []restartTarget) []string {
	var msgs []string
	for _, t := range targets {
		pids := o.sys.PIDsOnPort(t.Port)
		if len(pids) == 0 {
			msgs = append(msgs, fmt.Sprintf("%-10s nothing on :%d, the supervisor will start it", t.Name, t.Port))
			continue
		}
		for _, pid := range pids {
			if pid == st.LauncherPID {
				continue
			}
			o.sys.TerminateGroup(pid)
		}
		msgs = append(msgs, fmt.Sprintf("%-10s bounced :%d, the supervisor brings it back", t.Name, t.Port))
	}
	return msgs
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
				all = append(all, restartTarget{Name: domain.CLIServiceName(svc.Name), Port: svc.Port})
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

// LiveStackForWorktree answers "is this worktree's own stack up right now" —
// what makes bare `haven` open that stack's attached view instead of the fleet
// hub. A registered stack whose launcher has died is deliberately not live:
// there is nothing to attach to, so the hub stays the right answer.
func (o *Orchestrator) LiveStackForWorktree(p UpParams) (string, bool) {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return "", false
	}
	st, ok := o.stackBySlug(slug)
	if !ok || !o.sys.ProcessAlive(st.LauncherPID) {
		return "", false
	}
	return slug, true
}

// ResolveSelection loads the worktree's sticky service selection (lean default
// when none exists), applies any ±deltas, and persists the result — so the
// choice survives terminals, reboots, and detach. The file is also written on
// a delta-less first up, making the default visible and editable.
func (o *Orchestrator) ResolveSelection(worktreeDir string, deltas []string) (domain.Selection, error) {
	sel, found := o.store.ReadSelection(worktreeDir)
	if !found {
		sel = domain.DefaultSelection()
	}
	sel, err := domain.ApplySelectionDeltas(sel, deltas)
	if err != nil {
		return sel, err
	}
	if len(deltas) > 0 || !found {
		if err := o.store.WriteSelection(worktreeDir, sel); err != nil {
			return sel, fmt.Errorf("saving the service selection: %w", err)
		}
	}
	return sel, nil
}

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
