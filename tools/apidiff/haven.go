package apidiff

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// Booting the two instances on the developer's OWN Postgres, ClickHouse and
// Redis is what took a running stack down: apidiff hashed its two Redis
// logical databases out of the same 0-15 range haven allocates a developer's
// stack from, and its teardown flushed both. Nothing about that was fixable by
// picking better indices - sixteen databases and two tools allocating out of
// them independently collide by arithmetic, not by luck.
//
// haven already isolates one stack per slug: its own Postgres and ClickHouse
// database named for the slug, its own Redis index allocated against the ones
// live stacks hold, its own hostnames and ports. So an instance stops being
// something apidiff provisions and becomes a haven stack under a slug of its
// own - and everything below is only the naming, the readiness poll and the
// teardown that keeps a run inside its own two slugs.

const (
	// havenCommand is the orchestrator binary. Its presence on PATH is what
	// selects this path.
	havenCommand = havenrun.Command

	// havenSlugPrefix opens every slug a run allocates. It is what makes the
	// teardown provably narrow: a stack apidiff may destroy is one apidiff
	// named, and haven derives a worktree's own slug from its directory or
	// branch, never from this prefix.
	havenSlugPrefix = "apidiff"

	// havenReadyPoll is how often the readiness loop asks haven for the
	// backend lane. A stack's boot is minutes of install, codegen, migrate and
	// seed; a second between questions is already generous.
	havenReadyPoll = havenrun.DefaultReadyPoll

	// havenFailureLogLines is how much of a failed stack's backend log the
	// timeout error carries. Enough to name the failure, short enough to read.
	havenFailureLogLines = havenrun.DefaultFailureLogLines

	// havenStackLogLines is how much of a stack's own combined log
	// (havenrun.StackLogTailOrError) the timeout error carries when read
	// directly off disk, the fallback that stays useful even when `haven
	// logs` itself fails.
	havenStackLogLines = 20

	// havenProgressInterval is how often the readiness loop reports that it
	// is still waiting. A five-minute default timeout with no output at all
	// until it fails is what run 20260910-044221 looked like from outside.
	havenProgressInterval = 30 * time.Second
)

// HavenSlug names the haven stack one instance runs as. Run-scoped so two
// concurrent runs never share a stack, and instance-scoped so the branch and
// the base never share one either.
func HavenSlug(runID, instance string) string {
	return havenrun.Slug(havenSlugPrefix, runID, instance)
}

// havenSelected decides where the infrastructure comes from. haven is the
// default wherever it is installed, because it is the only path that cannot
// reach another stack's data. -no-haven opts out, and so does naming the three
// external servers, which is an explicit choice of somebody else's.
func havenSelected(havenOnPath, noHaven, externalGiven bool) bool {
	return havenrun.Selected(havenOnPath, noHaven, externalGiven)
}

// havenOnPath reports whether the orchestrator is installed.
func havenOnPath() bool {
	return havenrun.OnPath()
}

// havenEnv composes the environment one instance's haven commands run with:
// the developer's own, minus every datastore address apidiff must not decide,
// plus the slug naming this instance's stack.
//
// LANGWATCH_INSTANCE_ADMIN_API_KEY is the one value the instance still needs
// from here. haven starts every supervised child on its own environment plus
// the process environment it inherited, and the instance-admin key is not part
// of a stack's overlay, so setting it here is how the API lane on both sides
// ends up holding the same throwaway key - which is what makes the
// instance-admin operations comparable rather than symmetrically unauthorized.
func havenEnv(inherit []string, slug string) []string {
	return havenrun.Env(inherit, slug, havenrun.EnvOptions{
		ExtraManagedKeys: []string{"LANGWATCH_INSTANCE_ADMIN_API_KEY"},
		Extra:            []string{"LANGWATCH_INSTANCE_ADMIN_API_KEY=" + throwawayInstanceAdminKey},
	})
}

// havenUpArgs brings one instance's stack up and returns. --agent is plain,
// token-free output; --detach backgrounds the stack instead of attaching the
// log viewer, which is what makes this a call rather than a session.
func havenUpArgs() []string { return havenrun.UpArgs() }

