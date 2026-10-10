package seedgen

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"io"
	"iter"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"
)

// Executor sends one action and waits for its reply; an error means the route itself failed.
// The task pipe (taskpipe.go) and the door (door.go) are the two.
type Executor interface {
	Send(ctx context.Context, action Action) (Reply, error)
	Close() error
}

// RunConfig is one run: the plan, the route, the guard's sensors and the checkpoint to resume from.
type RunConfig struct {
	Plan       *Plan
	Executor   Executor
	Sensors    []Sensor
	Checkpoint *Checkpoint
	Path       string // where the checkpoint is saved after each ack
	Log        io.Writer
	Tick       time.Duration // the guard's read interval; 2 s
	Backoff    time.Duration // the first retry's wait; 1 s
	Now        func() time.Time
	Drain      bool // wait for the worker backlog to empty after the last ack
	// Backlog, when set, scopes the drain to the seed's own tenants; without it the drain waits on
	// the whole stack's worker backlog.
	Backlog func(ctx context.Context, tenants []string, now time.Time) (SeedBacklog, error)
}

// Result counts what this session sent, how long sending took from the first ack, and the drain.
type Result struct {
	Actions, Cells, Spans, Logs, MetricPoints int
	IdentityRefused                           int // refused identity actions: what was asked for does not all exist
	Refusals                                  map[string]int
	Sent, Drained                             time.Duration
	Deferred                                  int // the seed's jobs deferred past DrainHorizon when the drain ended
	SkippedCells                              int // cells of projects an earlier run made and filled
}

// StallError is exit 4: sending stayed paused for StallAfter (design §5.4).
type StallError struct{ Reading Reading }

func (e *StallError) Error() string {
	return fmt.Sprintf("stalled: %s held sending paused for %s; the checkpoint is saved, resume with --resume",
		e.Reading, StallAfter)
}

const retries = 5

// Run walks the plan, skips what the checkpoint holds, and sends each step within the guard's window.
func Run(ctx context.Context, cfg RunConfig) (Result, error) {
	cfg = cfg.withDefaults()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	r := &run{cfg: cfg, guard: NewGuard(cfg.Log), cancel: cancel, result: Result{Refusals: map[string]int{}}}
	watching, stopWatching := context.WithCancel(ctx)
	defer stopWatching()
	go r.watch(watching)
	identity := true
	for step := range cfg.Plan.Steps() {
		if r.done(step.Seq) {
			continue
		}
		if identity && step.Cell != nil {
			identity = false
			r.wg.Wait() // every org, member and grant lands before telemetry floods the worker
		}
		sending := r.actionsOf(step)
		if r.acquire(ctx) != nil {
			break
		}
		r.wg.Add(1)
		go r.apply(ctx, step, sending)
	}
	r.wg.Wait()
	stopWatching() // the guard paces sending; the drain reads on its own
	if !r.firstAck.IsZero() {
		r.result.Sent = cfg.Now().Sub(r.firstAck)
	}
	if err := r.finish(); err != nil {
		return r.result, err
	}
	if !cfg.Drain {
		return r.result, nil
	}
	if cfg.Backlog == nil {
		r.result.Drained = r.drain(ctx)
		return r.result, nil
	}
	started := cfg.Now()
	err := r.drainSeed(ctx)
	r.result.Drained = cfg.Now().Sub(started)
	return r.result, err
}

func (cfg RunConfig) withDefaults() RunConfig {
	cfg.Tick = cmp.Or(cfg.Tick, 2*time.Second)
	cfg.Backoff = cmp.Or(cfg.Backoff, time.Second)
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Log == nil {
		cfg.Log = io.Discard
	}
	return cfg
}

type run struct {
	cfg       RunConfig
	guard     *Guard
	cancel    context.CancelFunc
	wg        sync.WaitGroup
	mu        sync.Mutex
	inFlight  int
	retryable int
	stall     *StallError
	firstAck  time.Time // the route's boot (the tasks process) is not sending time
	fatal     error
	result    Result
}

// actionsOf substitutes refs; a ref still unminted waits for every in-flight step, then is refused.
// For a cell it answers one action holding the substituted org and project its chunks take.
func (r *run) actionsOf(step Step) sending {
	if step.Action != nil {
		action, err := r.substitute(*step.Action)
		if err != nil {
			return sending{refused: "unbound_ref"}
		}
		return sending{actions: []Action{action}}
	}
	scope, err := r.substitute(Action{ID: "cell", Org: step.Cell.Org, Project: step.Cell.Project})
	if err != nil {
		return sending{refused: "unbound_ref"}
	}
	return sending{actions: []Action{scope}}
}

// sending is what a step sends, or the local refusal that stops it before sending.
type sending struct {
	actions []Action
	refused string
}

