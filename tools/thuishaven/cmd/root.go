// Package cmd is thuishaven's composition root: it builds the adapters, injects
// them into the application core, and dispatches subcommands. It is the only
// package that knows about every other one — the dependency graph is one-way.
package cmd

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/clickhousedocker"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/colima"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/dashboard"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/fileregistry"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/hygiene"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/otellgtm"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/portlessproxy"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/postgresbrew"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/procsupervisor"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/redisbrew"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/semaphore"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/system"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Root parses the global flags, wires the object graph, and dispatches. The three
// steps are separate so none of them grows the others: meta commands answer
// before anything is built, wire() is the only place adapters are constructed,
// and the command table is a table, not a ladder of branches.
func Root(ctx context.Context, logger *zap.Logger, version string, args []string) error {
	var hasAgentFlag bool
	args, hasAgentFlag = stripFlag(args, "--agent")
	isAgent := hasAgentFlag || resolveAgent()

	if handled := runMetaCommand(args, version); handled {
		return nil
	}

	d := wire(logger, isAgent)

	// SIGINT/SIGTERM cancel the context. Supervisors hard-kill child process
	// groups immediately; command cleanup then deregisters routes and resources.
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Bare `haven`: the interactive hub in a terminal, the plain stack list when
	// driven by an agent/pipe.
	if len(args) == 0 {
		if isAgent {
			return d.orch.Status(true, d.worktree)
		}
		return runHub(ctx, d)
	}
	return d.dispatch(ctx, args[0], args[1:])
}

// runMetaCommand answers the subcommands that need no wiring at all, so `haven
// help` works in a directory where git or the adapters would fail.
func runMetaCommand(args []string, version string) bool {
	if len(args) == 0 {
		return false
	}
	switch args[0] {
	case "help", "-h", "--help":
		fmt.Print(helpText)
		return true
	case "version", "-v", "--version":
		fmt.Println(version)
		return true
	}
	return false
}

// deps is the wired object graph a command runs against.
type deps struct {
	orch     *app.Orchestrator
	dash     app.Dashboard
	params   app.UpParams
	opts     app.PlanOptions
	worktree string
	lwDir    string
	isAgent  bool
}