// havenStatusArgs asks for the machine-readable one-shot report.
func havenStatusArgs() []string { return havenrun.StatusArgs() }

// havenDestroyArgs stops one stack and drops the databases haven made for it.
// The slug is the whole safety story: nothing is derived from a directory, so
// a run can only destroy what it named.
func havenDestroyArgs(slug string) []string {
	return havenrun.DestroyArgs(slug)
}

// havenLogArgs reads one stack's named lane log, for a boot that never
// became ready.
func havenLogArgs(lane, slug string) []string {
	return havenrun.LogArgs(lane, slug)
}

// havenStatus is the slice of `haven status --json` this tool reads.
type havenStatus = havenrun.Status

type havenStackStatus = havenrun.StackStatus

type havenLaneStatus = havenrun.LaneStatus

// havenBackendLane is the lane that answers "is the application actually
// serving": the api and worker applications in one local process.
const havenBackendLane = havenrun.BackendLane

// havenStackReady reports the base URL to probe once the named stack's
// required lane is up (haven's own answer, never a guess from elapsed time).
// A modular stack's address is the backend lane's own loopback port, where
// the API serves /api; a monolith stack has no separate one, so its address
// is the routed app hostname visualdiff also uses (StackStatus.IsMonolith).
func havenStackReady(report havenStatus, slug string) (string, bool) {
	stack, ready := havenrun.StackReady(report, slug, havenBackendLane)
	if !ready {
		return "", false
	}
	if stack.IsMonolith() {
		return stack.ServiceURL(havenrun.AppService)
	}
	if stack.APIPort == 0 {
		return "", false
	}
	return fmt.Sprintf("http://127.0.0.1:%d", stack.APIPort), true
}

// parseHavenStatus decodes a `haven status --json` report.
func parseHavenStatus(output []byte) (havenStatus, error) {
	return havenrun.ParseStatus(output)
}

// lastLines returns at most count trailing non-empty lines of text, for an
// error that has to say what the stack died of.
func lastLines(text string, count int) string {
	return havenrun.LastLines(text, count)
}

// --- boot stages -------------------------------------------------------------

// havenPlan is one instance's stack: the slug it runs as and the checkout it
// runs from.
type havenPlan struct {
	instance string
	slug     string
	dir      string
}

// havenPlanFor names the stack one instance runs as.
func (state *bootState) havenPlanFor(instance Instance) havenPlan {
	return havenPlan{instance: instance.Name, slug: HavenSlug(state.runID, instance.Name), dir: instance.Dir}
}

// bootThroughHaven brings both instances up as haven stacks and waits for
// them. Both are started before either is waited on: `up --detach` returns as
// soon as the stack is backgrounded, and the expensive part (install, codegen,
// migrate, seed, then the lanes) then runs on both sides at once.
func (state *bootState) bootThroughHaven(ctx context.Context, booted *Booted) error {
	for _, instance := range []*Instance{&booted.A, &booted.B} {
		if err := state.havenUp(ctx, state.havenPlanFor(*instance)); err != nil {
			return err
		}
	}
	for _, instance := range []*Instance{&booted.A, &booted.B} {
		if err := state.havenWaitReady(ctx, instance); err != nil {
			return err
		}
	}
	return nil
}

// prepareHavenInstances detects each side's layout (for logging and for
// naming the right lane on a failed boot's log tail, havenBackendLog), then
// runs havenPrepareInstance on it - both instances, both before either
// instance's `haven up` runs. haven boots a monolith checkout itself now, so
// neither layout is refused here - a checkout this tool cannot recognize at
// all still fails on detectProfile's own error, same as the compose path.
func (state *bootState) prepareHavenInstances(ctx context.Context, booted *Booted) error {
	for _, instance := range []*Instance{&booted.A, &booted.B} {
		profile, err := detectProfile(instance.Dir)
		if err != nil {
			return err
		}
		instance.Profile = profile
		state.logf("%s: %s profile as haven stack %q (%s)", instance.Name, profile.name, HavenSlug(state.runID, instance.Name), instance.Dir)
		if err := state.havenPrepareInstance(ctx, *instance); err != nil {
			return err
		}
	}
	return nil
}

