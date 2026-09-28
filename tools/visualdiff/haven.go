package visualdiff

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
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
// whatever the checkout defines. haven now boots a monolith checkout as one
// "app" lane instead of "ui" plus "backend" and reports which layout a stack
// is on (StackStatus.Layout); havenStackURL and havenWaitReady read that
// report, so readiness is still entirely haven's own answer, not a refusal.

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
	stacks := run.liveStacks()
	running, err := run.prepareHaven(ctx, stacks)
	if err != nil {
		return err
	}
	for _, stack := range stacks {
		if err := run.startHaven(ctx, *stack, running[stack.Name]); err != nil {
			return err
		}
	}
	if run.stagger && len(stacks) == 2 {
		arrival := make(chan baseArrival, 1)
		base := run.plan.Base
		go func() { arrival <- run.awaitBase(ctx, base) }()
		run.baseArrival = arrival
		return run.awaitStack(ctx, &run.plan.Candidate)
	}
	for _, stack := range stacks {
		if err := run.awaitStack(ctx, stack); err != nil {
			return err
		}
	}
	return nil
}

// awaitStack waits until haven reports the stack ready and its API answers.
func (run *session) awaitStack(ctx context.Context, stack *Stack) error {
	if err := run.havenWaitReady(ctx, stack); err != nil {
		return err
	}
	return run.waitForAPI(ctx, *stack)
}

// baseArrival is a staggered base once it is ready and seeded, or why it never was.
type baseArrival struct {
	stack    Stack
	fixtures map[string]string
	err      error
}

// awaitBase boots and seeds the base while the candidate already captures:
// the base is the slower boot, and nothing about the candidate waits on it.
func (run *session) awaitBase(ctx context.Context, stack Stack) baseArrival {
	if err := run.awaitStack(ctx, &stack); err != nil {
		return baseArrival{stack: stack, err: err}
	}
	options := run.request.Options
	result, err := run.request.Deps.Seed(ctx, SeedRequest{APIURL: stack.APIURL(), Identity: options.Identity, TraceCount: options.TraceCount})
	if err != nil {
		return baseArrival{stack: stack, err: fmt.Errorf("seed %s: %w", stack.Name, err)}
	}
	for _, warning := range result.Warnings {
		fmt.Fprintf(run.streams.Err, "seed %s: %s\n", stack.Name, warning)
	}
	return baseArrival{stack: stack, fixtures: result.Fixtures}
}

// waitForAPI waits for the API through the routed origin. A monolith's one
// lane listens as soon as its page server does, while its API is still
// booting behind it, and a seed sent then answers 502.
func (run *session) waitForAPI(ctx context.Context, stack Stack) error {
	wait := run.request.Deps.Wait
	if wait == nil {
		return nil
	}
	if err := wait(ctx, []string{stack.APIURL() + HealthPath}, run.request.Options.BootTimeout); err != nil {
		return fmt.Errorf("%s: the API behind %s never answered: %w", stack.Name, stack.APIURL(), err)
	}
	return nil
}

// prepareHaven adopts each stack a -resume run already prepared and checks
// out the rest, reporting which stacks haven already runs.
func (run *session) prepareHaven(ctx context.Context, stacks []*Stack) (map[string]bool, error) {
	running := map[string]bool{}
	for _, stack := range stacks {
		adopted, live, err := run.adoptHaven(ctx, stack)
		if err != nil {
			return nil, err
		}
		running[stack.Name] = live
		if !adopted {
			if err := run.checkoutForHaven(ctx, stack); err != nil {
				return nil, err
			}
		}
	}
	return running, nil
}

// startHaven boots a stack unless haven already runs it, recording it for
// teardown either way.
func (run *session) startHaven(ctx context.Context, stack Stack, running bool) error {
	if running {
		run.havenSlugs = append(run.havenSlugs, stack.HavenSlug)
		return nil
	}
	return run.havenUp(ctx, stack)
}

