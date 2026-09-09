package apidiff

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
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
	havenCommand = "haven"

	// havenSlugPrefix opens every slug a run allocates. It is what makes the
	// teardown provably narrow: a stack apidiff may destroy is one apidiff
	// named, and haven derives a worktree's own slug from its directory or
	// branch, never from this prefix.
	havenSlugPrefix = "apidiff"

	// havenReadyPoll is how often the readiness loop asks haven for the
	// backend lane. A stack's boot is minutes of install, codegen, migrate and
	// seed; a second between questions is already generous.
	havenReadyPoll = time.Second

	// havenFailureLogLines is how much of a failed stack's backend log the
	// timeout error carries. Enough to name the failure, short enough to read.
	havenFailureLogLines = 40
)

// HavenSlug names the haven stack one instance runs as. Run-scoped so two
// concurrent runs never share a stack, and instance-scoped so the branch and
// the base never share one either.
func HavenSlug(runID, instance string) string {
	return domain.SanitizeSlug(havenSlugPrefix + "-" + runID + "-" + instance)
}

// havenSelected decides where the infrastructure comes from. haven is the
// default wherever it is installed, because it is the only path that cannot
// reach another stack's data. -no-haven opts out, and so does naming the three
// external servers, which is an explicit choice of somebody else's.
func havenSelected(havenOnPath, noHaven, externalGiven bool) bool {
	return havenOnPath && !noHaven && !externalGiven
}

// havenOnPath reports whether the orchestrator is installed.
func havenOnPath() bool {
	_, err := exec.LookPath(havenCommand)
	return err == nil
}

// havenManagedEnvKeys are stripped from the environment every haven command
// inherits. haven decides where a stack's datastores are; a DATABASE_URL,
// CLICKHOUSE_URL, REDIS_URL or REDIS_DB_INDEX carried in from the developer's
// shell is exactly the input that would let this tool point an instance at
// their data again.
var havenManagedEnvKeys = []string{
	"DATABASE_URL", "CLICKHOUSE_URL", "REDIS_URL", "REDIS_DB_INDEX",
	"LANGWATCH_SLUG", "LANGWATCH_INSTANCE_ADMIN_API_KEY",
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
	managed := map[string]bool{}
	for _, key := range havenManagedEnvKeys {
		managed[key] = true
	}
	env := make([]string, 0, len(inherit)+2)
	for _, entry := range inherit {
		name, _, _ := strings.Cut(entry, "=")
		if managed[name] {
			continue
		}
		env = append(env, entry)
	}
	return append(env,
		"LANGWATCH_SLUG="+slug,
		"LANGWATCH_INSTANCE_ADMIN_API_KEY="+throwawayInstanceAdminKey,
	)
}

// havenUpArgs brings one instance's stack up and returns. --agent is plain,
// token-free output; --detach backgrounds the stack instead of attaching the
// log viewer, which is what makes this a call rather than a session.
func havenUpArgs() []string { return []string{"up", "--agent", "--detach"} }

// havenStatusArgs asks for the machine-readable one-shot report.
func havenStatusArgs() []string { return []string{"status", "--agent", "--json"} }

// havenDestroyArgs stops one stack and drops the databases haven made for it.
// The slug is the whole safety story: nothing is derived from a directory, so
// a run can only destroy what it named.
func havenDestroyArgs(slug string) []string {
	return []string{"destroy", slug, "--agent", "--yes"}
}

// havenBackendLogArgs reads one stack's backend lane log, for a boot that
// never became ready.
func havenBackendLogArgs(slug string) []string {
	return []string{"logs", "backend", "--agent", "--stack", slug}
}

// havenStatus is the slice of `haven status --json` this tool reads.
type havenStatus struct {
	Stacks []havenStackStatus `json:"stacks"`
}

type havenStackStatus struct {
	Slug     string             `json:"slug"`
	APIPort  int                `json:"apiPort"`
	Live     bool               `json:"live"`
	Lanes    []havenLaneStatus  `json:"lanes"`
	Services []havenServiceItem `json:"services"`
}

type havenLaneStatus struct {
	Name      string `json:"name"`
	Listening bool   `json:"listening"`
}

type havenServiceItem struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

