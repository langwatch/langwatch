package app

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// errNotLive is why a selection change cannot be applied to the running stack
// in place; the caller restarts it instead, or says how to.
var errNotLive = errors.New("not applicable in place")

// SwitchService turns one service of this worktree's stack on or off (`haven
// service on|off <name>`). The selection is already saved; a running stack
// keeps its mode and starts or stops only the lanes the change touches.
func (o *Orchestrator) SwitchService(ctx context.Context, p UpParams, opts PlanOptions) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	st, ok := o.stackBySlug(slug)
	if !ok || !o.launcherIsOurs(st) {
		fmt.Printf("saved: %s\n  the stack is not running; `haven up` starts it with this selection\n", opts.Selection.DescribeForLayout(detectLayout(p.WorktreeDir)))
		return nil
	}
	if !st.KeeperReplans {
		return fmt.Errorf("stack %q runs a keeper from before live service switches; the selection is saved, and `haven up --force` restarts the stack with it", slug)
	}
	opts.Selection.Refresh = st.Refresh
	opts.ShouldGoWatch = opts.ShouldGoWatch && !opts.Selection.IsStill()
	if requested := opts.Selection; domain.SelectionFromStack(st) == withoutMode(requested) {
		fmt.Printf("stack %q already runs that way — nothing to change\n", slug)
		return nil
	}
	o.resolveLangyTier(ctx, &opts)
	o.resolveLangyImageTag(&opts)
	release, _, err := o.sem.Acquire(ctx, "up-"+slug, 1)
	if err != nil {
		return err
	}
	defer release()
	switch err := o.applySelectionLive(ctx, p, opts); {
	case errors.Is(err, errNotLive):
		return fmt.Errorf("stack %q cannot take this change in place (its mode, langy image or isolation differs); the selection is saved, and `haven up --force` restarts the stack with it", slug)
	default:
		return err
	}
}

// liveStack is the running stack opts may change in place: same mode, refresh,
// isolation, proxy and langy image (unless langy itself is switching), with a
// keeper that replans. Anything else is errNotLive.
func (o *Orchestrator) liveStack(p UpParams, opts PlanOptions) (domain.Stack, error) {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return domain.Stack{}, err
	}
	st, ok := o.stackBySlug(slug)
	if !ok || !st.KeeperReplans || st.LauncherPID == o.sys.Getpid() || !o.launcherIsOurs(st) || opts.ShouldForce || opts.ShouldRebuildImages {
		return domain.Stack{}, errNotLive
	}
	running := domain.SelectionFromStack(st)
	if running == withoutMode(opts.Selection) {
		return domain.Stack{}, errNotLive // nothing to change: up says so itself
	}
	isLangySwitching := running.Langy != opts.Selection.Langy
	isSame := st.Mode == opts.DeploymentMode.Name && slices.Equal(st.ModeEnv, opts.DeploymentMode.Env) &&
		st.LangyTier == opts.LangyTier && st.PortlessDisabled == o.cfg.PortlessDisabled &&
		st.Refresh == opts.Selection.Refresh && (st.LangyImage == opts.langyImageTag || isLangySwitching)
	if !isSame {
		return domain.Stack{}, errNotLive
	}
	return st, nil
}

// applySelectionLive changes a running stack's services to opts.Selection in
// place: ports and routes for what turns on, none for what turns off, then a
// rewritten keeper plan the keeper applies lane by lane (keeper_live.go).
func (o *Orchestrator) applySelectionLive(ctx context.Context, p UpParams, opts PlanOptions) error {
	st, err := o.liveStack(p, opts)
	if err != nil {
		return err
	}
	isTurningOn := opts.Selection.TurnsOnAny(domain.SelectionFromStack(st))
	if err := o.reserviceStack(&st, opts); err != nil {
		return err
	}
	st.AppOff = opts.Selection.AppOff
	st.LangyImage = opts.langyImageTag
	opts.langyDockerHost = o.langyContainerHost(ctx, st, &opts)
	o.ensureLangyWorkerBinary(ctx, st, &opts)
	o.ensureLangyCLI(ctx, st, &opts)
	plan, err := o.ReadKeeperPlan(st.Slug)
	if err != nil {
		return err
	}
	children := o.planChildren(st, opts, p.WorktreeDir)
	if !isTurningOn {
		children = keepRunningEnv(plan.Children, children)
	}
	change := diffLanes(plan.Children, children)
	st.UpdatedAt = o.sys.Now()
	if err := o.store.SaveStack(st); err != nil {
		return err
	}
	plan.Children, plan.Seed = children, nil
	if err := writeKeeperPlan(keeperPlanPath(st.WorktreeDir, st.Slug), plan); err != nil {
		return fmt.Errorf("writing the keeper plan: %w", err)
	}
	o.sys.Replan(st.LauncherPID)
	fmt.Printf("stack %q changed in place — %s\n  %s\n", st.Slug, describeLaneChange(change), opts.Selection.DescribeForLayout(st.Layout))
	return nil
}

