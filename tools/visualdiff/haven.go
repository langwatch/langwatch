package visualdiff

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// Booting both refs on the developer's OWN ports and their OWN Postgres,
// ClickHouse and Redis is what the last real run tripped over: a fresh
// worktree with no .env crash-loops on missing variables, and nothing there
// stopped two refs landing on the developer's own running stack. haven
// already isolates one stack per slug, so each ref becomes a haven stack.

// Unlike apidiff, this path is not gated on layout: it runs `haven up` for
// whatever the checkout defines and waits on the same two lanes either way.
// Only the modular layout becomes ready today - haven's lanes are hardcoded
// pnpm filters absent from the monolith layout, tools/thuishaven/app/plan.go
// - but that failure is haven's own, not a refusal visualdiff makes up front.

// havenSlugPrefix opens every slug a run allocates. It is what makes
// teardown provably narrow: a stack visualdiff may destroy is one it named
// itself, and haven derives a worktree's own slug from its directory or
// branch, never from this prefix.
const havenSlugPrefix = "visualdiff"

// havenReadyLanes are the lanes a run waits for: the runner drives a browser
// against the ui lane and seeds fixtures through the backend lane's /api
// prefix on that same routed origin, so neither alone is ready.
var havenReadyLanes = []string{havenrun.UILane, havenrun.BackendLane}

// HavenSlug names the haven stack one stack runs as. Run-scoped so two
// concurrent runs never share a stack, and stack-scoped so the base and the
// candidate never share one either.
func HavenSlug(runID, stack string) string {
	return havenrun.Slug(havenSlugPrefix, runID, stack)
}

// RunID derives a run's identity from its run directory, the same way
// apidiff derives one from its work root.
func RunID(runDir string) string {
	return havenrun.RunID(runDir)
}

// havenOnPath reports whether the orchestrator is installed.
func havenOnPath() bool { return havenrun.OnPath() }

// havenSelected decides where the infrastructure comes from: haven is the
// default wherever it is installed, because it is the only path that cannot
// reach another stack's data. -no-haven opts out. Unlike apidiff there is no
// third, external-infrastructure path to name instead.
func havenSelected(onPath, noHaven bool) bool {
	return havenrun.Selected(onPath, noHaven, false)
}

// havenEnv composes the environment one stack's haven commands run with: the
// developer's own, minus every datastore address visualdiff must not decide,
// plus the slug naming this stack.
func havenEnv(inherit []string, slug string) []string {
	return havenrun.Env(inherit, slug, havenrun.EnvOptions{})
}

// bringUpHaven checks out both refs and brings each up as a haven stack.
// Both are started before either is waited on: `up --detach` returns as soon
// as the stack is backgrounded, and the expensive part (install, codegen,
// migrate, seed, then the lanes) then runs on both sides at once.
func (run *session) bringUpHaven(ctx context.Context) error {
	stacks := []*Stack{&run.plan.Base, &run.plan.Candidate}
	for _, stack := range stacks {
		if err := run.checkoutForHaven(ctx, stack); err != nil {
			return err
		}
	}
	for _, stack := range stacks {
		if err := run.havenUp(ctx, *stack); err != nil {
			return err
		}
	}
	for _, stack := range stacks {
		if err := run.havenWaitReady(ctx, stack); err != nil {
			return err
		}
	}
	return nil
}

// checkoutForHaven adds one ref's worktree. Unlike the port-based path it
// stops there: haven's own automatic prep does install, generate, migrate
// and seed, so this run's own offline install and start:prepare:files step
// would only race it.
func (run *session) checkoutForHaven(ctx context.Context, stack *Stack) error {
	steps := &executor{run: run.request.Deps.Run, root: run.request.Options.Root, stderr: run.streams.Err}
	if err := steps.addWorktree(ctx, *stack); err != nil {
		return err
	}
	run.created = append(run.created, stack.Dir)
	layout, err := run.request.Deps.Layout(stack.Dir)
	if err != nil {
		return err
	}
	stack.Layout = layout
	fmt.Fprintf(run.streams.Err, "%s: %s at %s (%s layout, haven stack %s)\n", stack.Name, stack.Ref, stack.Dir, layout, stack.HavenSlug)
	return nil
}

// havenUp starts one stack. The slug is recorded BEFORE the command runs: an
// up that dies half-way has already created databases under it, and
// teardown has to be able to take them.
func (run *session) havenUp(ctx context.Context, stack Stack) error {
	run.havenSlugs = append(run.havenSlugs, stack.HavenSlug)
	fmt.Fprintf(run.streams.Err, "%s: haven up --agent --detach (stack %s)\n", stack.Name, stack.HavenSlug)
	spec := commandSpec{name: havenrun.Command, args: havenrun.UpArgs(), dir: stack.Dir, env: havenEnv(run.request.Deps.Environ(), stack.HavenSlug)}
	if err := run.request.Deps.Run(ctx, spec, run.streams.Err); err != nil {
		return fmt.Errorf("haven up %s (%s): %w", stack.Name, stack.HavenSlug, err)
	}
	return nil
}

