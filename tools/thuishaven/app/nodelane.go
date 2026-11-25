package app

import (
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// WorkersLane names the worker application's half of a stack. In dev it runs
// inside the api lane's process (ADR-004, amendment 2026-09-07); it is found
// by its own metrics port, so a stack that runs it apart is profiled apart.
const WorkersLane = "workers"

// ErrStackNotRunning and ErrLaneNotRunning are a profile target that is down;
// ErrUnknownLane is one that names no Node lane of the stack.
var (
	ErrStackNotRunning = errors.New("stack not running")
	ErrLaneNotRunning  = errors.New("lane not running")
	ErrUnknownLane     = errors.New("unknown lane")
)

// NodeLane is one running Node lane of a stack: the process listening on the
// lane's port, and the checkout its scripts load from.
type NodeLane struct {
	Slug        string `json:"stack"`
	Lane        string `json:"lane"`
	Port        int    `json:"port"`
	PID         int    `json:"pid"`
	WorktreeDir string `json:"worktreeDir"`
	// SharedWith names the other lanes the same process serves (the api
	// lane hosts the workers in dev), so a reader knows the profile is both.
	SharedWith []string `json:"sharedWith,omitempty"`
}

// NodeLaneNames are the lanes of st a profile can name.
func NodeLaneNames(st domain.Stack) []string {
	var names []string
	for _, l := range st.Lanes() {
		names = append(names, l.Name)
	}
	if !st.Layout.IsMonolith() && st.WorkerMetricsPort != 0 {
		names = append(names, WorkersLane)
	}
	return names
}

func lanePorts(st domain.Stack) map[string]int {
	ports := map[string]int{}
	for _, l := range st.Lanes() {
		ports[l.Name] = l.Port
	}
	if !st.Layout.IsMonolith() && st.WorkerMetricsPort != 0 {
		ports[WorkersLane] = st.WorkerMetricsPort
	}
	return ports
}

// NodeLane finds the process behind one Node lane of a running stack; an
// empty lane is the api (the app lane on a monolith).
func (o *Orchestrator) NodeLane(slug, lane string) (NodeLane, error) {
	st, ok := o.stackBySlug(slug)
	if !ok || st.LauncherPID == 0 || !o.sys.ProcessAlive(st.LauncherPID) {
		return NodeLane{}, fmt.Errorf("%w: %s", ErrStackNotRunning, slug)
	}
	ports := lanePorts(st)
	if lane == "" {
		lane = defaultNodeLane(st)
	}
	port, ok := ports[lane]
	if !ok || port == 0 {
		return NodeLane{}, fmt.Errorf("%w %q; %s has %s", ErrUnknownLane, lane, slug, strings.Join(NodeLaneNames(st), ", "))
	}
	pids := o.sys.PIDsOnPort(port)
	if len(pids) == 0 {
		return NodeLane{}, fmt.Errorf("%w: %s on %s (nothing listens on :%d)", ErrLaneNotRunning, lane, slug, port)
	}
	out := NodeLane{Slug: slug, Lane: lane, Port: port, PID: pids[0], WorktreeDir: st.WorktreeDir}
	out.SharedWith = o.lanesServedBy(st, out)
	return out, nil
}

// defaultNodeLane is the lane a profile names when none is given: the api,
// or on a monolith its one app lane.
func defaultNodeLane(st domain.Stack) string {
	if st.Layout.IsMonolith() {
		return domain.MonolithAppLane
	}
	return APILane
}

// lanesServedBy names st's other lanes whose port the same process listens on.
func (o *Orchestrator) lanesServedBy(st domain.Stack, nl NodeLane) []string {
	ports := lanePorts(st)
	var out []string
	for _, name := range NodeLaneNames(st) {
		if name != nl.Lane && slices.Contains(o.sys.PIDsOnPort(ports[name]), nl.PID) {
			out = append(out, name)
		}
	}
	return out
}

// ProfileDir is where profiles of slug's lanes are saved: under the stack's
// checkout (gitignored .claude/tmp), else fallbackDir's when the stack is no
// longer registered.
func (o *Orchestrator) ProfileDir(slug, fallbackDir string) string {
	dir := fallbackDir
	if st, ok := o.stackBySlug(slug); ok && st.WorktreeDir != "" {
		dir = st.WorktreeDir
	}
	return filepath.Join(dir, ".claude", "tmp", "haven-profiles", slug)
}