// wire builds every adapter and injects them into the application core. It is the
// only function that knows the full dependency graph.
func wire(logger *zap.Logger, isAgent bool) deps {
	cwd, _ := os.Getwd()
	worktree := gitTopLevel(cwd)
	lwDir := filepath.Join(worktree, "platform", "app")

	naming := domain.DefaultNaming(devEnv("LANGWATCH_LOCAL_TLD"))
	proxy := portlessproxy.New(naming, lwDir)
	store := fileregistry.New(havenHome())
	sup := procsupervisor.New(isAgent)
	sys := system.New()
	hyg := hygiene.New()
	sem := semaphore.New(havenHome())
	sharedURL := func(svc string) string {
		scheme, port := proxy.Endpoint()
		return naming.URL(svc, "", scheme, port)
	}

	// ClickHouse and observability share one colima VM (not Docker Desktop): its
	// ceiling is explicit and per-profile, so neither container can quietly take
	// the machine. Both containers are sized against this machine's RAM/CPU.
	ram, cpus := sys.TotalMemory(), runtime.NumCPU()
	rt := colima.New(envOr("HAVEN_COLIMA_PROFILE", "default"), domain.DefaultColimaLimits(ram, cpus))
	ch := clickhousedocker.New(rt, havenHome(), envOr("HAVEN_CH_IMAGE", domain.ClickHouseImage), clickHouseLimits())
	pg := postgresbrew.New(envOr("HAVEN_PG_FORMULA", domain.DefaultPostgresFormula), envInt("HAVEN_PG_PORT", domain.DefaultPostgresPort))
	rds := redisbrew.New(
		envOr("HAVEN_REDIS_FORMULA", domain.DefaultRedisFormula),
		envInt("HAVEN_REDIS_PORT", domain.DefaultRedisPort),
		envInt("HAVEN_REDIS_MAXMEMORY_MB", domain.DefaultRedisMaxMemoryMB),
	)
	obs := otellgtm.New(
		rt,
		havenHome(),
		envOr("HAVEN_OBS_IMAGE", domain.ObservabilityImage),
		observabilityEndpoints(),
		domain.DefaultObservabilityLimits(ram, cpus),
	)

	// The console floor haven imposes while the observability stack is up: default
	// warn, because the full info/debug stream is in Grafana and the terminal only
	// needs what wants a human. LW_OBS_CONSOLE_LEVEL overrides it; "off"/"none"/""
	// opts out and leaves the console to .env.
	obsConsoleLevel := "warn"
	if v, ok := dotenvLookup("LW_OBS_CONSOLE_LEVEL"); ok {
		obsConsoleLevel = v
	}
	if obsConsoleLevel == "off" || obsConsoleLevel == "none" {
		obsConsoleLevel = ""
	}

	cfg := app.Config{
		Naming:                   naming,
		Home:                     havenHome(),
		IdleTTL:                  envDuration("HAVEN_IDLE_TTL", 4*time.Hour),
		DBIdleTTL:                envDuration("HAVEN_DB_TTL", 14*24*time.Hour),
		HeartbeatEvery:           30 * time.Second,
		DaemonArgv:               selfArgv(trustedRepoRoot(), "daemon"),
		IsAgent:                  isAgent,
		ShouldManageClickHouse:   devEnv("LANGWATCH_HAVEN_CH") != "0",
		ShouldStopClickHouseIdle: devEnv("LANGWATCH_HAVEN_CH_STOP_IDLE") == "1",
		ShouldManagePostgres:     devEnv("LANGWATCH_HAVEN_PG") != "0",
		ShouldManageRedis:        devEnv("LANGWATCH_HAVEN_REDIS") != "0",
		// Observability shares CH's colima VM, so it defaults ON now — the VM is
		// already paying for itself. LANGWATCH_HAVEN_OBS=0 opts out.
		ShouldStartObservability:  devEnv("LANGWATCH_HAVEN_OBS") != "0",
		LocalAPIKey:               envOr("LANGWATCH_LOCAL_API_KEY", domain.DefaultLocalAPIKey),
		RepoRoot:                  worktree,
		ObservabilityConsoleLevel: obsConsoleLevel,
	}

	return deps{
		orch: app.New(cfg, proxy, store, sup, sys, ch, pg, rds, obs, hyg, sem, rt, logger),
		dash: dashboard.New(store.Stacks, sharedURL, dashboard.Probes{
			PortInUse:    sys.PortInUse,
			ProcessAlive: sys.ProcessAlive,
			GroupRSS:     sys.GroupRSS,
			TotalMemory:  sys.TotalMemory,
		}),
		params:   app.UpParams{WorktreeDir: worktree, LwDir: lwDir, Branch: gitBranch(worktree), ExplicitSlug: os.Getenv("LANGWATCH_SLUG"), IsBaseline: os.Getenv("HAVEN_BASELINE") == "1", IsLinkedWorktree: gitIsLinkedWorktree(worktree), UntrustedCheckout: os.Getenv("HAVEN_UNTRUSTED_CHECKOUT") == "1"},
		opts:     optionsFromEnv(worktree),
		worktree: worktree,
		lwDir:    lwDir,
		isAgent:  isAgent,
	}
}

// observabilityEndpoints are fixed ports rather than ephemeral ones: the gcx CLI
// and any agent all need to find the stack without asking haven first.
func observabilityEndpoints() domain.ObservabilityEndpoints {
	e := domain.DefaultObservabilityEndpoints()
	e.GrafanaPort = envInt("LW_OBS_GRAFANA_PORT", e.GrafanaPort)
	e.OTLPHTTPPort = envInt("LW_OBS_OTLP_HTTP_PORT", e.OTLPHTTPPort)
	e.OTLPGRPCPort = envInt("LW_OBS_OTLP_GRPC_PORT", e.OTLPGRPCPort)
	return e
}