// adoptHaven takes over a -resume run's own prepared worktree instead of
// checking it out again, and reports whether haven already runs its stack,
// so a resumed run only boots what is not up.
func (run *session) adoptHaven(ctx context.Context, stack *Stack) (bool, bool, error) {
	if !run.request.Options.Resume {
		return false, false, nil
	}
	if !dirExists(stack.Dir) {
		return false, false, nil
	}
	run.created = append(run.created, stack.Dir)
	layout, err := run.request.Deps.Layout(stack.Dir)
	if err != nil {
		return false, false, err
	}
	stack.Layout = layout
	live := false
	if status, err := run.havenStatus(ctx, *stack); err == nil {
		for _, reported := range status.Stacks {
			live = live || (reported.Slug == stack.HavenSlug && reported.Live)
		}
	}
	fmt.Fprintf(run.streams.Err, "%s: resumed %s (haven stack %s, running=%t)\n", stack.Name, stack.Dir, stack.HavenSlug, live)
	return true, live, nil
}

// checkoutForHaven adds one ref's worktree and prepares it. haven's own
// automatic prep is migrate-and-seed, not install-and-build: a fresh
// worktree carries none of the generated or built artifacts a developer
// checkout has (they are all gitignored), so `haven up` there fails in its
// own prepare phase before it ever reaches migrate. Run 20260910-013825 is
// the record of it: base died on "Cannot find module '~/generated/prisma/
// client'", candidate on "Cannot find module '.../langwatch/dist/index.mjs'",
// both then "migrations failed - nothing was dropped". havenPrepare below is
// what closes that gap.
func (run *session) checkoutForHaven(ctx context.Context, stack *Stack) error {
	if stack.Persistent {
		if err := run.checkoutPersistent(ctx, *stack); err != nil {
			return err
		}
	} else {
		steps := &executor{run: run.request.Deps.Run, root: run.request.Options.Root, stderr: run.streams.Err}
		if err := steps.addWorktree(ctx, *stack); err != nil {
			return err
		}
		run.created = append(run.created, stack.Dir)
	}
	layout, err := run.request.Deps.Layout(stack.Dir)
	if err != nil {
		return err
	}
	stack.Layout = layout
	fmt.Fprintf(run.streams.Err, "%s: %s at %s (%s layout, haven stack %s)\n", stack.Name, stack.Ref, stack.Dir, layout, stack.HavenSlug)
	return run.havenPrepare(ctx, *stack)
}

// checkoutPersistent moves a side's persistent worktree to the commit its ref
// names now, adding the worktree the first time.
func (run *session) checkoutPersistent(ctx context.Context, stack Stack) error {
	root := run.request.Options.Root
	commit, err := resolveCommit(ctx, gitRef{run: run.request.Deps.Run, root: root, ref: stack.Ref})
	if err != nil {
		return err
	}
	for _, spec := range PersistentCheckoutCommands(stack.Dir, commit, isWorktree(stack.Dir)) {
		if spec.dir == "" {
			spec.dir = root
		}
		fmt.Fprintf(run.streams.Err, "%s: %s %s\n", stack.Name, spec.name, strings.Join(spec.args, " "))
		if err := run.request.Deps.Run(ctx, spec, run.streams.Err); err != nil {
			return fmt.Errorf("check out %s at %s: %w", stack.Name, commit, err)
		}
	}
	return nil
}

// monolithPrepareCommands are what a monolith worktree needs before haven:
// the install and the Prisma client its migrate and seed load. haven's app
// lane runs dev:app, whose own start:prepare:files builds everything else,
// so running that here too only did the same fifty seconds twice.
var monolithPrepareCommands = []commandSpec{
	{name: "env", args: []string{"-u", "CI", "pnpm", "install", "--frozen-lockfile"}},
	{name: "pnpm", args: []string{"--dir", "platform/app", "exec", "prisma", "generate"}},
}

// HavenPrepareCommands are the steps a fresh worktree needs before `haven up`
// can succeed on it. apidiff needs the modular steps too, so that list lives
// in havenrun.PrepareCommands; the monolith's is visualdiff's own.
func HavenPrepareCommands(layout Layout) []commandSpec {
	if layout == LayoutMonolith {
		return append([]commandSpec(nil), monolithPrepareCommands...)
	}
	steps := havenrun.PrepareCommands(havenrun.Layout(layout))
	commands := make([]commandSpec, 0, len(steps))
	for _, step := range steps {
		commands = append(commands, commandSpec{name: step.Name, args: step.Args})
	}
	return commands
}

