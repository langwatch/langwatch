package app

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// InfraContainerLister is the optional slice of the ContainerJanitor that
// lists running containers and stops one; a janitor without it leaves the
// sweep to host processes. It never starts the VM.
type InfraContainerLister interface {
	InfraContainers(ctx context.Context) ([]domain.InfraContainer, error)
	StopContainer(ctx context.Context, id string) error
}

// DuplicateLimitsFromEnv resolves the sweep's knobs: HAVEN_DEDUPE (off, report,
// stop) and HAVEN_DEDUPE_MIN_AGE.
func DuplicateLimitsFromEnv(lookup func(string) string) domain.DuplicateLimits {
	l := domain.DefaultDuplicateLimits()
	l.Mode = domain.ParseDuplicateMode(lookup("HAVEN_DEDUPE"))
	if d, err := time.ParseDuration(lookup("HAVEN_DEDUPE_MIN_AGE")); err == nil && d > 0 {
		l.MinAge = d
	}
	return l
}

// dupTerm is one SIGTERM the sweep sent: pid plus start is the identity.
type dupTerm struct {
	started time.Time
	at      time.Time
}

// dedupeState is the sweep's memory between ticks. It lives beside the
// Orchestrator rather than on it until a field there is agreed.
type dedupeState struct {
	mu      sync.Mutex
	sweptAt time.Time
	termed  map[int]dupTerm
	noted   map[string]time.Time // instance key -> its start; logged once
}

var dedupeStates sync.Map // *Orchestrator -> *dedupeState

func (o *Orchestrator) dedupe() *dedupeState {
	st, _ := dedupeStates.LoadOrStore(o, &dedupeState{termed: map[int]dupTerm{}, noted: map[string]time.Time{}})
	return st.(*dedupeState)
}

// infraTree is one host instance: its root sample and its same-kind members.
type infraTree struct {
	root    ProcessSample
	members []int
}

// procView is one sampling of the process table.
type procView struct {
	samples  []ProcessSample
	byPID    map[int]ProcessSample
	children map[int][]int
}

func (o *Orchestrator) sampleProcs() procView {
	samples := o.processSamples()
	byPID, children := processTree(samples)
	return procView{samples: samples, byPID: byPID, children: children}
}

// dupSweep is one sweep's working set.
type dupSweep struct {
	st                *dedupeState
	now               time.Time
	trees             map[int]infraTree
	stoppedContainers map[string]bool
}

// sweepDuplicates keeps haven's canonical copy of each infra kind, stops a
// copy nobody owns any more, and reports the rest once per instance.
func (o *Orchestrator) sweepDuplicates(ctx context.Context) {
	l := o.cfg.Duplicates
	if !l.Enabled() {
		return
	}
	st := o.dedupe()
	st.mu.Lock()
	defer st.mu.Unlock()
	now := o.sys.Now()
	if !st.sweptAt.IsZero() && now.Sub(st.sweptAt) < l.Every {
		return
	}
	st.sweptAt = now
	view := o.sampleProcs()
	o.killIgnoredDuplicateTerms(st, view.byPID, now)
	groups, trees := o.judgeInfra(ctx, view)
	sw := dupSweep{st: st, now: now, trees: trees, stoppedContainers: map[string]bool{}}
	seen := map[string]bool{}
	for gi := range groups {
		for ii := range groups[gi].Instances {
			j := &groups[gi].Instances[ii]
			seen[instanceKey(j.InfraInstance)] = true
			if sw.isNew(j) {
				o.actOnDuplicate(ctx, &sw, &groups[gi], j)
			}
		}
	}
	for key := range st.noted {
		if !seen[key] {
			delete(st.noted, key)
		}
	}
}

// isNew reports whether j has not been acted on yet, and marks it.
func (sw *dupSweep) isNew(j *domain.JudgedInstance) bool {
	if _, termed := sw.st.termed[j.PID]; termed && j.PID > 0 {
		return false
	}
	key := instanceKey(j.InfraInstance)
	start := sw.now.Add(-j.Elapsed)
	if prev, ok := sw.st.noted[key]; ok && prev.Sub(start).Abs() <= 5*time.Second {
		return false
	}
	sw.st.noted[key] = start
	return true
}

// actOnDuplicate is the one-time action for a newly seen instance.
func (o *Orchestrator) actOnDuplicate(ctx context.Context, sw *dupSweep, g *domain.DuplicateGroup, j *domain.JudgedInstance) {
	fields := []zap.Field{zap.String("kind", string(g.Kind)), zap.String("instance", j.Label()), zap.Strings("kept", g.Kept())}
	switch {
	case j.Verdict == domain.VerdictKept:
		return
	case j.Verdict == domain.VerdictLeft && !g.Canonical:
		o.log.Warn("infra running more than once and none is haven's: left", append(fields, zap.String("summary", g.Describe()))...)
		return
	case j.Verdict == domain.VerdictLeft:
		o.log.Info("duplicate infra left running", append(fields, zap.String("why", j.Why))...)
		return
	case o.cfg.Duplicates.Mode != domain.DuplicatesStop:
		o.log.Info("duplicate infra would be stopped (report mode)", fields...)
		return
	}
	if !o.stopDuplicate(ctx, sw, j, fields) {
		return
	}
	reason := fmt.Sprintf("a second %s beside %s; %s", g.Kind, strings.Join(g.Kept(), ", "), j.Why)
	o.recordReap(domain.DuplicateClass, j.Label(), reason)
	o.log.Info("stopped duplicate infra", append(fields, zap.String("reason", reason))...)
}