func (r *run) substitute(action Action) (Action, error) {
	r.mu.Lock()
	substituted, err := r.cfg.Checkpoint.Refs.Substitute(action)
	r.mu.Unlock()
	if err == nil {
		return substituted, nil
	}
	r.wg.Wait()
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cfg.Checkpoint.Refs.Substitute(action)
}

// acquire waits for room in the window; it fails once the run stalls or fails.
func (r *run) acquire(ctx context.Context) error {
	for {
		r.mu.Lock()
		switch {
		case r.stall != nil || r.fatal != nil:
			r.mu.Unlock()
			return errors.New("run stopped")
		case r.guard.Paused == nil && r.inFlight < r.guard.Window:
			r.inFlight++
			r.mu.Unlock()
			return nil
		}
		r.mu.Unlock()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func (r *run) done(seq int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.cfg.Checkpoint.Done(seq)
}

// apply sends the step and acks it; a route failure leaves it unacked for the resume.
func (r *run) apply(ctx context.Context, step Step, sending sending) {
	actions, refused := sending.actions, sending.refused
	defer r.wg.Done()
	if step.Cell != nil && r.existing(step.Cell.Project) {
		r.skip(step)
		return
	}
	refs, existing := map[string]string{}, false
	for action, err := range r.sendable(step, actions) {
		var reply Reply
		if err == nil {
			reply, err = r.send(ctx, action)
		}
		if err != nil {
			if ctx.Err() == nil {
				r.fail(err)
			}
			r.release()
			return
		}
		if !reply.OK {
			refused = reply.Code
		}
		maps.Copy(refs, reply.Refs)
		existing = reply.Existing
	}
	if existing && step.Action != nil && step.Action.Kind == KindProjectCreate {
		r.mu.Lock()
		r.cfg.Checkpoint.Existing = append(r.cfg.Checkpoint.Existing, step.Action.Ref)
		r.mu.Unlock()
	}
	r.ack(step, refs, refused)
}

// skip acks a cell of a project an earlier run made, counting it apart from what was sent.
func (r *run) skip(step Step) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.inFlight--
	r.result.SkippedCells++
	r.cfg.Checkpoint.Ack(step.Seq, "skipped:existing_project", nil)
}

// existing says the project was found already made by an earlier run, which sent its telemetry.
func (r *run) existing(project string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return slices.Contains(r.cfg.Checkpoint.Existing, project)
}

func (r *run) ack(step Step, refs map[string]string, refused string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.inFlight--
	if r.firstAck.IsZero() {
		r.firstAck = r.cfg.Now()
	}
	counter := "cells"
	if step.Action != nil {
		counter = step.Action.Kind
	}
	if refused != "" {
		r.result.Refusals[refused]++
		counter = "refused:" + refused
		if step.Action != nil {
			r.result.IdentityRefused++
		}
	}
	if step.Cell != nil {
		r.result.Cells++
		r.result.Spans += step.Cell.Spans
		r.result.Logs += step.Cell.Logs
		r.result.MetricPoints += step.Cell.MetricPoints
	} else {
		r.result.Actions++
	}
	if refused != "" && step.Action != nil {
		return // left unacked: a resume sends it again, and natural keys keep that idempotent
	}
	r.cfg.Checkpoint.Ack(step.Seq, counter, refs)
	if r.cfg.Path != "" {
		if err := r.cfg.Checkpoint.Save(r.cfg.Path); err != nil && r.fatal == nil {
			r.fatal = err
			r.cancel()
		}
	}
}

// sendable is the step's action, or its cell's chunks built one at a time in the cell's scope.
func (r *run) sendable(step Step, actions []Action) iter.Seq2[Action, error] {
	if step.Cell == nil || len(actions) == 0 {
		return func(yield func(Action, error) bool) {
			for i := range actions {
				if !yield(actions[i], nil) {
					return
				}
			}
		}
	}
	return r.chunks(step, actions[0])
}

func (r *run) chunks(step Step, scope Action) iter.Seq2[Action, error] {
	return func(yield func(Action, error) bool) {
		for chunk, err := range r.cfg.Plan.Chunks(step) {
			chunk.Org, chunk.Project = scope.Org, scope.Project
			if !yield(chunk, err) {
				return
			}
		}
	}
}

// send retries a retryable refusal with doubling back-off; the guard counts each one.
func (r *run) send(ctx context.Context, action Action) (Reply, error) {
	wait := r.cfg.Backoff
	for attempt := 1; ; attempt++ {
		reply, err := r.cfg.Executor.Send(ctx, action)
		if err != nil || reply.OK || !reply.Retryable || attempt == retries {
			return reply, err
		}
		r.mu.Lock()
		r.retryable++
		r.mu.Unlock()
		select {
		case <-ctx.Done():
			return reply, ctx.Err()
		case <-time.After(wait):
		}
		wait *= 2
	}
}

func (r *run) release() {
	r.mu.Lock()
	r.inFlight--
	r.mu.Unlock()
}

func (r *run) fail(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fatal == nil {
		r.fatal = err
	}
	r.cancel()
}

// watch reads the sensors every tick; retryable refusals since the last read are one signal.
func (r *run) watch(ctx context.Context) {
	ticker := time.NewTicker(r.cfg.Tick)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		readings := r.read(ctx)
		r.mu.Lock()
		readings = append(readings, Reading{Signal: SignalRefusals, Value: float64(r.retryable)})
		r.retryable = 0
		r.guard.Observe(r.cfg.Now(), readings)
		if reading, stalled := r.guard.Stalled(r.cfg.Now()); stalled {
			r.stall = &StallError{Reading: reading}
			r.cancel()
		}
		r.mu.Unlock()
	}
}