// describeLaneChange is a LaneChange in one line.
func describeLaneChange(c LaneChange) string {
	if c.IsEmpty() {
		return "no lane changes"
	}
	var parts []string
	for _, part := range []struct {
		verb  string
		lanes []string
	}{{"starting", c.Start}, {"stopping", c.Stop}, {"restarting", c.Restart}} {
		if len(part.lanes) > 0 {
			parts = append(parts, part.verb+" "+strings.Join(part.lanes, ", "))
		}
	}
	return strings.Join(parts, " · ")
}

// reserviceStack gives each per-worktree service that switches on a port and a
// route, as provision does, and takes them from each that switches off.
func (o *Orchestrator) reserviceStack(st *domain.Stack, opts PlanOptions) error {
	var routes []func()
	for i := range st.Services {
		svc := &st.Services[i]
		if !isPerWorktreeService(svc.Name) || svc.Name == "app" {
			continue
		}
		isOn, isRunning := runsLocally(svc.Name, opts), svc.Port != 0 && !svc.IsFallback
		if isOn == isRunning {
			continue
		}
		if err := o.reservice(st.Slug, svc, isOn); err != nil {
			return err
		}
		routes = append(routes, o.serviceRoutes(st.Slug, svc)...)
	}
	inParallel(routes)
	return nil
}

// reservice switches one service record on (fresh ports) or off (none, or the
// baseline stack's copy, as provision falls back), and sets its URL to match.
func (o *Orchestrator) reservice(slug string, svc *domain.Service, isOn bool) error {
	if isOn {
		ports, err := o.sys.FreePorts(3)
		if err != nil {
			return err
		}
		svc.Port, svc.IsFallback = ports[0], false
		svc.DNSPort, svc.SMTPPort = portFor(svc.Name == domain.IdPService, ports[1]), portFor(svc.Name == domain.MailService, ports[2])
		if port := o.stableLLMPort(slug); svc.Name == domain.LLMService && port != 0 {
			svc.Port = port
		}
	} else {
		o.removeServiceRoutes(slug, svc.Name)
		svc.Port, svc.DNSPort, svc.SMTPPort = 0, 0, 0
		if base, ok := o.baselineService(svc.Name); ok {
			svc.Port, svc.DNSPort, svc.SMTPPort, svc.IsFallback = base.Port, base.DNSPort, base.SMTPPort, true
		}
	}
	svc.URL = ""
	if !o.cfg.PortlessDisabled || svc.Port != 0 {
		proxyScheme, proxyPort := o.proxy.Endpoint()
		scheme, port := o.serviceEndpoint(proxyScheme, proxyPort, svc.Port)
		svc.URL = o.cfg.Naming.URL(svc.Name, slug, scheme, port)
	}
	return nil
}

func portFor(isWanted bool, port int) int {
	if isWanted {
		return port
	}
	return 0
}

// serviceRoutes are the registrations of a service with a port: its hostname
// and its aliases.
func (o *Orchestrator) serviceRoutes(slug string, svc *domain.Service) []func() {
	if svc.Port == 0 || o.cfg.PortlessDisabled {
		return nil
	}
	routes := []func(){o.registerRoute(svc.Name, slug, svc.Port)}
	for _, alias := range domain.ServiceHostAliases[svc.Name] {
		routes = append(routes, o.registerRoute(alias, slug, svc.Port))
	}
	return routes
}

// removeServiceRoutes deregisters one service's hostname and its aliases.
func (o *Orchestrator) removeServiceRoutes(slug, name string) {
	if o.cfg.PortlessDisabled {
		return
	}
	o.proxy.Remove(name, slug)
	for _, alias := range domain.ServiceHostAliases[name] {
		o.proxy.Remove(alias, slug)
	}
}

func isPerWorktreeService(name string) bool {
	return slices.ContainsFunc(domain.PerWorktreeServices, func(r struct{ Name, Role string }) bool { return r.Name == name })
}

// withoutMode is sel as a stack record can express it: the deployment mode is
// compared on its own, from the record's Mode and ModeEnv.
func withoutMode(sel domain.Selection) domain.Selection {
	sel.Mode = ""
	return sel
}

// keepRunningEnv keeps each running lane whose next plan differs only in its
// environment. Switching services off only removes addresses, and a lane left
// holding a stopped service's address is the same as that service being off,
// so it is not restarted for it. Switching one on restarts them: they need it.
func keepRunningEnv(running, next []Child) []Child {
	out := slices.Clone(next)
	for i := range out {
		name := out[i].Name
		j := slices.IndexFunc(running, func(r Child) bool { return r.Name == name })
		if j < 0 {
			continue
		}
		withRunningEnv := out[i]
		withRunningEnv.Env = running[j].Env
		if sameLane(&running[j], &withRunningEnv) {
			out[i] = running[j]
		}
	}
	return out
}