// havenPrepare runs HavenPrepareCommands in one stack's worktree, then copies
// the developer's own .env into it. Order matters: start:prepare:files runs
// prisma generate, which reads DATABASE_URL out of the schema's env() call at
// generate time - without .env already in place, that step fails before the
// build step ever gets a chance to.
func (run *session) havenPrepare(ctx context.Context, stack Stack) error {
	copied, err := run.request.Deps.CopyEnv(ctx, run.request.Options.Root, stack.Dir)
	if err != nil {
		return fmt.Errorf("copy env for %s: %w", stack.Name, err)
	}
	fmt.Fprintf(run.streams.Err, "%s: prepare: copy .env files exit=ok (copied %d)\n", stack.Name, copied)
	if stack.Layout == LayoutMonolith && stack.HavenSlug != "" {
		if err := havenrun.PinDotenvOrigin(stack.Dir, havenrun.AppOrigin(stack.HavenSlug)); err != nil {
			return fmt.Errorf("pin origin for %s: %w", stack.Name, err)
		}
	}
	substituted, err := EnsureGatewaySecrets(stack.Dir, run.runID)
	if err != nil {
		return fmt.Errorf("gateway secrets for %s: %w", stack.Name, err)
	}
	if len(substituted) > 0 {
		fmt.Fprintf(run.streams.Err,
			"%s: prepare: SUBSTITUTED GATEWAY SECRETS — %s were absent or shorter than %d characters in the copied .env, "+
				"so this stack booted on throwaway values. The developer's own .env and databases are untouched. "+
				"A gateway failure on this stack is therefore NOT evidence of a missing credential.\n",
			stack.Name, strings.Join(substituted, ", "), MinGatewaySecretLength)
	}
	commands := HavenPrepareCommands(stack.Layout)
	key, cached := run.preparedAlready(ctx, stack, commands)
	if cached {
		fmt.Fprintf(run.streams.Err, "%s: prepare: cached, the worktree already holds this tree's install and generated files\n", stack.Name)
		return nil
	}
	if err := run.runPrepare(ctx, stack, commands); err != nil {
		return err
	}
	if key == "" {
		return nil
	}
	return recordPrepared(stack.Dir, key)
}

// preparedAlready reports a persistent worktree whose last finished prepare
// had this key, and the key to record once this prepare finishes.
func (run *session) preparedAlready(ctx context.Context, stack Stack, commands []commandSpec) (string, bool) {
	if !stack.Persistent {
		return "", false
	}
	tree, err := resolveTree(ctx, gitRef{run: run.request.Deps.Run, root: stack.Dir, ref: "HEAD"})
	if err != nil || tree == "" {
		return "", false
	}
	key := PrepareKey(stack.Layout, tree, commands)
	if preparedKey(stack.Dir) == key {
		return key, true
	}
	if err := recordPrepared(stack.Dir, ""); err != nil {
		fmt.Fprintf(run.streams.Err, "%s: prepare: could not clear the old key: %v\n", stack.Name, err)
	}
	return key, false
}

// runPrepare runs each prepare command in the worktree, logging its exit.
func (run *session) runPrepare(ctx context.Context, stack Stack, commands []commandSpec) error {
	for _, spec := range commands {
		spec.dir = stack.Dir
		fmt.Fprintf(run.streams.Err, "%s: prepare: %s %s\n", stack.Name, spec.name, strings.Join(spec.args, " "))
		err := run.request.Deps.Run(ctx, spec, run.streams.Err)
		fmt.Fprintf(run.streams.Err, "%s: prepare: %s %s exit=%s\n", stack.Name, spec.name, strings.Join(spec.args, " "), exitStatus(err))
		if err != nil {
			return fmt.Errorf("prepare %s (%s %s): %w", stack.Name, spec.name, strings.Join(spec.args, " "), err)
		}
	}
	return nil
}