// stopDuplicate SIGTERMs a process tree or stops a container; false when
// nothing was stopped (a failure, or the LGTM bundle already stopped).
func (o *Orchestrator) stopDuplicate(ctx context.Context, sw *dupSweep, j *domain.JudgedInstance, fields []zap.Field) bool {
	if j.PID > 0 {
		tree := sw.trees[j.PID]
		for _, pid := range append([]int{tree.root.PID}, tree.members...) {
			o.sys.Terminate(pid)
			sw.st.termed[pid] = dupTerm{started: sw.now.Add(-tree.root.Elapsed), at: sw.now}
		}
		return true
	}
	lister, _ := o.janitor.(InfraContainerLister)
	if lister == nil || sw.stoppedContainers[j.ContainerID] {
		return false
	}
	sw.stoppedContainers[j.ContainerID] = true
	if err := lister.StopContainer(ctx, j.ContainerID); err != nil {
		o.log.Warn("could not stop duplicate infra container", append(fields, zap.Error(err))...)
		return false
	}
	return true
}

// killIgnoredDuplicateTerms SIGKILLs what outlived KillGrace, silently: the
// SIGTERM already logged and recorded the stop.
func (o *Orchestrator) killIgnoredDuplicateTerms(st *dedupeState, byPID map[int]ProcessSample, now time.Time) {
	for pid, term := range st.termed {
		s, alive := byPID[pid]
		if !alive || now.Add(-s.Elapsed).Sub(term.started).Abs() > 5*time.Second {
			delete(st.termed, pid)
			continue
		}
		if now.Sub(term.at) >= o.cfg.Duplicates.KillGrace {
			o.sys.Kill(pid)
			delete(st.termed, pid)
		}
	}
}

// InfraDuplicates is the read-only view `haven status` prints, one
// DuplicateGroup.Describe line per kind running more than once.
func (o *Orchestrator) InfraDuplicates(ctx context.Context) []domain.DuplicateGroup {
	groups, _ := o.judgeInfra(ctx, o.sampleProcs())
	return groups
}

// judgeInfra gathers every host and container instance and judges them.
func (o *Orchestrator) judgeInfra(ctx context.Context, view procView) ([]domain.DuplicateGroup, map[int]infraTree) {
	refPorts := o.referencedInfraPorts()
	refPIDs := map[int]int{}
	for port := range refPorts {
		for _, pid := range o.sys.PIDsOnPort(port) {
			refPIDs[pid] = port
		}
	}
	protected := o.protectedTrees(view.byPID, view.children)
	trees := infraTrees(view)
	var instances []domain.InfraInstance
	var unreferenced []int
	for _, t := range trees {
		inst := o.hostInstance(t, view.byPID, refPIDs)
		inst.Protected = protected[t.root.PID]
		if !inst.Referenced {
			unreferenced = append(unreferenced, t.root.PID)
		}
		instances = append(instances, inst)
	}
	if len(unreferenced) > 0 {
		roots := append(o.orphanRoots(), o.cfg.Home)
		cwds := o.sys.ProcessCwds(unreferenced)
		for n := range instances {
			cmd := trees[instances[n].PID].root.Command
			instances[n].InScope = domain.UnderRoots(cwds[instances[n].PID], roots) || domain.MentionsRoot(cmd, roots)
		}
	}
	instances = append(instances, o.containerInstances(ctx, refPorts)...)
	return domain.JudgeDuplicates(instances), trees
}

// infraTrees groups same-kind processes under their topmost same-kind
// ancestor, so a server and its watchdog count once.
func infraTrees(view procView) map[int]infraTree {
	trees := map[int]infraTree{}
	for i := range view.samples {
		s := &view.samples[i]
		kind, ok := domain.InfraKindOfCommand(s.Command)
		if !ok || s.PID <= 1 || sameKind(view.byPID[s.PPID].Command, kind) {
			continue
		}
		t := infraTree{root: *s}
		for _, pid := range treeOf(s.PID, view.children)[1:] {
			if sameKind(view.byPID[pid].Command, kind) {
				t.members = append(t.members, pid)
			}
		}
		trees[s.PID] = t
	}
	return trees
}

func sameKind(command string, kind domain.InfraKind) bool {
	k, ok := domain.InfraKindOfCommand(command)
	return ok && k == kind
}

