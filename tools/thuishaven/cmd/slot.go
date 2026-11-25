package cmd

import (
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/fileregistry"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/semaphore"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/system"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// `haven machine slot` is the check queue (specs/setup/check-slots.feature) as a haven
// command: `slot run -- <cmd> [args…]` takes a machine-wide slot from the same
// flock semaphore `haven machine typecheck` uses, runs the command with stdio passed
// straight through, and releases. dev/scripts/check-queue.mjs delegates here
// whenever the haven binary is installed, so on a haven machine the queue's
// decisions are this Go code, not the JS fallback.
//
// The wrapper is deliberately boring on the happy path: with a free slot it
// prints nothing and the command's own stdio, exit code and signals pass
// through untouched. It speaks on stderr only when the run has to wait.

// checkSlotName is the one semaphore every whole-repo check counts against —
// `haven machine slot run` and `haven machine typecheck` alike, because they compete for the
// same cores.
const checkSlotName = "checks"

const (
	slotPollInterval  = 100 * time.Millisecond
	slotHeartbeat     = 30 * time.Second
	slotMaxWait       = 30 * time.Minute
	slotAnnounceAfter = 150 * time.Millisecond
)

func runSlot(ctx context.Context, _ deps, inv invocation) error {
	if len(inv.raw) == 0 {
		return errors.New("usage: haven machine slot run [--class typecheck|test|lint|build] [--label <name>] [--timeout <duration>] -- <command> [args…] | haven machine slot explain")
	}
	switch inv.raw[0] {
	case "explain":
		env := slotCheckEnv()
		reportGateOffIgnored(env)
		pressure := resolveSlotPressure()
		slots, source := resolveSlotLimit(pressure, env)
		capacity := resolveSlotCapacity(pressure, env, fileregistry.New(havenHome()))
		fmt.Printf("slots=%d source=%s\n", slots, source)
		fmt.Printf("units=%d source=%s\n", capacity.Units, capacity.Source)
		fmt.Printf("capacity=%s\n", capacity.Describe())
		fmt.Printf("pressure=%s\n", pressure)
		fmt.Printf("gomemlimit=%s\n", domain.CheckGoMemLimit(system.New().TotalMemory(), os.Getenv("GOMEMLIMIT"), pressure))
		fmt.Printf("gomaxprocs=%s (a check; a run gets its units)\n", domain.CheckGoMaxProcs(domain.SlotWeight(domain.ClassCheck, ""), os.Getenv("GOMAXPROCS")))
		width, widthSource := domain.UnitTestFullWidth(system.New().TotalMemory(), runtime.NumCPU(), env.TestWorkers)
		fmt.Printf("unit_test_full_width=%d source=%s\n", width, widthSource)
		store := fileregistry.New(havenHome())
		explainHolders(store)
		explainUnitHolders(semaphore.New(havenHome()))
		explainWaiters(store)
		return nil
	case "run":
		args, err := parseSlotRun(inv.raw[1:])
		if err != nil {
			return err
		}
		if domain.UnderRushGate(os.Getenv) {
			return execUnderRush(args.argv, "")
		}
		reportGateOffIgnored(slotCheckEnv())
		store := fileregistry.New(havenHome())
		agentID, caller, overrideHonored := resolvePriorityState(store)
		job := &slotJob{
			sem:             semaphore.New(havenHome()),
			label:           args.label,
			class:           args.class,
			limit:           args.limit,
			argv:            args.argv,
			worktree:        slotWorktree(),
			progress:        os.Stderr,
			pressure:        resolveSlotPressure(),
			registry:        store,
			caller:          caller,
			agentID:         agentID,
			overrideHonored: overrideHonored,
		}
		if code := job.run(ctx); code != 0 {
			os.Exit(code)
		}
		return nil
	default:
		return fmt.Errorf("unknown slot subcommand %q — use `slot run -- <cmd>` or `slot explain`", inv.raw[0])
	}
}

// resolvePriorityState reads what the priority scheduler needs from this
// process's own environment: HAVEN_AGENT_ID is the same signal
// domain.CallerFromAgentID already reads out of a hook payload's agent id -
// set means a sub-agent, absent and a terminal means an interactive person,
// absent and no terminal means a main session. HAVEN_PRIORITY=high is an
// agent stating this run matters; it is honored at most once per agent id
// (empty id is its own shared bucket) per domain.PriorityOverrideWindow, and
// an honored claim is appended to run-history.jsonl so it is visible.
func resolvePriorityState(store *fileregistry.Store) (agentID string, caller domain.CallerKind, overrideHonored bool) {
	agentID = os.Getenv("HAVEN_AGENT_ID")
	caller = domain.CallerFromAgentID(agentID, stdoutIsTTY())
	if !strings.EqualFold(strings.TrimSpace(os.Getenv("HAVEN_PRIORITY")), "high") {
		return agentID, caller, false
	}
	now := time.Now()
	last, hasLast := domain.LastPriorityClaim(store.RunHistory(), agentID)
	if !domain.PriorityOverrideHonored(domain.PriorityOverrideRequest{Requested: true, LastHonoredAt: last, HasLast: hasLast, Now: now}) {
		return agentID, caller, false
	}
	if err := store.AppendRunHistory(domain.NewPriorityClaim(agentID, now)); err != nil {
		fmt.Fprintf(os.Stderr, "checks: could not record the HAVEN_PRIORITY=high claim (%v)\n", err)
	}
	return agentID, caller, true
}

// explainWaiters prints who is currently queued for the shared slot: each
// waiter's class, how long it has waited, and its effective priority right
// now - the ordering `haven machine slot run` is actually scheduling by.
func explainWaiters(store *fileregistry.Store) {
	waiters := store.WaiterSnapshots(checkSlotName)
	if len(waiters) == 0 {
		fmt.Println("waiters: none")
		return
	}
	now := time.Now()
	for _, w := range waiters {
		waited := now.Sub(w.QueuedAt)
		state := domain.WaiterState{Caller: w.Caller, Waited: waited, OverrideHonored: w.OverrideHonored}
		fmt.Printf("waiter: %s, %s, %d units, worktree %s, waited %s, priority %d, command %q\n",
			callerLabel(w.Caller), w.Class, w.Units, filepath.Base(w.Worktree), formatSlotWait(waited), state.Priority(), w.Command)
	}
}

// callerLabel is the human name for a CallerKind, for `haven machine slot explain`'s
// waiter lines.
func callerLabel(c domain.CallerKind) string {
	switch c {
	case domain.Interactive:
		return "person"
	case domain.MainSession:
		return "main session"
	default:
		return "sub-agent"
	}
}

// explainHolders prints who currently holds a heavy slot: each holder's kind,
// how long it has held the slot, and roughly how much longer it has left -
// then, below them, what a run queued behind all of them right now should
// expect to wait. Silent about time wherever there is no history to guess from.
func explainHolders(store *fileregistry.Store) {
	holders := store.HeavyRunSnapshots()
	if len(holders) == 0 {
		fmt.Println("holders: none")
		return
	}
	history := store.RunHistory()
	now := time.Now()
	held := make([]domain.HeldRun, 0, len(holders))
	for _, h := range holders {
		run := domain.NewHeldRun(h.Command, h.StartedAt, now)
		held = append(held, run)
		line := fmt.Sprintf("holder: %s, held %s", run.Kind, formatSlotWait(run.Elapsed))
		if left := domain.DescribeTimeLeft(run.Kind, run.Elapsed, history); left != "" {
			line += ", " + left
		}
		fmt.Println(line)
	}
	if wait, ok := domain.EstimateQueuedWait(domain.QueuedWaitRequest{Held: held}, history); ok {
		fmt.Printf("estimated_wait_if_queued_now=%s\n", domain.FormatWait(wait))
	}
}

// explainUnitHolders prints who holds the unit budget, from the lock files
// themselves: class, units, worktree and pid, or an unnamed unit for a run
// (the gate, `haven machine typecheck`) that takes one file and names nothing.
func explainUnitHolders(sem *semaphore.Semaphore) {
	holders := sem.Holders(checkSlotName)
	if len(holders) == 0 {
		fmt.Println("unit holders: none")
		return
	}
	now := time.Now()
	for _, h := range holders {
		if h.PID <= 0 {
			fmt.Printf("unit holder: unnamed, %d unit (haven gate or machine typecheck)\n", h.Units)
			continue
		}
		fmt.Printf("unit holder: %s, %d units, worktree %s, pid %d, held %s, %s\n",
			h.Class, h.Units, filepath.Base(h.Worktree), h.PID, formatSlotWait(now.Sub(h.StartedAt)), h.Label)
	}
}

// resolveSlotCapacity is the budget `slot run` is admitted against: the
// pressure budget, reshaped by the daemon's capacity tier (measured here when
// no daemon published one) and by any boot someone is waiting on.
func resolveSlotCapacity(pressure domain.Pressure, env domain.CheckEnv, boots bootWaiters) domain.Capacity {
	sys := system.New()
	rec, ok := fileregistry.New(havenHome()).ReadPressure()
	reading, fresh := domain.ReadCapacity(rec, ok, time.Now())
	if !fresh {
		reading = domain.MeasureCapacity(domain.CapacityNormal, domain.SampleLoad(sys.LoadAverage(), runtime.NumCPU(), sys.MemStat()))
	}
	var stacks []string
	if boots != nil {
		for _, w := range boots.WaiterSnapshots(domain.BootWaitName) {
			stacks = append(stacks, w.Command)
		}
	}
	waited, own := domain.BootsWaitedOn(stacks, os.Getenv("HAVEN_BOOT"))
	return domain.ResolveCapacity(domain.CapacityRequest{
		Machine: domain.CheckMachine{TotalRAMBytes: sys.TotalMemory(), NumCPU: runtime.NumCPU(), Pressure: pressure},
		Env:     env, Reading: reading, BootsWaited: waited, BootWork: own,
	})
}

// bootWaiters is the slice of the registry the capacity reads boot claims from.
type bootWaiters interface {
	WaiterSnapshots(name string) []fileregistry.WaiterSnapshot
}

// slotWorktree names the checkout a run came from without spawning git: the
// nearest ancestor holding a .git entry, or the working directory.
func slotWorktree() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	if root, ok := nearestGitAncestor(dir); ok {
		return root
	}
	return dir
}

