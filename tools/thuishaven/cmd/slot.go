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
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/semaphore"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/system"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// `haven slot` is the check queue (specs/setup/check-slots.feature) as a haven
// command: `slot run -- <cmd> [args…]` takes a machine-wide slot from the same
// flock semaphore `haven typecheck` uses, runs the command with stdio passed
// straight through, and releases. dev/scripts/check-queue.mjs delegates here
// whenever the haven binary is installed, so on a haven machine the queue's
// decisions are this Go code, not the JS fallback.
//
// The wrapper is deliberately boring on the happy path: with a free slot it
// prints nothing and the command's own stdio, exit code and signals pass
// through untouched. It speaks on stderr only when the run has to wait.

// checkSlotName is the one semaphore every whole-repo check counts against —
// `haven slot run` and `haven typecheck` alike, because they compete for the
// same cores.
const checkSlotName = "checks"

const (
	slotPollInterval  = 500 * time.Millisecond
	slotHeartbeat     = 30 * time.Second
	slotMaxWait       = 30 * time.Minute
	slotAnnounceAfter = 150 * time.Millisecond
)

func runSlot(ctx context.Context, _ deps, inv invocation) error {
	if len(inv.raw) == 0 {
		return errors.New("usage: haven slot run [--label <name>] -- <command> [args…] | haven slot explain")
	}
	switch inv.raw[0] {
	case "explain":
		env := slotCheckEnv()
		reportGateOffIgnored(env)
		pressure := resolveSlotPressure()
		slots, source := resolveSlotLimit(pressure, env)
		fmt.Printf("slots=%d source=%s\n", slots, source)
		fmt.Printf("pressure=%s\n", pressure)
		fmt.Printf("gomemlimit=%s\n", domain.CheckGoMemLimit(system.New().TotalMemory(), os.Getenv("GOMEMLIMIT"), pressure))
		if procs := domain.CheckGoMaxProcs(runtime.NumCPU(), os.Getenv("GOMAXPROCS"), pressure); procs != "" {
			fmt.Printf("gomaxprocs=%s\n", procs)
		}
		return nil
	case "run":
		label, argv, err := parseSlotRun(inv.raw[1:])
		if err != nil {
			return err
		}
		reportGateOffIgnored(slotCheckEnv())
		job := &slotJob{
			sem:      semaphore.New(havenHome()),
			label:    label,
			argv:     argv,
			progress: os.Stderr,
			pressure: resolveSlotPressure(),
		}
		if code := job.run(ctx); code != 0 {
			os.Exit(code)
		}
		return nil
	default:
		return fmt.Errorf("unknown slot subcommand %q — use `slot run -- <cmd>` or `slot explain`", inv.raw[0])
	}
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
// ancestry walk behind HeldByQueue runs only when the marker is present, which
// is only on runs the queue itself spawned.
func slotCheckEnv() domain.CheckEnv {
	return domain.CheckEnv{
		CheckSlots:  os.Getenv("CHECK_SLOTS"),
		CI:          os.Getenv("CI"),
		Claudecode:  os.Getenv("CLAUDECODE"),
		HeldByQueue: heldByLiveAncestor(os.Getenv("CHECK_QUEUE_HELD")),
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

// heldByLiveAncestor verifies a CHECK_QUEUE_HELD marker: the pid it names must
// sit above this process in the live parent chain, so only a wrapper that
// spawned this run — an ancestor by construction — can convince it. A chain
// that cannot be read answers no: a marker that cannot be verified must gate
// nothing off.
func heldByLiveAncestor(raw string) bool {
	candidate, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || candidate <= 1 {
		return false
	}
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

// parentPid reads a process's parent through ps, which is what works for a pid
// that is not our own. Zero means it could not be read.
func parentPid(pid int) int {
	cmd := exec.CommandContext(context.Background(), "ps", "-o", "ppid=", "-p", strconv.Itoa(pid)) //nolint:gosec // G204: fixed argv, the only variable is an integer
	out, err := cmd.Output()
	if err != nil {
		return 0
	}
	parent, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil || parent < 0 {
		return 0
	}
	return parent
}

// resolveSlotPressure measures once per invocation: the level shapes the
// slot count and the child's environment together, and two measurements
// could disagree across their few milliseconds.
func resolveSlotPressure() domain.Pressure {
	return domain.ResolveCheckPressure(
		os.Getenv("CHECK_PRESSURE"),
		domain.ClassifyPressure(system.New().MemStat()),
		os.Getenv("CI"),
	)
}

// parseSlotRun splits `[--label <name>] -- <command> [args…]`. The `--` is
// required so no command flag can ever be read as ours.
func parseSlotRun(raw []string) (label string, argv []string, err error) {
	rest := raw
	if len(rest) >= 2 && rest[0] == "--label" {
		label, rest = rest[1], rest[2:]
	}
	if len(rest) > 0 && rest[0] == "--" {
		rest = rest[1:]
	}
	if len(rest) == 0 {
		return "", nil, errors.New("usage: haven slot run [--label <name>] -- <command> [args…]")
	}
	if label == "" {
		label = rest[0]
	}
	return label, rest, nil
}

// slotAcquirer is what a slot job needs from the semaphore, so tests can pass
// the real flock adapter rooted at a temp dir.
type slotAcquirer interface {
	TryAcquire(name string, slots int) (release func(), slot int, ok bool, err error)
}

// slotJob is one command's trip through the queue: what to run, how the run
// is named to a human, where progress lines go, and the wait state the
// announcements are computed from.
type slotJob struct {
	sem      slotAcquirer
	label    string
	argv     []string
	progress io.Writer
	pressure domain.Pressure

	slots     int
	queuedAt  time.Time
	announced bool
	lastBeat  time.Time
}

// run waits for a machine-wide check slot, runs argv with stdio inherited,
// and returns the command's exit code. The queue is a courtesy, never a gate:
// a semaphore error and the maximum wait both degrade to running anyway, with
// a line on stderr saying so.
func (j *slotJob) run(ctx context.Context) int {
	j.slots, _ = resolveSlotLimit(j.pressure, slotCheckEnv())
	if j.slots <= 0 {
		return slotExec(ctx, j.argv, j.pressure)
	}
	j.queuedAt = time.Now()
	release, canceled := j.wait(ctx)
	if canceled {
		return 130
	}
	if j.announced && release != nil {
		fmt.Fprintf(j.progress, "checks: slot free after %s in the queue, starting now.\n", formatSlotWait(time.Since(j.queuedAt)))
	}
	code := slotExec(ctx, j.argv, j.pressure)
	if release != nil {
		release()
	}
	return code
}

// wait blocks until a slot for the run is free. A nil release means the run
// proceeds without one (semaphore failure or the maximum wait elapsed — both
// already reported); canceled means the context ended the wait.
func (j *slotJob) wait(ctx context.Context) (release func(), canceled bool) {
	for {
		rel, _, ok, err := j.sem.TryAcquire(checkSlotName, j.slots)
		if err != nil {
			fmt.Fprintf(j.progress, "checks: queue unavailable (%v), running without a slot\n", err)
			return nil, false
		}
		if ok {
			return rel, false
		}
		waited := time.Since(j.queuedAt)
		if waited >= slotMaxWait {
			fmt.Fprintf(j.progress,
				"checks: no slot after %s, starting anyway. Another check may be stuck holding one of the %d slots.\n",
				formatSlotWait(waited), j.slots)
			return nil, false
		}
		j.report(waited)
		select {
		case <-ctx.Done():
			return nil, true
		case <-time.After(slotPollInterval):
		}
	}
}

// report announces a queued run once, then heartbeats so a long wait never
// looks like a hung tool.
func (j *slotJob) report(waited time.Duration) {
	if !j.announced && waited >= slotAnnounceAfter {
		j.announced = true
		j.lastBeat = time.Now()
		active := fmt.Sprintf("%d checks are", j.slots)
		if j.slots == 1 {
			active = "1 check is"
		}
		fmt.Fprintf(j.progress,
			"checks: %s already active on this machine (limit %d, set CHECK_SLOTS to change). %s queued, waiting for a free slot\n",
			active, j.slots, j.label)
		return
	}
	if j.announced && time.Since(j.lastBeat) >= slotHeartbeat {
		j.lastBeat = time.Now()
		fmt.Fprintf(j.progress, "checks: %s still queued after %s\n", j.label, formatSlotWait(waited))
	}
}

// slotExec runs argv with stdio inherited, CHECK_SLOTS=0 with this pid in
// CHECK_QUEUE_HELD so nothing below the slot queues behind it (the marker is
// what agent shells honor, and it only convinces a descendant), and GOMEMLIMIT
// (unless the operator set one) so the
// Go-runtime tools this queue wraps degrade to slower instead of resident
// (ADR-095); under memory pressure GOMAXPROCS is capped too, so the run leaves
// cores for the person at the keyboard. Signals are forwarded so Ctrl-C
// reaches the child and the slot is still released afterwards.
func slotExec(ctx context.Context, argv []string, pressure domain.Pressure) int {
	// The whole command is the caller's own argv — this is a process wrapper,
	// running exactly what it was asked to run, as the same user.
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...) //nolint:gosec // G204: wrapper runs the caller's own command
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	cmd.Env = append(os.Environ(),
		"CHECK_SLOTS=0",
		"CHECK_QUEUE_HELD="+strconv.Itoa(os.Getpid()),
		"GOMEMLIMIT="+domain.CheckGoMemLimit(system.New().TotalMemory(), os.Getenv("GOMEMLIMIT"), pressure),
	)
	if procs := domain.CheckGoMaxProcs(runtime.NumCPU(), os.Getenv("GOMAXPROCS"), pressure); procs != "" {
		cmd.Env = append(cmd.Env, "GOMAXPROCS="+procs)
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

func formatSlotWait(d time.Duration) string {
	total := int(d.Round(time.Second).Seconds())
	if total < 60 {
		return fmt.Sprintf("%ds", total)
	}
	return fmt.Sprintf("%dm%02ds", total/60, total%60)
}