// exitStatus renders a step's outcome for the run log - "ok" or the error,
// never the command's own output (that already streamed to stderr as it ran).
func exitStatus(err error) string {
	if err == nil {
		return "ok"
	}
	return err.Error()
}

// CopyEnvFiles copies the developer's own untracked .env* files from root
// (the main checkout's workspace root) into dir (a fresh worktree). apidiff
// needs the identical copy, so the implementation lives in
// havenrun.CopyEnvFiles; this is Deps.CopyEnv's real implementation - tests
// supply their own so a fake root never has to exist on disk.
func CopyEnvFiles(ctx context.Context, root, dir string) (int, error) {
	return havenrun.CopyEnvFiles(ctx, root, dir)
}

// havenUp starts one stack. The slug is recorded BEFORE the command runs: an
// up that dies half-way has already created databases under it, and
// teardown has to be able to take them.
func (run *session) havenUp(ctx context.Context, stack Stack) error {
	run.havenSlugs = append(run.havenSlugs, stack.HavenSlug)
	if run.logOffsets == nil {
		run.logOffsets = map[string]int64{}
	}
	run.logOffsets[stack.HavenSlug] = logSize(stack.HavenSlug)
	fmt.Fprintf(run.streams.Err, "%s: haven up --agent --detach (stack %s)\n", stack.Name, stack.HavenSlug)
	spec := commandSpec{name: havenrun.Command, args: havenrun.UpArgs(), dir: stack.Dir, env: havenEnv(run.request.Deps.Environ(), stack.HavenSlug)}
	if err := run.request.Deps.Run(ctx, spec, run.streams.Err); err != nil {
		return fmt.Errorf("haven up %s (%s): %w", stack.Name, stack.HavenSlug, err)
	}
	return nil
}

