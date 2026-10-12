package app

import (
	"context"
	"os"
	"slices"

	"go.uber.org/zap"
)

// liveLane is one supervised lane with its own stop, so a replan can end it
// without touching the others.
type liveLane struct {
	child  Child
	cancel context.CancelFunc
	done   chan struct{}
}

// LaneChange is what a replan does to a running stack's lanes, by name.
type LaneChange struct {
	Start, Stop, Restart []string
}

// IsEmpty is whether the replan leaves every lane as it is.
func (c LaneChange) IsEmpty() bool {
	return len(c.Start) == 0 && len(c.Stop) == 0 && len(c.Restart) == 0
}

// diffLanes compares the lanes running with the lanes planned: a planned lane
// not running starts, a running lane not planned stops, and one whose command,
// environment or capture changed restarts. The rest keep running.
func diffLanes(running, planned []Child) LaneChange {
	var change LaneChange
	for i := range planned {
		next := &planned[i]
		j := slices.IndexFunc(running, func(c Child) bool { return c.Name == next.Name })
		switch {
		case j < 0:
			change.Start = append(change.Start, next.Name)
		case !sameLane(&running[j], next):
			change.Restart = append(change.Restart, next.Name)
		}
	}
	for i := range running {
		name := running[i].Name
		if !slices.ContainsFunc(planned, func(c Child) bool { return c.Name == name }) {
			change.Stop = append(change.Stop, name)
		}
	}
	return change
}

// sameLane is whether two plans of one lane run the same process; the color
// is only how the terminal prints it.
func sameLane(a, b *Child) bool {
	return a.Name == b.Name && a.Dir == b.Dir && a.Shell == b.Shell && slices.Equal(a.Env, b.Env) &&
		a.ReadyProbeURL == b.ReadyProbeURL && a.LogPath == b.LogPath && a.SplitLog == b.SplitLog &&
		a.MaxRSSBytes == b.MaxRSSBytes
}

// liveLanes is a keeper's running lanes by name.
type liveLanes struct {
	ctx    context.Context
	sup    Supervisor
	lanes  map[string]*liveLane
	onReap func(lane, reason string) // a lane killed over its memory ceiling
}

func (l *liveLanes) start(c *Child) {
	laneCtx, cancel := context.WithCancel(l.ctx)
	lane := &liveLane{child: *c, cancel: cancel, done: make(chan struct{})}
	l.lanes[c.Name] = lane
	run := lane.child
	if l.onReap != nil {
		run.OnReap = func(reason string) { l.onReap(c.Name, reason) }
	}
	go func() {
		defer close(lane.done)
		l.sup.Supervise(laneCtx, []Child{run})
	}()
}

func (l *liveLanes) stop(name string) {
	if lane, ok := l.lanes[name]; ok {
		lane.cancel()
		<-lane.done
		delete(l.lanes, name)
	}
}

func (l *liveLanes) stopAll() {
	for name := range l.lanes {
		l.stop(name)
	}
}

// apply moves the running lanes to planned and returns what it did.
func (l *liveLanes) apply(planned []Child) LaneChange {
	running := make([]Child, 0, len(l.lanes))
	for _, lane := range l.lanes {
		running = append(running, lane.child)
	}
	change := diffLanes(running, planned)
	for _, name := range slices.Concat(change.Stop, change.Restart) {
		l.stop(name)
	}
	for i := range planned {
		if _, ok := l.lanes[planned[i].Name]; !ok {
			l.start(&planned[i])
		}
	}
	return change
}

// keeperRun is what a keeper supervises: its stack, the plan's lanes and the
// signal that says the plan was rewritten.
type keeperRun struct {
	slug     string
	children []Child
	replans  <-chan os.Signal
}

// superviseLive runs the plan's lanes, each under its own context, until ctx
// ends. On each replan signal it rereads the plan and applies diffLanes, so a
// ±service starts or stops its own lanes and never restarts the stack.
func (o *Orchestrator) superviseLive(ctx context.Context, run keeperRun) {
	lanes := &liveLanes{ctx: ctx, sup: o.sup, lanes: map[string]*liveLane{}, onReap: func(lane, reason string) {
		o.recordReap("lane", run.slug+"/"+lane, reason)
	}}
	lanes.apply(run.children)
	for {
		select {
		case <-ctx.Done():
			lanes.stopAll()
			return
		case <-run.replans:
			plan, err := o.ReadKeeperPlan(run.slug)
			if err != nil {
				o.log.Warn("could not reread the keeper plan; the lanes keep running as they are", zap.Error(err))
				continue
			}
			change := lanes.apply(plan.Children)
			o.log.Info("replanned", zap.Strings("started", change.Start), zap.Strings("stopped", change.Stop), zap.Strings("restarted", change.Restart))
		}
	}
}