// havenPrepareInstance is what closes the gap a real run hit at 04:42: a
// fresh worktree carries none of the generated or built artifacts a
// developer checkout has (they are gitignored), so `haven up` there died in
// its own prepare phase on ERR_MODULE_NOT_FOUND before it ever reached
// migrate. It runs the same install / generated-files / build steps
// visualdiff runs (havenrun.PrepareCommands) and copies the developer's own
// .env into the worktree (havenrun.CopyEnvFiles) - the two tools share both,
// so there is one definition of what a fresh worktree needs, not two.
func (state *bootState) havenPrepareInstance(ctx context.Context, instance Instance) error {
	copied, err := havenrun.CopyEnvFiles(ctx, state.cfg.BranchDir, instance.Dir)
	if err != nil {
		return fmt.Errorf("prepare %s: copy env: %w", instance.Name, err)
	}
	state.logf("prepare %s: copy .env files exit=ok (copied %d)", instance.Name, copied)
	layout := havenrun.LayoutModular
	if instance.Profile.name == profileMonolith {
		layout = havenrun.LayoutMonolith
	}
	for _, step := range havenrun.PrepareCommands(layout) {
		spec := commandSpec{name: step.Name, args: step.Args, dir: instance.Dir}
		argv := step.Name + " " + strings.Join(step.Args, " ")
		state.logf("prepare %s: %s", instance.Name, argv)
		err := state.run(ctx, spec, state.stderr)
		state.logf("prepare %s: %s exit=%s", instance.Name, argv, exitStatus(err))
		if err != nil {
			return fmt.Errorf("prepare %s (%s): %w", instance.Name, argv, err)
		}
	}
	return nil
}

// havenPrepareCommandLine renders one worktree's prepare step for -dry-run:
// the same steps havenPrepareInstance actually runs, using the modular
// layout's list (the superset of the two) since a worktree's own layout is
// not known before it exists.
func havenPrepareCommandLine(dir string) string {
	parts := []string{"copy .env"}
	for _, step := range havenrun.PrepareCommands(havenrun.LayoutModular) {
		parts = append(parts, step.Name+" "+strings.Join(step.Args, " "))
	}
	return "prepare (" + strings.Join(parts, "; ") + ") (in " + dir + ")"
}

// exitStatus renders a step's outcome for the run log - "ok" or the error,
// never the command's own output (that already streamed to stderr as it ran).
func exitStatus(err error) string {
	if err == nil {
		return "ok"
	}
	return err.Error()
}

// havenUp starts one instance's stack. The slug is recorded BEFORE the command
// runs: an up that dies half-way has already created databases under it, and
// the teardown has to be able to take them.
func (state *bootState) havenUp(ctx context.Context, plan havenPlan) error {
	state.havenSlugs = append(state.havenSlugs, plan.slug)
	state.logf("haven up %s: stack %q in %s", plan.instance, plan.slug, plan.dir)
	spec := commandSpec{name: havenCommand, args: havenUpArgs(), dir: plan.dir, env: havenEnv(state.environ(), plan.slug)}
	if err := state.run(ctx, spec, state.stderr); err != nil {
		return fmt.Errorf("haven up %s (%s): %w", plan.instance, plan.slug, err)
	}
	return nil
}

// havenWaitReady polls haven until the instance's backend lane is listening,
// then adopts the address haven allocated for it.
func (state *bootState) havenWaitReady(ctx context.Context, instance *Instance) error {
	plan := state.havenPlanFor(*instance)
	timeout := state.bootTimeout()
	deadline := time.Now().Add(timeout)
	state.logf("haven %s: waiting for the backend lane of %q (up to %s)", instance.Name, plan.slug, timeout)
	progress := newHavenProgress(deadline)
	for {
		report, err := state.havenStatus(ctx, plan)
		if err == nil {
			if baseURL, ready := havenStackReady(report, plan.slug); ready {
				instance.URL = baseURL
				state.logf("haven %s: %s ready at %s", instance.Name, plan.slug, baseURL)
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("haven %s: stack %q had no healthy backend lane within %s\n%s",
				instance.Name, plan.slug, timeout, state.havenBackendLog(ctx, plan, *instance))
		}
		progress.reportIfDue(state, instance.Name, plan.slug)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollDelay(deadline)):
		}
	}
}