// havenWaitReady polls haven until the stack's ui and backend lanes are both
// listening, then adopts the app hostname haven allocated for it.
func (run *session) havenWaitReady(ctx context.Context, stack *Stack) error {
	timeout := run.request.Options.BootTimeout
	deadline := time.Now().Add(timeout)
	fmt.Fprintf(run.streams.Err, "%s: waiting for the ui and backend lanes of %q (up to %s)\n", stack.Name, stack.HavenSlug, timeout)
	for {
		status, err := run.havenStatus(ctx, *stack)
		if err == nil {
			if url, ready := havenStackURL(status, stack.HavenSlug); ready {
				stack.HavenURL = url
				fmt.Fprintf(run.streams.Err, "%s: %s ready at %s\n", stack.Name, stack.HavenSlug, url)
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("%s: haven stack %q had no healthy ui/backend lanes within %s\n%s",
				stack.Name, stack.HavenSlug, timeout, run.havenBackendLog(ctx, *stack))
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(havenrun.PollDelay(deadline, havenrun.DefaultReadyPoll)):
		}
	}
}

// havenStackURL reports the app hostname to drive once the named stack's ui
// and backend lanes are both listening. Ready is haven's own answer, never a
// guess from elapsed time.
func havenStackURL(status havenrun.Status, slug string) (string, bool) {
	stack, ready := havenrun.StackReady(status, slug, havenReadyLanes...)
	if !ready {
		return "", false
	}
	return stack.ServiceURL(havenrun.AppService)
}

// havenStatus runs one `haven status --json` and decodes it.
func (run *session) havenStatus(ctx context.Context, stack Stack) (havenrun.Status, error) {
	var out bytes.Buffer
	spec := commandSpec{name: havenrun.Command, args: havenrun.StatusArgs(), dir: stack.Dir, env: havenEnv(run.request.Deps.Environ(), stack.HavenSlug)}
	if err := run.request.Deps.Run(ctx, spec, &out); err != nil {
		return havenrun.Status{}, err
	}
	return havenrun.ParseStatus(out.Bytes())
}

// havenBackendLog is the tail of a stack's backend lane, for the failure
// message of a boot that never became ready.
func (run *session) havenBackendLog(ctx context.Context, stack Stack) string {
	var out bytes.Buffer
	spec := commandSpec{name: havenrun.Command, args: havenrun.BackendLogArgs(stack.HavenSlug), dir: stack.Dir, env: havenEnv(run.request.Deps.Environ(), stack.HavenSlug)}
	if err := run.request.Deps.Run(ctx, spec, &out); err != nil {
		return fmt.Sprintf("(backend log for %s unavailable: %v)", stack.HavenSlug, err)
	}
	return havenrun.LastLines(out.String(), havenrun.DefaultFailureLogLines)
}

// teardownHaven destroys exactly the slugs this run started, then removes
// exactly the worktrees it added. Best-effort throughout: one stack or
// worktree that will not go must not stop the rest from being cleaned up.
func (run *session) teardownHaven(ctx context.Context) error {
	if run.request.Options.Keep {
		fmt.Fprintf(run.streams.Err, "teardown: -keep set, leaving the stacks up - `haven destroy %s` when you are done\n",
			strings.Join(run.havenSlugs, "` and `haven destroy "))
		return nil
	}
	var problems []string
	for _, slug := range run.havenSlugs {
		fmt.Fprintf(run.streams.Err, "teardown: haven destroy %s\n", slug)
		spec := commandSpec{name: havenrun.Command, args: havenrun.DestroyArgs(slug), dir: run.request.Options.Root, env: havenEnv(run.request.Deps.Environ(), slug)}
		if err := run.request.Deps.Run(ctx, spec, run.streams.Err); err != nil {
			problems = append(problems, fmt.Sprintf("haven destroy %s: %v", slug, err))
		}
	}
	for _, dir := range run.created {
		remove := WorktreeRemoveCommand(dir)
		remove.dir = run.request.Options.Root
		if err := run.request.Deps.Run(ctx, remove, run.streams.Err); err != nil {
			problems = append(problems, fmt.Sprintf("worktree remove %s: %v", dir, err))
		}
	}
	if len(problems) == 0 {
		return nil
	}
	return fmt.Errorf("teardown: %s", strings.Join(problems, "; "))
}