func resolveSlotLimit(pressure domain.Pressure, env domain.CheckEnv) (int, string) {
	return domain.ResolveCheckSlots(
		domain.CheckMachine{
			TotalRAMBytes: system.New().TotalMemory(),
			NumCPU:        runtime.NumCPU(),
			Pressure:      pressure,
		},
		env,
	)
}

// slotCheckEnv reads the environment the slot limit is resolved from. The
// process walk behind HeldByQueue runs only when the marker is present, which
// is only on runs the queue itself spawned.
func slotCheckEnv() domain.CheckEnv {
	return domain.CheckEnv{
		CheckSlots:  os.Getenv("CHECK_SLOTS"),
		TestWorkers: devEnv("HAVEN_TEST_WORKERS"),
		CI:          os.Getenv("CI"),
		Claudecode:  os.Getenv("CLAUDECODE"),
		HeldByQueue: heldByQueueAncestor(os.Getenv("CHECK_QUEUE_HELD")),
	}
}

// reportGateOffIgnored says why the limit still applies when an agent shell
// asked for the gate to be off. Silence here would read as a broken override.
func reportGateOffIgnored(env domain.CheckEnv) {
	if !domain.GateOffIgnored(env) {
		return
	}
	fmt.Fprintf(os.Stderr,
		"checks: CHECK_SLOTS=%s is ignored in an agent shell; the machine policy applies. Only a person may turn the queue off.\n",
		strings.TrimSpace(env.CheckSlots))
}