// hostInstance fills one process tree's facts; scope is filled by the caller.
func (o *Orchestrator) hostInstance(t infraTree, byPID map[int]ProcessSample, refPIDs map[int]int) domain.InfraInstance {
	kind, _ := domain.InfraKindOfCommand(t.root.Command)
	inst := domain.InfraInstance{
		Kind: kind, PID: t.root.PID, Port: domain.CommandPort(t.root.Command),
		Origin:    domain.ProcessOrigin(t.root.Command, o.cfg.Home),
		Elapsed:   t.root.Elapsed,
		OldEnough: t.root.Elapsed >= o.cfg.Duplicates.MinAge,
	}
	for _, pid := range append([]int{t.root.PID}, t.members...) {
		if port, ok := refPIDs[pid]; ok {
			inst.Referenced, inst.Port = true, port
		}
	}
	if parent, ok := byPID[t.root.PPID]; ok && t.root.PPID > 1 {
		inst.OwnerAlive = true
		inst.Owner = fmt.Sprintf("%s (pid %d)", ownerName(parent.Command), parent.PID)
	}
	return inst
}

// containerInstances lists running containers of an infra kind, one instance
// per kind (the LGTM bundle stands for five). Only haven's own singletons are
// in scope; a test run's or a compose project's are reported, never stopped.
func (o *Orchestrator) containerInstances(ctx context.Context, refPorts map[int]bool) []domain.InfraInstance {
	lister, _ := o.janitor.(InfraContainerLister)
	if lister == nil {
		return nil
	}
	containers, err := lister.InfraContainers(ctx)
	if err != nil {
		o.log.Debug("duplicate sweep: container listing failed", zap.Error(err))
		return nil
	}
	roots := append(o.orphanRoots(), o.cfg.Home)
	var out []domain.InfraInstance
	for i := range containers {
		base := containerInstance(&containers[i], refPorts, roots)
		for _, kind := range domain.InfraKindsOfImage(containers[i].Image) {
			inst := base
			inst.Kind = kind
			out = append(out, inst)
		}
	}
	return out
}

// containerInstance is one container's facts, before its kinds are known.
func containerInstance(c *domain.InfraContainer, refPorts map[int]bool, roots []string) domain.InfraInstance {
	inst := domain.InfraInstance{Container: c.Name, ContainerID: c.ID, Origin: c.Name, OldEnough: true, InScope: domain.HavenContainer(c.Name)}
	for _, p := range c.Ports {
		if refPorts[p] {
			inst.Referenced, inst.Port = true, p
		}
	}
	if inst.Port == 0 && len(c.Ports) > 0 {
		inst.Port = c.Ports[0]
	}
	composeDir := c.Labels[domain.ComposeWorkingDirLabel]
	switch {
	case c.Labels["org.testcontainers"] == "true":
		inst.OwnerAlive, inst.Owner, inst.Origin = true, "a test run (testcontainers)", "testcontainers"
	case composeDir != "" && domain.UnderRoots(composeDir, roots):
		inst.OwnerAlive, inst.Owner, inst.Origin = true, "compose project "+c.Labels["com.docker.compose.project"], "compose"
	}
	return inst
}

// referencedInfraPorts are the ports haven's config and every registered stack
// point at: whatever listens there is canonical.
func (o *Orchestrator) referencedInfraPorts() map[int]bool {
	ports := map[int]bool{}
	addPorts(ports, o.managedInfraPorts()...)
	stacks := o.store.Stacks()
	for i := range stacks {
		s := &stacks[i]
		addPorts(ports, s.RedisPort, s.PostgresPort, s.ClickHouseHTTPPort, s.ObservabilityOTLPPort, s.ObservabilityGrafanaPort, s.ObservabilityPyroscopePort)
	}
	return ports
}

// managedInfraPorts are the servers haven itself manages, from its config.
func (o *Orchestrator) managedInfraPorts() []int {
	var ports []int
	if o.rds != nil && o.cfg.ShouldManageRedis {
		ports = append(ports, o.rds.Port())
	}
	if o.pg != nil && o.cfg.ShouldManagePostgres {
		ports = append(ports, o.pg.Port())
	}
	if o.ch != nil && o.cfg.ShouldManageClickHouse {
		ports = append(ports, o.ch.HTTPPort())
	}
	if o.obs != nil {
		ep := o.obs.Endpoints()
		np := domain.DefaultNativeObservabilityPorts()
		ports = append(ports, ep.GrafanaPort, ep.OTLPHTTPPort, ep.OTLPGRPCPort, ep.PyroscopePort,
			np.PrometheusHTTP, np.LokiHTTP, np.TempoHTTP, np.CollectorHTTP)
	}
	return ports
}

func addPorts(set map[int]bool, ports ...int) {
	for _, p := range ports {
		if p > 0 {
			set[p] = true
		}
	}
}

// ownerName is a parent's binary and its subcommand: "upgradelab cell".
func ownerName(command string) string {
	fields := strings.Fields(command)
	if len(fields) == 0 {
		return "unknown"
	}
	name := filepath.Base(fields[0])
	if len(fields) > 1 && !strings.HasPrefix(fields[1], "-") && !strings.Contains(fields[1], "/") {
		name += " " + fields[1]
	}
	return name
}

func instanceKey(i domain.InfraInstance) string {
	if i.ContainerID != "" {
		return "container:" + i.ContainerID + ":" + string(i.Kind)
	}
	return fmt.Sprintf("pid:%d", i.PID)
}