// clickHouseLimits applies the proven-in-production memory tuning, with the
// container ceiling overridable for a machine that needs more (or less).
func clickHouseLimits() domain.ClickHouseLimits {
	l := domain.DefaultClickHouseLimits()
	if mb := envInt("LANGWATCH_HAVEN_CH_MEMORY_MB", 0); mb > 0 {
		l.ContainerMemoryMB = mb
		l.MaxServerMemory = int64(mb) * 9 / 10 * (1 << 20)
	}
	if envTruthy("HAVEN_CLICKHOUSE_FULL_LOGS") {
		l.LightweightLogsEnabled = false
	}
	l.SystemLogTTLDays = envInt("HAVEN_CLICKHOUSE_LOG_TTL_DAYS", l.SystemLogTTLDays)
	return l
}

func optionsFromEnv(repoRoot string) app.PlanOptions {
	return app.PlanOptions{
		ShouldGoWatch: devEnv("LANGWATCH_GO_WATCH") == "1",
		ShouldSeed:    os.Getenv("LANGWATCH_SEED") == "1",
		// The langyagent worker's local isolation posture. Default (neither flag) is
		// the sandboxed, production-like tier: the worker runs in colima with the
		// per-worker UID sandbox on. LANGY_UNSAFE_CONTAINER relaxes the sandbox inside
		// the VM; LANGY_UNSAFE_HOST_ACCESS drops the VM and runs it on the host.
		LangyTier: domain.ResolveLangyTier(
			envTruthy("LANGY_UNSAFE_CONTAINER"),
			envTruthy("LANGY_UNSAFE_HOST_ACCESS"),
		),
		IsStub:   os.Getenv("HAVEN_STUB") == "1",
		RepoRoot: repoRoot,
	}
}

// removedSelectionEnv are the pre-ADR-064 ways to choose services. Selection is
// sticky and reported now, so honouring an env var would make `haven status`
// lie about the stack it just started — and silently ignoring one would run
// services the developer believes they turned off. They are refused with their
// replacement instead, exactly like a removed command spelling.
//
// Only the values that used to change what ran are refused: WORKERS_IN_PROCESS=1
// is still how `pnpm dev` (outside haven) asks for a single process, so a
// checkout carrying it must not be blocked from starting a stack.
var removedSelectionEnv = []struct {
	name        string
	applied     func(value string) bool
	replacement string // the sticky command that does the same thing
	note        string // said instead when nothing replaces it
}{
	{name: "LANGWATCH_SKIP_NLP", applied: isTrue, replacement: "haven up -nlp"},
	{name: "LANGWATCH_SKIP_AIGATEWAY", applied: isTrue, replacement: "haven up -gateway"},
	{name: "LANGWATCH_SKIP_LANGYAGENT", applied: isTrue, replacement: "haven up -langy"},
	{name: "WORKERS_IN_PROCESS", applied: isFalse, replacement: "haven up +workers"},
	{
		name:    "START_WORKERS",
		applied: isFalse,
		note:    "the worker stack is part of the app now, and `haven up +workers` only moves it into its own lane",
	},
}