// havenBackendLane is the lane that answers "is the application actually
// serving": the api and worker applications in one local process.
const havenBackendLane = "backend"

// havenStackReady reports the base URL to probe once the named stack's backend
// lane is up. Ready is haven's own answer - the stack live and its backend
// lane listening - never a guess from elapsed time.
//
// The address is the backend lane's own loopback port, which is where the API
// serves the /api prefix every probed operation path already carries. The
// routed app.<slug> hostname reaches the same application, but only over the
// proxy's own TLS, which this tool's HTTP client has no reason to trust.
func havenStackReady(report havenStatus, slug string) (string, bool) {
	for _, stack := range report.Stacks {
		if stack.Slug != slug || !stack.Live || stack.APIPort == 0 {
			continue
		}
		for _, lane := range stack.Lanes {
			if lane.Name == havenBackendLane && lane.Listening {
				return fmt.Sprintf("http://127.0.0.1:%d", stack.APIPort), true
			}
		}
	}
	return "", false
}

// parseHavenStatus decodes a `haven status --json` report.
func parseHavenStatus(output []byte) (havenStatus, error) {
	var report havenStatus
	if err := json.Unmarshal(output, &report); err != nil {
		return havenStatus{}, fmt.Errorf("haven status --json: %w", err)
	}
	return report, nil
}

// lastLines returns at most count trailing non-empty lines of text, for an
// error that has to say what the stack died of.
func lastLines(text string, count int) string {
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(lines) > count {
		lines = lines[len(lines)-count:]
	}
	return strings.Join(lines, "\n")
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

// prepareHavenInstances detects each side's layout. haven supervises the
// modular layout's lanes and nothing else, so a monolith checkout is refused
// here - with the flag that boots it the old way - rather than left to fail
// eight minutes in as a stack that never became ready.
func (state *bootState) prepareHavenInstances(booted *Booted) error {
	for _, instance := range []*Instance{&booted.A, &booted.B} {
		profile, err := detectProfile(instance.Dir)
		if err != nil {
			return err
		}
		if profile.name != profileModular {
			return fmt.Errorf("%s is the %s layout, which haven does not supervise - boot it with -no-haven", instance.Dir, profile.name)
		}
		instance.Profile = profile
		state.logf("%s: %s profile as haven stack %q (%s)", instance.Name, profile.name, HavenSlug(state.runID, instance.Name), instance.Dir)
	}
	return nil
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
				instance.Name, plan.slug, timeout, state.havenBackendLog(ctx, plan))
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollDelay(deadline)):
		}
	}
}

// pollDelay is the wait before the next question, never longer than what is
// left of the boot timeout - so a short timeout fails when it says it will
// rather than one whole poll interval later.
func pollDelay(deadline time.Time) time.Duration {
	remaining := time.Until(deadline)
	if remaining > 0 && remaining < havenReadyPoll {
		return remaining
	}
	return havenReadyPoll
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

// havenBackendLog is the tail of a stack's backend lane, for the failure
// message of a boot that never became ready.
func (state *bootState) havenBackendLog(ctx context.Context, plan havenPlan) string {
	var out bytes.Buffer
	spec := commandSpec{name: havenCommand, args: havenBackendLogArgs(plan.slug), dir: plan.dir, env: havenEnv(state.environ(), plan.slug)}
	if err := state.run(ctx, spec, &out); err != nil {
		return fmt.Sprintf("(backend log for %s unavailable: %v)", plan.slug, err)
	}
	return lastLines(out.String(), havenFailureLogLines)
}

// destroyHavenStacks tears down exactly the slugs this run started, in the
// order it started them. Best-effort per slug: one stack that will not go must
// not leave the other running.
func (state *bootState) destroyHavenStacks(ctx context.Context) {
	for _, slug := range state.havenSlugs {
		state.logf("teardown: haven destroy %s", slug)
		spec := commandSpec{name: havenCommand, args: havenDestroyArgs(slug), dir: state.cfg.BranchDir, env: havenEnv(state.environ(), slug)}
		if err := state.run(ctx, spec, state.stderr); err != nil {
			state.logf("teardown: haven destroy %s: %v", slug, err)
		}
	}
}