// heldByQueueAncestor verifies a CHECK_QUEUE_HELD marker: the pid it names must
// sit above this process in the live parent chain AND be one of the queue's own
// wrappers. Ancestry alone proves nothing, because a shell is an ancestor of
// everything it runs, so CHECK_QUEUE_HELD=$$ would otherwise hand any agent the
// gate-off. A chain that cannot be read answers no: a marker that cannot be
// verified must gate nothing off.
//
// This is a lock on an honest door, not a vault. Anyone who may spawn processes
// on the machine may also spawn one named haven. It stops the one-token
// bypasses, which is what the queue needs: the runs it serializes are all
// started by the wrappers themselves.
func heldByQueueAncestor(raw string) bool {
	candidate, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || candidate <= 1 {
		return false
	}
	if !isQueueCommand(psField(candidate, "args")) {
		return false
	}
	return isLiveAncestor(candidate)
}

// isLiveAncestor reports that candidate sits above this process in the live
// parent chain.
func isLiveAncestor(candidate int) bool {
	current := os.Getpid()
	for hop := 0; hop < 64; hop++ {
		parent := parentPid(current)
		if parent <= 1 {
			return false
		}
		if parent == candidate {
			return true
		}
		current = parent
	}
	return false
}

// isQueueCommand reports that a command line is one of the two programs that
// hand a slot down: the JavaScript wrapper dev/scripts/check-queue.mjs, and the
// haven binary whose slot run does the same job in Go.
func isQueueCommand(command string) bool {
	command = strings.TrimSpace(command)
	if command == "" {
		return false
	}
	if strings.Contains(command, "check-queue.mjs") {
		return true
	}
	executable := filepath.Base(strings.Fields(command)[0])
	return executable == "haven" || strings.HasPrefix(executable, "haven.")
}

// parentPid reads a process's parent through ps, which is what works for a pid
// that is not our own. Zero means it could not be read.
func parentPid(pid int) int {
	parent, err := strconv.Atoi(psField(pid, "ppid"))
	if err != nil || parent < 0 {
		return 0
	}
	return parent
}