// isTrue and isFalse read a removed knob for intent, not for one literal.
//
// The consumers outside haven each spell truthiness their own way — start.sh
// tests LANGWATCH_SKIP_* against "1" and START_WORKERS against "true" or "1",
// start.ts tests WORKERS_IN_PROCESS against "1" or "true" — so matching any one
// of them exactly would let the others through. And the two directions of being
// wrong are not symmetric: refusing a value that never did anything costs one
// line deleted from a .env, while missing one means haven silently runs a
// service the developer believes they turned off, which is the failure this
// whole mechanism exists to prevent. So both predicates read generously.
func isTrue(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// isFalse is "set to something, and that something is not true" — so "0",
// "false", "FALSE" and "off" all count, as does any value the app would not
// read as on. An empty value does not: blanking a line is how a .env unsets a
// knob, and there is no intent left in it to refuse.
func isFalse(v string) bool {
	return strings.TrimSpace(v) != "" && !isTrue(v)
}

// rejectRemovedSelectionEnv fails `up` when a removed selection variable is still
// set to the value that used to matter, naming the one command that replaces it.
// The replacement is sticky, so this is a one-time fix per worktree.
func rejectRemovedSelectionEnv() error {
	for _, knob := range removedSelectionEnv {
		v, ok := dotenvLookup(knob.name)
		if !ok || !knob.applied(v) {
			continue
		}
		if knob.replacement == "" {
			return fmt.Errorf("%s=%s no longer does anything — %s", knob.name, v, knob.note)
		}
		return fmt.Errorf(
			"%s=%s no longer selects services — the choice is sticky per worktree now: run `%s` once",
			knob.name, v, knob.replacement,
		)
	}
	return nil
}

// resolveAgent turns agent mode on for AI drivers: explicit env, NO_COLOR, or a
// non-terminal stdout — unless FORCE_COLOR asks us to keep color under a pipe.
func resolveAgent() bool {
	if os.Getenv("HAVEN_AGENT") == "1" {
		return true
	}
	if os.Getenv("NO_COLOR") != "" {
		return true
	}
	if os.Getenv("FORCE_COLOR") != "" {
		return false
	}
	fi, err := os.Stdout.Stat()
	return err != nil || fi.Mode()&os.ModeCharDevice == 0
}

func havenHome() string {
	if v := devEnv("LANGWATCH_PORTLESS_HOME"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".langwatch", "portless")
}

// selfArgv builds how to re-invoke haven for the daemon: the installed/built
// binary directly, or `go run <repoRoot>/cmd/haven` under the ephemeral `go run`
// binary.
//
// repoRoot must be the TRUSTED checkout haven's own source is read from, never
// the directory the child will run in. `haven play` and `haven pr` deliberately
// set a child's cwd to an unreviewed PR checkout, and a relative "./cmd/haven"
// resolves against that cwd — which would compile and run the PR's own copy of
// the orchestrator, with the docker socket, the overlay writer and teardown, and
// before any install-time guard could matter.
func selfArgv(repoRoot, subcommand string) []string {
	exe, err := os.Executable()
	if err == nil && !strings.Contains(exe, "go-build") && !strings.HasPrefix(exe, os.TempDir()) {
		return []string{exe, subcommand}
	}
	return []string{"go", "run", goRunPackage(repoRoot), subcommand}
}

// goRunPackage resolves haven's own package against the trusted repo root. It
// must never return a relative path when a root is known: `go run` resolves a
// relative package against the child's working directory, and both `haven play`
// and `haven pr` set that to an unreviewed PR checkout containing its own
// cmd/haven.
func goRunPackage(repoRoot string) string {
	if repoRoot == "" {
		return "./cmd/haven"
	}
	return filepath.Join(repoRoot, "cmd", "haven")
}

// trustedRepoRoot answers "whose haven source may this process re-invoke".
//
// It is not derived from cwd on a re-invoked process: `haven play` and `haven pr`
// point a child's cwd at an unreviewed PR checkout, so cwd there is exactly the
// thing that must not be trusted. The parent hands the root down explicitly
// through the process environment (never through .env — that file lives in the
// checkout being sandboxed); only a first invocation falls back to cwd.
func trustedRepoRoot() string {
	if v := os.Getenv("HAVEN_TRUSTED_REPO_ROOT"); v != "" {
		return v
	}
	cwd, _ := os.Getwd()
	return gitTopLevel(cwd)
}

// childEnvWithTrustedRoot is the environment for a haven child that will run with
// its cwd inside an untrusted checkout, carrying the trusted root forward so the
// child (and the daemon it may spawn) keeps resolving haven's source from it.
func childEnvWithTrustedRoot(repoRoot string) []string {
	return append(os.Environ(), "HAVEN_TRUSTED_REPO_ROOT="+repoRoot)
}

func gitTopLevel(dir string) string {
	out, err := exec.Command("git", "-C", dir, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return dir
	}
	return strings.TrimSpace(string(out))
}

func gitBranch(dir string) string {
	out, err := exec.Command("git", "-C", dir, "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}

// gitIsLinkedWorktree reports whether dir is a linked git worktree (created by
// `git worktree add`) rather than the primary checkout. Git points a linked
// worktree's --git-dir at .git/worktrees/<name> while --git-common-dir stays the
// shared .git, so the two diverge only for linked worktrees.
func gitIsLinkedWorktree(dir string) bool {
	gitDir, err1 := exec.Command("git", "-C", dir, "rev-parse", "--git-dir").Output()
	commonDir, err2 := exec.Command("git", "-C", dir, "rev-parse", "--git-common-dir").Output()
	if err1 != nil || err2 != nil {
		return false
	}
	abs := func(p string) string {
		p = strings.TrimSpace(p)
		if !filepath.IsAbs(p) {
			p = filepath.Join(dir, p)
		}
		if c, err := filepath.Abs(p); err == nil {
			return c
		}
		return p
	}
	return abs(string(gitDir)) != abs(string(commonDir))
}

// runHavenUpIn re-invokes haven's own `up` with cwd set to a PR worktree, so the
// whole provision/supervise pipeline runs there (haven derives everything from
// cwd). Foreground: it blocks supervising the stack until the user stops it,
// inheriting stdio so the stack banner + logs stream through.
func runHavenUpIn(ctx context.Context, dir string, untrustedCheckout bool) error {
	// dir is a PR worktree, which for a fork PR is unreviewed code: haven's own
	// source must still come from the trusted checkout, and the child must carry
	// that root forward rather than re-deriving it from its cwd.
	root := trustedRepoRoot()
	argv := selfArgv(root, "up")
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.Env = childEnvWithTrustedRoot(root)
	if untrustedCheckout {
		cmd.Env = append(cmd.Env, "HAVEN_UNTRUSTED_CHECKOUT=1")
	}
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	// On Ctrl-C (ctx cancel), ask `haven up` to shut down gracefully with SIGTERM
	// instead of exec's default SIGKILL, so its stack deregistration/cleanup runs.
	// WaitDelay bounds that grace so a wedged child can't hang the shell forever.
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	cmd.WaitDelay = 10 * time.Second
	return cmd.Run()
}

// runSwitch resolves a worktree by name and prints its directory. A process
// cannot change its parent shell's cwd, so the actual cd happens in the shell
// function `haven shell-init` emits — this command just answers "where".
func runSwitch(d deps, inv invocation) error {
	if inv.has("--list") {
		for _, t := range d.orch.SwitchTargets(d.worktree) {
			fmt.Println(t.Name)
		}
		return nil
	}
	query := ""
	if len(inv.args) > 0 {
		query = inv.args[0]
	}
	if query == "" {
		fmt.Println("Switchable worktrees (● = up):")
		for _, t := range d.orch.SwitchTargets(d.worktree) {
			mark := " "
			if t.IsUp {
				mark = "●"
			}
			fmt.Printf("  %s %-28s %s\n", mark, t.Name, t.Dir)
		}
		fmt.Println("\nTo make `haven switch <name>` cd your shell, add to ~/.zshrc:")
		fmt.Println(`  eval "$(haven shell-init)"`)
		return nil
	}
	dir, err := d.orch.ResolveSwitch(d.worktree, query)
	if err != nil {
		return err
	}
	fmt.Println(dir)
	return nil
}

// shellInitScript is what `eval "$(haven shell-init)"` installs: a haven()
// wrapper that turns `haven switch <name>` into a real cd, plus zsh completion
// of the worktree names.
const shellInitScript = `haven() {
  case "$1" in
    switch)
      shift
      if [ $# -eq 0 ]; then command haven switch; return; fi
      local dir
      dir="$(command haven switch "$@")" || return
      cd "$dir"
      ;;
    *) command haven "$@" ;;
  esac
}
if [ -n "$ZSH_VERSION" ]; then
  _haven_complete() {
    if [ "${words[2]}" = "switch" ]; then
      local -a targets
      targets=(${(f)"$(command haven switch --list 2>/dev/null)"})
      compadd -a targets
    fi
  }
  compdef _haven_complete haven
fi
`

// stackLogPath is where a detached `haven up -d` streams its output.
func stackLogPath(slug string) string {
	return filepath.Join(havenHome(), "logs", slug+".log")
}

// detachedStack describes a stack startDetachedUp just backgrounded.
type detachedStack struct {
	slug    string
	pid     int
	logPath string
}

// startDetachedUp backgrounds `haven up`: it re-invokes haven's own up in a new
// session with stdout/stderr streaming to the per-slug combined log file, then
// returns immediately. The child owns provisioning + supervision; its process
// group survives this terminal, so only `haven down` stops it.
func startDetachedUp(d deps, rest []string) (detachedStack, error) {
	slug, err := d.orch.ResolveSlug(d.params)
	if err != nil {
		return detachedStack{}, err
	}
	logPath := stackLogPath(slug)
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return detachedStack{}, err
	}
	root := trustedRepoRoot()
	argv := detachedUpArgv(root, rest)
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = d.worktree
	cmd.Env = childEnvWithTrustedRoot(root)
	// Owner-only: the detached log captures seed output, which includes the
	// admin password and access tokens.
	f, ferr := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if ferr != nil {
		return detachedStack{}, fmt.Errorf("opening log file %s: %w", logPath, ferr)
	}
	// Chmod too — the mode above only applies on create, and older runs
	// created this file 0644.
	if err := f.Chmod(0o600); err != nil {
		_ = f.Close()
		return detachedStack{}, fmt.Errorf("securing log file %s: %w", logPath, err)
	}
	cmd.Stdout, cmd.Stderr = f, f
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		_ = f.Close()
		return detachedStack{}, err
	}
	_ = f.Close()
	go func() { _ = cmd.Wait() }() // reap if it exits while we're still around
	return detachedStack{slug: slug, pid: cmd.Process.Pid, logPath: logPath}, nil
}

// detachedUpArgv builds the argv of the backgrounded `haven up`. The detach
// flags are dropped: the child IS the detached run, and passing them on would
// have it background itself again, forever.
//
// Everything else is carried through untouched, which is what makes `haven up`
// and `haven up -d` the same stack: both run this identical child, so it writes
// the same per-service captures, and `haven logs` cannot tell them apart.
func detachedUpArgv(repoRoot string, rest []string) []string {
	argv := selfArgv(repoRoot, "up")
	for _, a := range rest {
		if a != "-d" && a != "--detach" {
			argv = append(argv, a)
		}
	}
	return argv
}

// runUpDetached is `haven up -d`: background the stack and return.
func runUpDetached(d deps, rest []string) error {
	st, err := startDetachedUp(d, rest)
	if err != nil {
		return err
	}
	fmt.Printf("stack %q starting detached (pid %d)\n", st.slug, st.pid)
	fmt.Printf("  logs:   haven logs -t    (%s)\n", st.logPath)
	fmt.Printf("  stop:   haven down\n")
	return nil
}

// runUpAttached is `haven up` in a human's terminal: the stack still runs in
// the background (same detached launcher as -d), and this process merely
// attaches the interactive log view on top — so closing the view, or the
// terminal, never takes the stack down. `haven down` is what stops it.
func runUpAttached(ctx context.Context, d deps, rest []string) error {
	st, err := startDetachedUp(d, rest)
	if err != nil {
		return err
	}
	if err := runUpViewer(ctx, st.slug, preferredGroup(rest), d.sessionActions(st.slug)); err != nil {
		return err
	}
	fmt.Printf("detached — stack %q keeps running in the background\n", st.slug)
	fmt.Printf("  logs:   haven logs -t   ·   attach again: haven up   ·   stop: haven down\n")
	return nil
}

// preferredGroup picks the log group `up` should open on: the service the last
// `+svc` delta just added — you asked for it, you want to watch it come up.
func preferredGroup(rest []string) string {
	preferred := ""
	for _, a := range rest {
		if len(a) > 1 && a[0] == '+' {
			preferred = a[1:]
		}
	}
	return preferred
}

// stdoutIsTTY reports whether a human terminal is on the other end — what
// decides between the attached log view and plain foreground streaming.
func stdoutIsTTY() bool {
	fi, err := os.Stdout.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

// upRunsAttached decides how `haven up` presents itself. A human terminal gets
// the background stack plus the attached log view on top, so quitting the view
// detaches and leaves the stack running.
//
// A pipe (`pnpm dev:haven | tee`) or an agent gets neither: the alt-screen
// viewer would render escape codes into the pipe, so up streams plainly in the
// foreground instead — and because that path never backgrounds the launcher,
// the stack is this process's own children and Ctrl-C takes it down with them.
func upRunsAttached(isAgent, isTTY bool) bool { return !isAgent && isTTY }

// prWorktreeBase is where `haven pr` puts new PR worktrees: HAVEN_WORKTREE_DIR if
// set, else the sibling `worktrees/` dir next to the main checkout (matching the
// existing layout, e.g. .../langwatch/worktrees).
func prWorktreeBase(dir string) string {
	if v := devEnv("HAVEN_WORKTREE_DIR"); v != "" {
		return v
	}
	return filepath.Join(filepath.Dir(gitMainWorktree(dir)), "worktrees")
}

// gitMainWorktree returns the repo's primary checkout (the first entry of `git
// worktree list`), which is the anchor the sibling worktrees/ dir hangs off —
// stable no matter which linked worktree haven pr was invoked from.
func gitMainWorktree(dir string) string {
	out, err := exec.Command("git", "-C", dir, "worktree", "list", "--porcelain").Output()
	if err != nil {
		return gitTopLevel(dir)
	}
	for _, line := range strings.Split(string(out), "\n") {
		if rest, ok := strings.CutPrefix(line, "worktree "); ok {
			return strings.TrimSpace(rest)
		}
	}
	return gitTopLevel(dir)
}

func stripFlag(args []string, flag string) ([]string, bool) {
	var out []string
	found := false
	for _, a := range args {
		if a == flag {
			found = true
			continue
		}
		out = append(out, a)
	}
	return out, found
}

// runUpgrade reinstalls the haven binary from this checkout via go install.
func runUpgrade(ctx context.Context, d deps, _ invocation) error {
	cmd := exec.CommandContext(ctx, "go", "install", "./cmd/haven")
	cmd.Dir = d.worktree
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("install updated haven: %w", err)
	}
	fmt.Println("haven binary updated; restart the active launcher to load it (haven restart)")
	return nil
}

// devEnv reads one of haven's own knobs: the process environment first, then
// the merged dotenv layers (langwatch/.env, then langwatch/.env.portless).
//
// The same precedence Prisma and tsx give the app's settings, and for the same
// reason: a preference like "never manage ClickHouse, this machine runs a
// native one" belongs next to the CLICKHOUSE_URL it goes with, travels into
// every new worktree with the .env the checkout hook copies, and is still
// overridable by exporting the variable for a single run.
//
// Deliberately not used for the switches that describe one run rather than one
// machine: LANGWATCH_SLUG, HAVEN_BASELINE, LANGWATCH_SEED, HAVEN_SEED_TRACES,
// HAVEN_STUB, HAVEN_AGENT, NO_COLOR, FORCE_COLOR. Every worktree inherits the
// same .env, so a slug or a baseline marker pinned there would claim all of
// them at once, and a seed flag would re-seed on every up. Keep this list and
// the ENVIRONMENT section of help.go in step.
func devEnv(key string) string {
	v, _ := resolveKnob(key, os.LookupEnv, dotenvKnobs)
	return v
}

// dotenvLookup is devEnv's two-value form, for knobs that distinguish "set to
// empty" from "not set at all".
func dotenvLookup(key string) (string, bool) {
	return resolveKnob(key, os.LookupEnv, dotenvKnobs)
}

// resolveKnob is the precedence itself, kept pure so it can be tested without a
// checkout on disk. dotenv is a thunk so the file is never read when the
// process environment already answers.
func resolveKnob(
	key string,
	lookup func(string) (string, bool),
	dotenv func() map[string]string,
) (string, bool) {
	if v, ok := lookup(key); ok {
		return v, true
	}
	v, ok := dotenv()[key]
	return v, ok
}

// dotenvKnobs loads the dotenv layers once per process, from the langwatch/
// directory of the checkout haven was invoked in.
func dotenvKnobs() map[string]string {
	dotenvOnce.Do(func() {
		cwd, _ := os.Getwd()
		dotenvVars = domain.LoadDotenv(filepath.Join(gitTopLevel(cwd), "langwatch"))
	})
	return dotenvVars
}

var (
	dotenvOnce sync.Once
	dotenvVars map[string]string
)

// envTruthy reports whether an env var is set to a common "on" value. Accepts the
// two spellings haven's flags already use across the codebase ("1" / "true").
func envTruthy(key string) bool {
	v := devEnv(key)
	return v == "1" || v == "true"
}

func envOr(key, def string) string {
	if v := devEnv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := devEnv(key); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := devEnv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