// havenProgress reports at most once per havenProgressInterval, so a five
// minute wait with nothing ready says something before it fails instead of
// going silent until the timeout error (run 20260910-044221 looked like a
// hang from outside).
type havenProgress struct {
	deadline time.Time
	started  time.Time
	nextAt   time.Time
}

func newHavenProgress(deadline time.Time) *havenProgress {
	now := time.Now()
	return &havenProgress{deadline: deadline, started: now, nextAt: now.Add(havenProgressInterval)}
}

// reportIfDue logs a progress line and reschedules, but only once per
// havenProgressInterval; a caller polling faster than the interval is a
// no-op the rest of the time.
func (progress *havenProgress) reportIfDue(state *bootState, name, slug string) {
	now := time.Now()
	if now.Before(progress.nextAt) {
		return
	}
	progress.nextAt = now.Add(havenProgressInterval)
	state.logf("haven %s: still waiting for %q (%s elapsed, %s left)",
		name, slug, now.Sub(progress.started).Round(time.Second), time.Until(progress.deadline).Round(time.Second))
}

// pollDelay is the wait before the next question, never longer than what is
// left of the boot timeout - so a short timeout fails when it says it will
// rather than one whole poll interval later.
func pollDelay(deadline time.Time) time.Duration {
	return havenrun.PollDelay(deadline, havenReadyPoll)
}

// havenStatus runs one `haven status --json` and decodes it.
func (state *bootState) havenStatus(ctx context.Context, plan havenPlan) (havenStatus, error) {
	var out bytes.Buffer
	spec := commandSpec{name: havenCommand, args: havenStatusArgs(), dir: plan.dir, env: havenEnv(state.environ(), plan.slug)}
	if err := state.run(ctx, spec, &out); err != nil {
		return havenStatus{}, err
	}
	return parseHavenStatus(out.Bytes())
}

// havenBackendLog is the tail of a stack's own log, for the failure message
// of a boot that never became ready. It reads haven's combined log file for
// the stack straight off disk (havenrun.StackLogTailOrError) - a run at
// 04:42 died with `haven logs` itself exiting 1, so the timeout message
// carried "(backend log unavailable: exit status 1)" instead of the crash a
// person needed to see. Only when the file cannot be read does this fall
// back to `haven logs <lane>`, naming the single app lane on a monolith
// checkout, the backend lane everywhere else (see profile.go).
func (state *bootState) havenBackendLog(ctx context.Context, plan havenPlan, instance Instance) string {
	if tail, err := havenrun.StackLogTailOrError(plan.slug, havenStackLogLines); err == nil {
		return tail
	}
	lane := havenBackendLane
	if instance.Profile.name == profileMonolith {
		lane = havenrun.AppService
	}
	var out bytes.Buffer
	spec := commandSpec{name: havenCommand, args: havenLogArgs(lane, plan.slug), dir: plan.dir, env: havenEnv(state.environ(), plan.slug)}
	if err := state.run(ctx, spec, &out); err != nil {
		return fmt.Sprintf("(%s log for %s unavailable: %v)", lane, plan.slug, err)
	}
	return lastLines(out.String(), havenFailureLogLines)
}

// destroyHavenStacks tears down exactly the slugs this run started, in the
// order it started them. Best-effort per slug: one stack that will not go must
// not leave the other running. Run from the work root, never the invoking
// checkout: destroy targets a stack by its slug argument, but a diff tool
// must never run a haven command from the directory it was started in.
func (state *bootState) destroyHavenStacks(ctx context.Context) {
	for _, slug := range state.havenSlugs {
		state.logf("teardown: haven destroy %s", slug)
		spec := commandSpec{name: havenCommand, args: havenDestroyArgs(slug), dir: state.workRoot, env: havenEnv(state.environ(), slug)}
		if err := state.run(ctx, spec, state.stderr); err != nil {
			state.logf("teardown: haven destroy %s: %v", slug, err)
		}
	}
}