// psField reads one ps field of a pid. An empty string means it could not be
// read. -ww because ps otherwise cuts a command line at the terminal width, and
// the script path this reads for sits at the end of one.
func psField(pid int, field string) string {
	cmd := exec.CommandContext(context.Background(), "ps", "-ww", "-o", field+"=", "-p", strconv.Itoa(pid)) //nolint:gosec // G204: fixed argv, the only variables are an integer and a caller-supplied literal
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// resolveSlotPressure resolves the level once per invocation: it shapes the
// slot count and the child's environment together. The daemon's published
// level (ADR-090) is a file read; probing the machine costs ~80 ms a start.
func resolveSlotPressure() domain.Pressure {
	level, fresh := freshPublishedPressure(fileregistry.New(havenHome()).ReadPressure())
	if !fresh {
		level = domain.ClassifyPressure(system.New().MemStat())
	}
	return domain.ResolveCheckPressure(os.Getenv("CHECK_PRESSURE"), level, os.Getenv("CI"))
}

// freshPublishedPressure believes a record the daemon wrote recently. A
// missing, unknown-version or stale record means no daemon is watching, and
// the caller measures: a queue must not read that silence as green.
func freshPublishedPressure(rec domain.PressureRecord, ok bool) (domain.Pressure, bool) {
	now := time.Now()
	if !ok || rec.Version != domain.PressureRecordVersion || now.Sub(rec.WrittenAt) > domain.PressureStaleAfter {
		return domain.Green, false
	}
	return domain.ReadPressure(rec, ok, now), true
}

// slotRunArgs is `slot run`'s own flags and the command after `--`.
type slotRunArgs struct {
	label string
	class domain.SlotClass
	limit time.Duration
	argv  []string
}

// parseSlotRun splits `[--class <class>] [--label <name>] [--timeout <duration>] -- <command> [args…]`.
// The `--` is required so no command flag can ever be read as ours.
func parseSlotRun(raw []string) (slotRunArgs, error) {
	args := slotRunArgs{class: domain.ClassCheck}
	rest := raw
	for len(rest) >= 2 && (rest[0] == "--label" || rest[0] == "--timeout" || rest[0] == "--class") {
		if err := args.set(rest[0], rest[1]); err != nil {
			return slotRunArgs{}, err
		}
		rest = rest[2:]
	}
	if len(rest) > 0 && rest[0] == "--" {
		rest = rest[1:]
	}
	if len(rest) == 0 {
		return slotRunArgs{}, errors.New("usage: haven machine slot run [--class typecheck|test|lint|build] [--label <name>] [--timeout <duration>] -- <command> [args…]")
	}
	if args.label == "" {
		args.label = rest[0]
	}
	args.argv = rest
	return args, nil
}

// set reads one of slot run's own flags.
func (a *slotRunArgs) set(flag, value string) (err error) {
	switch flag {
	case "--label":
		a.label = value
	case "--class":
		a.class, err = domain.ParseSlotClass(value)
	default:
		a.limit, err = parseSlotTimeout(value)
	}
	return err
}

func parseSlotTimeout(raw string) (time.Duration, error) {
	limit, err := time.ParseDuration(raw)
	if err != nil || limit <= 0 {
		return 0, fmt.Errorf("--timeout %q: want a positive duration such as 10m", raw)
	}
	return limit, nil
}

// slotAcquirer is what a slot job needs from the semaphore, so tests can pass
// the real flock adapter rooted at a temp dir.
type slotAcquirer interface {
	TryAcquireUnits(name string, budget int, claim domain.SlotClaim) (release func(), ok bool, err error)
}

// waiterRegistry is what a slot job needs to register itself as queued and
// see who else currently is - the priority scheduler
// (specs/setup/check-slots.feature, "Priority with aging"), kept as its own
// small interface so a test can pass a fake without a real home directory.
type waiterRegistry interface {
	ClaimWaiter(pid int, name string, claim fileregistry.WaiterClaim) (func(), error)
	WaiterSnapshots(name string) []fileregistry.WaiterSnapshot
	ClaimHolder(pid int, name string, claim fileregistry.HolderClaim) (func(), error)
	HolderSnapshots(name string) []fileregistry.HolderSnapshot
}

// slotJob is one command's trip through the queue: what to run, how the run
// is named to a human, where progress lines go, and the wait state the
// announcements are computed from.
type slotJob struct {
	sem       slotAcquirer
	label     string
	class     domain.SlotClass // empty reads as domain.ClassCheck
	limit     time.Duration    // zero means the command may run as long as it likes
	argv      []string
	worktree  string
	progress  io.Writer
	pressure  domain.Pressure
	heartbeat time.Duration // zero means slotHeartbeat

	// registry, caller, agentID and overrideHonored are all optional: a nil
	// registry (every existing call site that builds a slotJob directly, and
	// every test that does not care about priority) skips waiter registration
	// entirely and behaves exactly as it always has - first past the flock
	// wins, same as before this existed.
	registry        waiterRegistry
	caller          domain.CallerKind
	agentID         string
	overrideHonored bool

	budget    int // the machine's units; zero means the gate is off
	units     int // the units this run takes
	capacity  domain.Capacity
	resolved  time.Time // when capacity was last resolved
	queuedAt  time.Time
	announced bool
	lastBeat  time.Time
	started   time.Time
}

// run waits for a machine-wide check slot, runs argv with stdio inherited,
// and returns the command's exit code. The queue is a courtesy, never a gate:
// a semaphore error and the maximum wait both degrade to running anyway, with
// a line on stderr saying so.
func (j *slotJob) run(ctx context.Context) int {
	if j.class == "" {
		j.class = domain.ClassCheck
	}
	j.resolveCapacity()
	if j.budget <= 0 {
		return slotExec(ctx, j.argv, j.runEnv())
	}
	j.queuedAt = time.Now()
	release, canceled := j.wait(ctx)
	if canceled {
		return 130
	}
	if j.announced && release != nil {
		fmt.Fprintf(j.progress, "checks: slot free after %s in the queue, starting now.\n", formatSlotWait(time.Since(j.queuedAt)))
	}
	if release != nil {
		defer j.claimHolder()()
	}
	code := j.exec(ctx)
	if release != nil {
		release()
	}
	return code
}

// resolveCapacity sets the budget and this run's units from the capacity now.
// A registry that is not the file store (a test fake) sees no boot claims.
func (j *slotJob) resolveCapacity() {
	boots, _ := j.registry.(bootWaiters)
	j.capacity = resolveSlotCapacity(j.pressure, slotCheckEnv(), boots)
	j.resolved = time.Now()
	j.budget = j.capacity.Units
	// A weight over a pressured budget takes the whole budget, or it would wait forever.
	j.units = j.capacity.RunUnits(j.class, os.Getenv("VITEST_MAX_WORKERS"))
	if j.budget > 0 {
		j.units = min(j.units, j.budget)
	}
}

// capacityRefresh is how often a queued run re-reads the capacity, so a boot
// that became ready or a machine that went quiet applies at its admission.
const capacityRefresh = time.Second

// claimHolder lets queued runs name this one while it holds the slot. A nil
// registry or a write error degrades to staying anonymous.
func (j *slotJob) claimHolder() func() {
	if j.registry == nil {
		return func() {}
	}
	release, err := j.registry.ClaimHolder(os.Getpid(), checkSlotName, fileregistry.HolderClaim{
		Label: j.label, StartedAt: j.startedAt(), Class: string(j.class), Units: j.units, Worktree: j.worktree,
	})
	if err != nil {
		return func() {}
	}
	return release
}

// exec runs the command, stopping it with exit 124 once it outlives limit, so
// a stuck check fails instead of holding its caller and its slot forever.
func (j *slotJob) exec(ctx context.Context) int {
	if j.limit <= 0 {
		return slotExec(ctx, j.argv, j.runEnv())
	}
	runCtx, cancel := context.WithTimeout(ctx, j.limit)
	defer cancel()
	code := slotExec(runCtx, j.argv, j.runEnv())
	if ctx.Err() == nil && errors.Is(runCtx.Err(), context.DeadlineExceeded) {
		fmt.Fprintf(j.progress, "checks: %s ran past %s and was stopped; it is stuck or the machine is overloaded.\n", j.label, j.limit)
		return 124
	}
	return code
}

// wait blocks until a slot for the run is free. A nil release means the run
// proceeds without one (semaphore failure or the maximum wait elapsed — both
// already reported); canceled means the context ended the wait.
func (j *slotJob) wait(ctx context.Context) (release func(), canceled bool) {
	unregister := j.registerWaiter()
	defer unregister()
	for {
		if rel, done := j.attemptAcquire(); done {
			return rel, false
		}
		waited := time.Since(j.queuedAt)
		if waited >= slotMaxWait {
			fmt.Fprintf(j.progress,
				"checks: no slot after %s, starting anyway. Another check may be stuck holding part of the %d units.\n",
				formatSlotWait(waited), j.budget)
			return nil, false
		}
		j.report(waited)
		if time.Since(j.resolved) >= capacityRefresh {
			j.resolveCapacity()
		}
		select {
		case <-ctx.Done():
			return nil, true
		case <-time.After(slotPollInterval):
		}
	}
}

// attemptAcquire is one poll tick's worth of trying for the slot: a higher-
// priority waiter (if any is registered) means sitting this tick out
// entirely, and a semaphore error is treated the same as a granted slot -
// both end the wait, one with something to run under and one without. done
// is true whenever wait should stop looping, whatever the result; release is
// only ever non-nil alongside done.
func (j *slotJob) attemptAcquire() (release func(), done bool) {
	if j.shouldYieldToHigherPriority() {
		return nil, false
	}
	now := time.Now()
	rel, ok, err := j.sem.TryAcquireUnits(checkSlotName, j.budget, domain.SlotClaim{
		PID: os.Getpid(), Class: string(j.class), Units: j.units, Worktree: j.worktree, Label: j.label, StartedAt: now,
	})
	if ok {
		j.started = now
	}
	if err != nil {
		fmt.Fprintf(j.progress, "checks: queue unavailable (%v), running without a slot\n", err)
		return nil, true
	}
	if ok {
		return rel, true
	}
	return nil, false
}

// registerWaiter records this run as queued for name's slot, so every other
// waiter's priority scheduler can see it and compare itself against it. A
// registry error, or none at all wired, degrades to no registration: this
// run still competes for the slot exactly as before, it simply never yields
// to anyone and nobody yields to it.
func (j *slotJob) registerWaiter() func() {
	if j.registry == nil {
		return func() {}
	}
	release, err := j.registry.ClaimWaiter(os.Getpid(), checkSlotName, fileregistry.WaiterClaim{
		Command:         strings.Join(j.argv, " "),
		Caller:          j.caller,
		AgentID:         j.agentID,
		QueuedAt:        j.queuedAt,
		OverrideHonored: j.overrideHonored,
		Blocked:         j.capacity.BootWork,
		Class:           string(j.class),
		Units:           j.units,
		Worktree:        j.worktree,
	})
	if err != nil {
		return func() {}
	}
	return release
}

// shouldYieldToHigherPriority reports that another queued run goes first: a
// higher effective priority (domain.EffectivePriority), or the same one and
// queued earlier (domain.WaitBehind), so a big run at the head is not starved.
// With no registry wired this is always false: first past the flock wins.
func (j *slotJob) shouldYieldToHigherPriority() bool {
	if j.registry == nil {
		return false
	}
	now := time.Now()
	self := domain.WaiterState{Caller: j.caller, Waited: now.Sub(j.queuedAt), OverrideHonored: j.overrideHonored, Blocked: j.capacity.BootWork}
	pid := os.Getpid()
	var others []domain.WaiterState
	for _, w := range j.registry.WaiterSnapshots(checkSlotName) {
		if w.PID == pid {
			continue
		}
		others = append(others, domain.WaiterState{Caller: w.Caller, Waited: now.Sub(w.QueuedAt), OverrideHonored: w.OverrideHonored, Blocked: w.Blocked})
	}
	return domain.WaitBehind(self, others)
}

// report announces a queued run once, then heartbeats so a long wait never
// looks like a hung tool.
func (j *slotJob) report(waited time.Duration) {
	if !j.announced && waited >= slotAnnounceAfter {
		j.announced = true
		j.lastBeat = time.Now()
		checks := max(1, j.budget/2)
		fmt.Fprintf(j.progress,
			"checks: %d units are already active on this machine (limit %d, %d units; %s; set CHECK_SLOTS to change). %s queued, waiting for %d units\n",
			j.budget, checks, j.budget, j.capacity.Describe(), j.label, j.units)
		return
	}
	beat := j.heartbeat
	if beat <= 0 {
		beat = slotHeartbeat
	}
	if j.announced && time.Since(j.lastBeat) >= beat {
		j.lastBeat = time.Now()
		fmt.Fprintf(j.progress, "checks: %s still queued%s after %s%s\n", j.label, j.positionNote(), formatSlotWait(waited), j.activeNote())
	}
}

// positionNote is " at position N": arrival order among the runs queued for
// the slot, as main's queue reported it. Empty without a registry or when this
// run's own registration is not visible.
func (j *slotJob) positionNote() string {
	if j.registry == nil {
		return ""
	}
	waiters := j.registry.WaiterSnapshots(checkSlotName)
	sort.Slice(waiters, func(a, b int) bool {
		if !waiters[a].QueuedAt.Equal(waiters[b].QueuedAt) {
			return waiters[a].QueuedAt.Before(waiters[b].QueuedAt)
		}
		return waiters[a].PID < waiters[b].PID
	})
	for i, w := range waiters {
		if w.PID == os.Getpid() {
			return fmt.Sprintf(" at position %d", i+1)
		}
	}
	return ""
}

// activeNote is ". Active: <label> for Ns, ..." naming the runs holding the
// slots, oldest first, three at most.
func (j *slotJob) activeNote() string {
	if j.registry == nil {
		return ""
	}
	holders := j.registry.HolderSnapshots(checkSlotName)
	if len(holders) == 0 {
		return ""
	}
	sort.Slice(holders, func(a, b int) bool { return holders[a].StartedAt.Before(holders[b].StartedAt) })
	now := time.Now()
	var shown []string
	for _, h := range holders[:min(len(holders), 3)] {
		shown = append(shown, fmt.Sprintf("%s for %s", h.Label, formatSlotWait(now.Sub(h.StartedAt))))
	}
	note := ". Active: " + strings.Join(shown, ", ")
	if hidden := len(holders) - 3; hidden > 0 {
		note += fmt.Sprintf(" and %d more", hidden)
	}
	return note
}

// slotExec runs argv with stdio inherited and CHECK_SLOTS=0 plus this pid in
// CHECK_QUEUE_HELD, so nothing below it queues again. The child gets GOMEMLIMIT
// (ADR-095), GOMAXPROCS = its units and, for a test run, VITEST_MAX_WORKERS =
// its units; an operator's own value of each wins. Signals are forwarded.
func slotExec(ctx context.Context, argv []string, run slotRunEnv) int {
	// The whole command is the caller's own argv — this is a process wrapper,
	// running exactly what it was asked to run, as the same user.
	spawn := agentBandArgv(qosEnv{goos: runtime.GOOS, getenv: os.Getenv}, argv, run.band)
	cmd := exec.CommandContext(ctx, spawn[0], spawn[1:]...) //nolint:gosec // G204: wrapper runs the caller's own command
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.Env = append(os.Environ(),
		"CHECK_SLOTS=0",
		"CHECK_QUEUE_HELD="+strconv.Itoa(os.Getpid()),
		"GOMEMLIMIT="+domain.CheckGoMemLimit(system.New().TotalMemory(), os.Getenv("GOMEMLIMIT"), run.pressure),
	)
	cmd.Env = append(cmd.Env, "GOMAXPROCS="+domain.CheckGoMaxProcs(run.units, os.Getenv("GOMAXPROCS")))
	if workers := domain.CheckVitestWorkers(run.class, run.units, os.Getenv("VITEST_MAX_WORKERS")); workers != "" {
		cmd.Env = append(cmd.Env, "VITEST_MAX_WORKERS="+workers)
	}
	relay := notifySignalRelay()
	if err := cmd.Start(); err != nil {
		relay.stopNotify()
		fmt.Fprintf(os.Stderr, "checks: could not run %s: %v\n", argv[0], err)
		return 127
	}
	relay.forwardTo(cmd.Process)
	err := cmd.Wait()
	death := slotDeath{forwarded: relay.close(), canceled: ctx.Err() != nil}
	reportOutsideKill(err, argv[0], death)
	return slotExitCode(err, argv[0])
}

// agentQoSArgv runs an agent's command (CLAUDECODE or HAVEN_AGENT_ID set) on
// macOS under `taskpolicy -c utility`, never -b (plan haven-exec-policy section
// 6), so the person's UI keeps the cores. HAVEN_AGENT_QOS=off keeps the default
// band; a person's shell is never clamped. A command that is not found stays
// bare, so the run still fails with 127.
func agentQoSArgv(goos string, getenv func(string) string, argv []string) []string {
	return agentBandArgv(qosEnv{goos: goos, getenv: getenv}, argv, domain.BandUtility)
}

// qosEnv is where a spawn's band is decided: the OS and the environment.
type qosEnv struct {
	goos   string
	getenv func(string) string
}

// agentBandArgv is agentQoSArgv for a band the capacity chose: behind a boot
// someone waits on, `nice -n 10` (not `taskpolicy -b`, which pins the run to
// Apple Silicon's efficiency cores); a waited-on boot's own run, no clamp.
func agentBandArgv(env qosEnv, argv []string, band domain.RunBand) []string {
	if band == domain.BandDefault || env.goos != "darwin" || (env.getenv("CLAUDECODE") == "" && env.getenv("HAVEN_AGENT_ID") == "") {
		return argv
	}
	if qos := strings.ToLower(strings.TrimSpace(env.getenv("HAVEN_AGENT_QOS"))); qos != "" && qos != "utility" {
		return argv
	}
	if _, err := exec.LookPath(argv[0]); err != nil {
		return argv
	}
	if band == domain.BandBackground {
		return append([]string{"/usr/bin/nice", "-n", "10"}, argv...)
	}
	return append([]string{"/usr/sbin/taskpolicy", "-c", "utility"}, argv...)
}

// slotDeath is what the wrapper knows about how the child ended beyond the
// Wait error: which signals it forwarded, and whether it ended the run itself
// through the context. exec.CommandContext kills with SIGKILL on cancellation,
// which no forwarded-signal record can account for, so the cancellation is
// tracked next to them.
type slotDeath struct {
	forwarded map[syscall.Signal]bool
	canceled  bool
}

// signalRelay passes the wrapper's terminating signals down to the child and
// records which ones it sent. Which signals, not merely whether any: a run
// that is interrupted and then killed by the OS dies of a signal nobody
// forwarded, and that is the death worth naming, which a boolean would have
// suppressed because an earlier SIGINT set it.
type signalRelay struct {
	mu        sync.Mutex
	forwarded map[syscall.Signal]bool
	signals   chan os.Signal
	stop      chan struct{}
	done      chan struct{}
}

// notifySignalRelay starts listening before there is a child to forward to.
// Until signal.Notify runs, a terminating signal keeps its default disposition
// and ends the wrapper where it stands: the interrupt reaches nobody and the
// command runs on with no parent. The OS drops the slot's flock with the
// wrapper, so the queue counts that slot free and can start another check on
// top of a run that is still using the machine, which is the oversubscription
// the queue exists to prevent. The channel is buffered, so a signal that
// arrives before the child exists waits in it for forwardTo.
func notifySignalRelay() *signalRelay {
	signals := make(chan os.Signal, 4)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM, syscall.SIGHUP)
	return newSignalRelay(signals)
}