// havenWaitReady polls haven until the stack's required lanes are listening
// (the ui and backend lanes on a modular checkout, the one app lane on a
// monolith one - see havenStackURL), then adopts the app hostname haven
// allocated for it.
func (run *session) havenWaitReady(ctx context.Context, stack *Stack) error {
	timeout := run.request.Options.BootTimeout
	deadline := time.Now().Add(timeout)
	fmt.Fprintf(run.streams.Err, "%s: waiting for the ui and backend lanes of %q (up to %s)\n", stack.Name, stack.HavenSlug, timeout)
	for {
		if ready, err := run.havenPoll(ctx, stack); ready || err != nil {
			return err
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

// havenPoll asks haven once: ready adopts the stack's URL, and a stack haven
// has already given up on is an error now rather than at the timeout.
func (run *session) havenPoll(ctx context.Context, stack *Stack) (bool, error) {
	status, statusErr := run.havenStatus(ctx, *stack)
	if statusErr != nil {
		// A status call that fails mid-boot is retried; the boot timeout bounds it.
		return false, nil //nolint:nilerr // retried by the caller's poll loop.
	}
	if url, ready := havenStackURL(status, stack.HavenSlug); ready {
		stack.HavenURL = url
		fmt.Fprintf(run.streams.Err, "%s: %s ready at %s\n", stack.Name, stack.HavenSlug, url)
		return true, nil
	}
	if fatal, tail := havenGaveUp(status, stack.HavenSlug, run.logOffsets[stack.HavenSlug]); fatal != "" {
		return false, fmt.Errorf("%s: haven gave up on stack %q: %s\n%s", stack.Name, stack.HavenSlug, fatal, tail)
	}
	return false, nil
}

// havenGaveUp reports haven's own fatal line for a stack that is not live
// and whose log, since from, carries one - so a stack that died in its first
// minute fails the run then rather than at the boot timeout. from skips what
// an earlier `haven up` of the same slug wrote.
func havenGaveUp(status havenrun.Status, slug string, from int64) (string, string) {
	for _, stack := range status.Stacks {
		if stack.Slug == slug && stack.Live {
			return "", ""
		}
	}
	content, err := readFrom(havenrun.StackLogFile(slug), from)
	if err != nil {
		return "", ""
	}
	plain := ansiEscape.ReplaceAllString(content, "")
	for _, line := range strings.Split(plain, "\n") {
		at := strings.Index(line, "haven: ")
		if at < 0 || havenBanner.MatchString(line[at:]) {
			continue
		}
		return strings.TrimSpace(line[at:]), havenrun.LastLines(plain, havenrun.DefaultFailureLogLines)
	}
	return "", ""
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

// havenBanner matches the stack banner haven prints on every start, which is not a failure.
var havenBanner = regexp.MustCompile(`^haven: stack "[^"]+"`)

// ansiEscape matches the terminal control sequences haven's log viewer writes.
var ansiEscape = regexp.MustCompile(`\x1b\[[0-9;?]*[A-Za-z]`)

// logSize is how much of a stack's log exists now, so a later read can skip it.
func logSize(slug string) int64 {
	info, err := os.Stat(havenrun.StackLogFile(slug))
	if err != nil {
		return 0
	}
	return info.Size()
}

func readFrom(path string, from int64) (string, error) {
	file, err := os.Open(path) // #nosec G304 -- a stack log under haven's own home, named by this run's slug.
	if err != nil {
		return "", err
	}
	defer file.Close()
	if _, err := file.Seek(from, io.SeekStart); err != nil {
		return "", err
	}
	content, err := io.ReadAll(file)
	return string(content), err
}

// havenStackURL reports the app hostname to drive once the named stack's
// required lanes are all listening: the ui and backend lanes on a modular
// checkout, the one app lane on a monolith checkout (havenrun.StackReady
// resolves that translation from the stack's own reported layout). Ready is
// haven's own answer, never a guess from elapsed time.
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

// havenBackendLog is the tail of a stack's Node lane log, for the failure
// message of a boot that never became ready: the single app lane on a
// monolith checkout (stack.Layout, set at checkout - see checkoutForHaven),
// the backend lane everywhere else.
func (run *session) havenBackendLog(ctx context.Context, stack Stack) string {
	lane := havenrun.BackendLane
	if stack.Layout == LayoutMonolith {
		lane = havenrun.AppService
	}
	var out bytes.Buffer
	spec := commandSpec{name: havenrun.Command, args: havenrun.LogArgs(lane, stack.HavenSlug), dir: stack.Dir, env: havenEnv(run.request.Deps.Environ(), stack.HavenSlug)}
	if err := run.request.Deps.Run(ctx, spec, &out); err != nil {
		if tail, fileErr := havenrun.StackLogTailOrError(stack.HavenSlug, havenrun.DefaultFailureLogLines); fileErr == nil {
			return tail
		}
		return fmt.Sprintf("(%s log for %s unavailable: %v)", lane, stack.HavenSlug, err)
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
	run.releaseWorktrees()
	if len(run.created) == 0 && run.request.Deps.Detach != nil {
		return run.detachDestroy()
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

// releaseWorktrees lets the next run take the persistent worktrees this run held.
func (run *session) releaseWorktrees() {
	for _, stack := range []*Stack{&run.plan.Base, &run.plan.Candidate} {
		if stack.Persistent {
			releaseWorktree(stack.Dir, run.request.Options.RunDir)
		}
	}
}

// detachDestroy hands each stack's destroy to a process of its own and
// returns: with no worktree to remove after it, nothing has to wait on it,
// and the next run's gc takes any stack a destroy left behind.
func (run *session) detachDestroy() error {
	log := filepath.Join(run.request.Options.RunDir, "teardown.log")
	var problems []string
	for _, slug := range run.havenSlugs {
		fmt.Fprintf(run.streams.Err, "teardown: haven destroy %s in the background (log %s)\n", slug, log)
		spec := commandSpec{name: havenrun.Command, args: havenrun.DestroyArgs(slug), dir: run.request.Options.Root, env: havenEnv(run.request.Deps.Environ(), slug)}
		if err := run.request.Deps.Detach(spec, log); err != nil {
			problems = append(problems, fmt.Sprintf("haven destroy %s: %v", slug, err))
		}
	}
	if len(problems) == 0 {
		return nil
	}
	return fmt.Errorf("teardown: %s", strings.Join(problems, "; "))
}