func (r *run) read(ctx context.Context) []Reading {
	var readings []Reading
	for _, sensor := range r.cfg.Sensors {
		values, err := sensor.Read(ctx)
		if err != nil && ctx.Err() == nil {
			_, _ = fmt.Fprintf(r.cfg.Log, "seedgen guard: %s unread: %v\n", sensor.Name, err)
		}
		readings = append(readings, values...)
	}
	return readings
}

// finish saves the checkpoint and names why the run stopped early, if it did.
func (r *run) finish() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cfg.Path != "" {
		if err := r.cfg.Checkpoint.Save(r.cfg.Path); err != nil {
			return err
		}
	}
	if r.stall != nil {
		return r.stall
	}
	return r.fatal
}

// drain waits, at most StallAfter, for the worker backlog to read zero.
func (r *run) drain(ctx context.Context) time.Duration {
	started := r.cfg.Now()
	for r.cfg.Now().Sub(started) < StallAfter && ctx.Err() == nil {
		backlog := -1.0
		for _, reading := range r.read(ctx) {
			if reading.Signal == SignalWorkerBacklog {
				backlog = reading.Value
			}
		}
		if backlog <= 0 {
			break
		}
		time.Sleep(r.cfg.Tick)
	}
	return r.cfg.Now().Sub(started)
}

// drainSeed waits, at most StallAfter, until two reads in a row find none of the seed's tenants'
// jobs due or running; a group the worker blocked, or a drain that never settles, is an error.
func (r *run) drainSeed(ctx context.Context) error {
	tenants := r.seedTenants()
	started, said, settled := r.cfg.Now(), r.cfg.Now(), 0
	var backlog SeedBacklog
	for settled < 2 {
		if r.cfg.Now().Sub(started) >= StallAfter {
			return fmt.Errorf("the worker did not land the seed's data in %s: %s", StallAfter, backlog)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(drainTick):
		}
		read, err := r.cfg.Backlog(ctx, tenants, r.cfg.Now())
		if err != nil {
			_, _ = fmt.Fprintf(r.cfg.Log, "seedgen drain: backlog unread: %v\n", err)
			settled = 0
			continue
		}
		said = r.sayProgress(said, backlog, read)
		backlog = read
		if settled++; !backlog.Settled() {
			settled = 0
		}
	}
	r.result.Deferred = backlog.Deferred
	if backlog.Blocked > 0 {
		return fmt.Errorf("the worker blocked %d of the seed's job groups: its data has not all landed (see /ops)", backlog.Blocked)
	}
	return nil
}

// seedTenants are the org and project ids the run minted or bound: the drain's scope.
func (r *run) seedTenants() []string {
	var tenants []string
	for ref, id := range r.cfg.Checkpoint.Refs {
		if strings.HasPrefix(ref, "$org:") || strings.HasPrefix(ref, "$project:") {
			tenants = append(tenants, id)
		}
	}
	return tenants
}

// sayProgress logs a changed backlog at most every ten seconds and answers when it last said one.
func (r *run) sayProgress(said time.Time, was, read SeedBacklog) time.Time {
	now := r.cfg.Now()
	if read == was || now.Sub(said) < 10*time.Second {
		return said
	}
	_, _ = fmt.Fprintf(r.cfg.Log, "seedgen drain: %s\n", read)
	return now
}

// drainTick is how often the drain reads the seed's backlog.
const drainTick = 500 * time.Millisecond

// BindInto binds every org and project ref the checkpoint has not minted to one existing org and
// project (--into): the plan then sends telemetry only.
func BindInto(plan *Plan, cp *Checkpoint, into string) {
	org, project, _ := strings.Cut(into, "/")
	for _, o := range plan.Orgs {
		if _, ok := cp.Refs[o.Ref]; !ok {
			cp.Refs[o.Ref] = org
		}
		for _, p := range o.Projects {
			if _, ok := cp.Refs[p.Ref]; !ok {
				cp.Refs[p.Ref] = project
			}
		}
	}
}