// forwardTo starts passing signals to the child, including any that arrived
// while it was starting.
func (r *signalRelay) forwardTo(proc *os.Process) {
	go r.pump(proc)
}

// stopNotify gives up the listening for a run that never started, where there
// is no pump for close to wait on.
func (r *signalRelay) stopNotify() {
	signal.Stop(r.signals)
}

// newSignalRelay builds the relay over a channel the caller owns, so a test
// can deliver a signal without raising one at the whole test binary.
func newSignalRelay(signals chan os.Signal) *signalRelay {
	return &signalRelay{
		forwarded: map[syscall.Signal]bool{},
		signals:   signals,
		stop:      make(chan struct{}),
		done:      make(chan struct{}),
	}
}

func (r *signalRelay) pump(proc *os.Process) {
	defer close(r.done)
	defer signal.Stop(r.signals)
	for {
		select {
		case sig := <-r.signals:
			r.record(sig)
			_ = proc.Signal(sig)
		case <-r.stop:
			r.drain()
			return
		}
	}
}

// drain records the signals still queued when the child died. A Ctrl-C at a
// terminal reaches the whole process group, so the child can die of the signal
// while the wrapper's own copy of it is still in the channel. Without this the
// select can take the stop branch, discard that copy, and report the operator's
// own interrupt as a kill from outside, which is the mistake this whole report
// exists to prevent.
func (r *signalRelay) drain() {
	for {
		select {
		case sig := <-r.signals:
			r.record(sig)
		default:
			return
		}
	}
}

