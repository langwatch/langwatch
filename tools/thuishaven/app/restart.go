package app

import (
	"context"
	"fmt"
	"slices"
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
	_, err := o.prepareLangyContainer(ctx, st, langyImageOptions{RepoRoot: p.WorktreeDir, ForceRebuild: true})
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
	st, ok := o.stackBySlug(slug)
	if !ok {
		return nil, fmt.Errorf("no registered stack %q — is it up? (haven up)", slug)
	}
	if !o.launcherIsOurs(st) {
		return nil, fmt.Errorf("stack %q is not running (its launcher is gone) — start it with `haven up`", slug)
	}
	targets := restartTargets(st, name)
	if len(targets) == 0 {
		return nil, fmt.Errorf("unknown service %q — restartable: %s", name, strings.Join(restartableNames(st), ", "))
	}
	var msgs []string
	if slices.ContainsFunc(targets, isSimsTarget) {
		if goLane, ok := o.goLaneHostingSims(st); ok {
			targets = foldSimsIntoGoLane(targets, goLane)
			msgs = append(msgs, fmt.Sprintf("%-10s run inside the go lane (one process; LANGWATCH_DEV_ONE_PROCESS=0 splits them), so the go lane restarts with them", SimsLane))
		}
	}
	for _, t := range targets {
		pids := o.sys.PIDsOnPort(t.Port)
		if len(pids) == 0 {
			msgs = append(msgs, fmt.Sprintf("%-10s nothing on :%d, the supervisor will start it", t.Name, t.Port))
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
		msgs = append(msgs, fmt.Sprintf("%-10s bounced :%d, the supervisor brings it back", t.Name, t.Port))
	}
	return msgs, nil
}

// goLaneHostingSims is the go lane when the process holding the simulators'
// port also holds the go lane's: one process folded them in.
func (o *Orchestrator) goLaneHostingSims(st domain.Stack) (restartTarget, bool) {
	goLane, sims := restartTargets(st, GoLane), restartTargets(st, SimsLane)
	if len(goLane) == 0 || len(sims) == 0 {
		return restartTarget{}, false
	}
	goPIDs := o.sys.PIDsOnPort(goLane[0].Port)
	for _, pid := range o.sys.PIDsOnPort(sims[0].Port) {
		if slices.Contains(goPIDs, pid) {
			return goLane[0], true
		}
	}
	return restartTarget{}, false
}

func isSimsTarget(t restartTarget) bool { return t.Name == SimsLane }

// foldSimsIntoGoLane swaps the sims target for the go lane hosting them, so
// the shared process is bounced once whichever of the two was named.
func foldSimsIntoGoLane(targets []restartTarget, goLane restartTarget) []restartTarget {
	out := slices.DeleteFunc(slices.Clone(targets), isSimsTarget)
	if !slices.ContainsFunc(out, func(t restartTarget) bool { return t.Name == GoLane }) {
		out = append(out, goLane)
	}
	return out
}

// restartTargets resolves which children to bounce. Only supervised children
// qualify: the routed per-worktree services this stack runs itself (not
// baseline fallbacks) — the `app` port is the ui lane's, so it is offered under
// that name — plus the backend lane on its API port.
//
// gateway and nlp share ONE process locally (ADR-004, amendment 2026-09-07),
// offered as the single `go` lane; the simulators the dev build links share
// the `sims` lane likewise. Every lane is its own process group, so bouncing
// one can never reach another's.
//
// name=="" means all of them.
func restartTargets(st domain.Stack, name string) []restartTarget {
	var all []restartTarget
	var goPort, simsPort int
	// A monolith checkout runs each Go service in its own process (its
	// mono-binary hosts no combined one) and serves the browser application and
	// the API from one lane, so there is no `go` lane to collapse into and no
	// `backend` lane to offer.
	mono := st.Layout.IsMonolith()
	inGo := map[string]bool{"gateway": !mono, "nlp": !mono}
	inSims := map[string]bool{}
	if !mono && goLaneHostsSimulators(st.WorktreeDir) {
		for _, sim := range []string{domain.IdPService, domain.MailService, domain.StorageService, domain.VoiceService, domain.LLMService, domain.AnalyticsService, domain.OutboundService, domain.PaymentService, domain.TelemetryService} {
			inSims[sim] = true
		}
	}
	for _, r := range domain.PerWorktreeServices {
		for _, svc := range st.Services {
			if svc.Name != r.Name || svc.IsFallback || svc.Port == 0 {
				continue
			}
			if inSims[svc.Name] {
				if simsPort == 0 {
					simsPort = svc.Port
				}
				continue
			}
			if inGo[svc.Name] {
				if goPort == 0 {
					goPort = svc.Port
				}
				continue
			}
			all = append(all, restartTarget{Name: domain.CLIServiceNameForLayout(svc.Name, st.Layout), Port: svc.Port})
		}
	}
	if goPort != 0 {
		all = append(all, restartTarget{Name: GoLane, Port: goPort})
	}
	if simsPort != 0 {
		all = append(all, restartTarget{Name: SimsLane, Port: simsPort})
	}
	if st.APIPort != 0 && !mono {
		all = append(all, restartTarget{Name: APILane, Port: st.APIPort})
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

// ResolveSelection loads the worktree's sticky service selection (lean default
// when none exists), applies any ±deltas, and persists the result — so the
// choice survives terminals, reboots, and detach. The file is also written on
// a delta-less first up, making the default visible and editable.
func (o *Orchestrator) ResolveSelection(worktreeDir string, deltas []string) (domain.Selection, error) {
	sel, found := o.store.ReadSelection(worktreeDir)
	if !found {
		sel = domain.DefaultSelection()
	}
	sel, err := domain.ApplySelectionDeltasForLayout(sel, deltas, detectLayout(worktreeDir))
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

// ResolveMode applies `up --mode` to the sticky selection ("none" clears it),
// persists a change only once the mode loads, and returns the mode in force
// (specs/setup/deployment-modes.feature).
func (o *Orchestrator) ResolveMode(worktreeDir string, sel domain.Selection, requested string) (domain.Selection, domain.DeploymentMode, error) {
	want := sel.Mode
	if requested == "none" {
		want = ""
	} else if requested != "" {
		want = requested
	}
	var mode domain.DeploymentMode
	if want != "" {
		var err error
		if mode, err = domain.LoadDeploymentMode(worktreeDir, want); err != nil {
			return sel, mode, err
		}
	}
	if want != sel.Mode {
		sel.Mode = want
		if err := o.store.WriteSelection(worktreeDir, sel); err != nil {
			return sel, mode, fmt.Errorf("saving the deployment mode: %w", err)
		}
	}
	return sel, mode, nil
}

// ResolveHold applies `up --watch[=false]` to the sticky selection: a held
// stack's Node host does not reload on a file change. Persists only a change.
func (o *Orchestrator) ResolveHold(worktreeDir string, sel domain.Selection, held bool) (domain.Selection, error) {
	if sel.Held == held {
		return sel, nil
	}
	sel.Held = held
	if err := o.store.WriteSelection(worktreeDir, sel); err != nil {
		return sel, fmt.Errorf("saving the hold: %w", err)
	}
	return sel, nil
}

// ResolveUI applies `up --ui=dev|built` to the sticky selection. Persists only a change.
func (o *Orchestrator) ResolveUI(worktreeDir string, sel domain.Selection, ui string) (domain.Selection, error) {
	if ui != "dev" && ui != "built" {
		return sel, fmt.Errorf("--ui takes dev or built, not %q", ui)
	}
	if sel.BuiltUI == (ui == "built") {
		return sel, nil
	}
	sel.BuiltUI = ui == "built"
	if err := o.store.WriteSelection(worktreeDir, sel); err != nil {
		return sel, fmt.Errorf("saving the ui mode: %w", err)
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