func (r *signalRelay) record(sig os.Signal) {
	number, ok := sig.(syscall.Signal)
	if !ok {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.forwarded[number] = true
}

// close ends the relay and reports the signals it forwarded. It waits for the
// pump to drain what is still queued, so a signal delivered to the process
// group is in the record before the caller reads it.
func (r *signalRelay) close() map[syscall.Signal]bool {
	close(r.stop)
	<-r.done
	r.mu.Lock()
	defer r.mu.Unlock()
	return maps.Clone(r.forwarded)
}

// reportOutsideKill names the one death this wrapper is reliably blamed for
// and did not cause. A child that dies by a signal the wrapper never forwarded
// was killed from outside: an operator, or macOS reclaiming memory. Without
// this line the run ends in a bare exit 137, which reads as "the queue killed
// it" and teaches people (and agents) to bypass the queue with CHECK_SLOTS=0,
// removing the machine-wide serialization for everyone.
//
// The test is the signal that ended the child, not whether any signal was
// forwarded before it. Ctrl-C on a child that ignores SIGINT and is then
// reclaimed by the OS is an outside kill and says so.
func reportOutsideKill(err error, argv0 string, death slotDeath) {
	if err == nil || death.canceled {
		return
	}
	exitErr, ok := errors.AsType[*exec.ExitError](err)
	if !ok {
		return
	}
	status, isStatus := exitErr.Sys().(syscall.WaitStatus)
	if !isStatus || !status.Signaled() {
		return
	}
	sig := status.Signal()
	if death.forwarded[sig] {
		return
	}
	fmt.Fprintf(os.Stderr,
		"checks: %s was killed from outside by signal %d (%s). The queue never kills runs; the likely cause is an operator kill or the OS reclaiming memory. Re-run the same command. Do not set CHECK_SLOTS=0.\n",
		argv0, int(sig), sig.String())
}

// slotExitCode maps a Wait error to the exit code the wrapper passes through:
// the child's own code, 128+signal for a signaled child, 127 for a command
// that could not run at all.
func slotExitCode(err error, argv0 string) int {
	if err == nil {
		return 0
	}
	if exitErr, ok := errors.AsType[*exec.ExitError](err); ok {
		if status, isStatus := exitErr.Sys().(syscall.WaitStatus); isStatus && status.Signaled() {
			return 128 + int(status.Signal())
		}
		return exitErr.ExitCode()
	}
	fmt.Fprintf(os.Stderr, "checks: could not run %s: %v\n", argv0, err)
	return 127
}

// slotRunEnv is what shapes a child's limits: the level, the class and the
// units it holds.
type slotRunEnv struct {
	pressure domain.Pressure
	class    domain.SlotClass
	units    int
	band     domain.RunBand // empty reads as utility
}

func (j *slotJob) runEnv() slotRunEnv {
	return slotRunEnv{pressure: j.pressure, class: j.class, units: j.units, band: j.capacity.AgentBand()}
}

// startedAt is when the run took its units, fixed once so every claim agrees.
func (j *slotJob) startedAt() time.Time {
	if j.started.IsZero() {
		j.started = time.Now()
	}
	return j.started
}

func formatSlotWait(d time.Duration) string {
	total := int(d.Round(time.Second).Seconds())
	if total < 60 {
		return fmt.Sprintf("%ds", total)
	}
	return fmt.Sprintf("%dm%02ds", total/60, total%60)
}
