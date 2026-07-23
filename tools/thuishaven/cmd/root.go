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
	lwDir := filepath.Join(worktree, "langwatch")

	naming := domain.DefaultNaming(os.Getenv("LANGWATCH_LOCAL_TLD"))
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
	if v, ok := os.LookupEnv("LW_OBS_CONSOLE_LEVEL"); ok {
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
		DaemonArgv:               selfArgv(worktree, "daemon"),
		IsAgent:                  isAgent,
		ShouldManageClickHouse:   os.Getenv("LANGWATCH_HAVEN_CH") != "0",
		ShouldStopClickHouseIdle: os.Getenv("LANGWATCH_HAVEN_CH_STOP_IDLE") == "1",
		ShouldManagePostgres:     os.Getenv("LANGWATCH_HAVEN_PG") != "0",
		ShouldManageRedis:        os.Getenv("LANGWATCH_HAVEN_REDIS") != "0",
		// Observability shares CH's colima VM, so it defaults ON now — the VM is
		// already paying for itself. LANGWATCH_HAVEN_OBS=0 opts out.
		ShouldStartObservability:  os.Getenv("LANGWATCH_HAVEN_OBS") != "0",
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
		params:   app.UpParams{WorktreeDir: worktree, LwDir: lwDir, Branch: gitBranch(worktree), ExplicitSlug: os.Getenv("LANGWATCH_SLUG"), IsBaseline: os.Getenv("HAVEN_BASELINE") == "1", IsLinkedWorktree: gitIsLinkedWorktree(worktree)},
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
		ShouldGoWatch:      os.Getenv("LANGWATCH_GO_WATCH") == "1",
		ShouldStartWorkers: true,
		ShouldSeed:         os.Getenv("LANGWATCH_SEED") == "1",
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

// applyLegacySelectionEnv honours the pre-ADR-064 selection env vars for one
// release as one-shot, NON-sticky overrides, each printing its sticky
// replacement. The env vars are removed a release later.
func applyLegacySelectionEnv(sel domain.Selection, opts *app.PlanOptions) domain.Selection {
	warn := func(envVar, sticky string) {
		fmt.Fprintf(os.Stderr, "haven: %s is deprecated and applies to this run only — the sticky way is `%s`\n", envVar, sticky)
	}
	if os.Getenv("LANGWATCH_SKIP_NLP") == "1" {
		sel.NLP = false
		warn("LANGWATCH_SKIP_NLP=1", "haven up -nlp")
	}
	if os.Getenv("LANGWATCH_SKIP_AIGATEWAY") == "1" {
		sel.Gateway = false
		warn("LANGWATCH_SKIP_AIGATEWAY=1", "haven up -gateway")
	}
	if os.Getenv("LANGWATCH_SKIP_LANGYAGENT") == "1" {
		sel.Langy = false
		warn("LANGWATCH_SKIP_LANGYAGENT=1", "haven up -langy")
	}
	if v := os.Getenv("WORKERS_IN_PROCESS"); v == "0" || v == "false" {
		sel.Workers = true
		warn("WORKERS_IN_PROCESS=0", "haven up +workers")
	}
	if v := os.Getenv("START_WORKERS"); v == "false" || v == "0" {
		opts.ShouldStartWorkers = false
		fmt.Fprintln(os.Stderr, "haven: START_WORKERS=false is deprecated and applies to this run only (no sticky equivalent — workers are part of the app by default)")
	}
	return sel
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
	if v := os.Getenv("LANGWATCH_PORTLESS_HOME"); v != "" {
		return v
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".langwatch", "portless")
}

// selfArgv builds how to re-invoke haven for the daemon: the installed/built
// binary directly, or `go run ./cmd/haven` under the ephemeral `go run` binary.
func selfArgv(repoRoot, subcommand string) []string {
	exe, err := os.Executable()
	if err == nil && !strings.Contains(exe, "go-build") && !strings.HasPrefix(exe, os.TempDir()) {
		return []string{exe, subcommand}
	}
	return []string{"go", "run", "./cmd/haven", subcommand}
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
func runHavenUpIn(ctx context.Context, dir string) error {
	argv := selfArgv(dir, "up")
	cmd := exec.CommandContext(ctx, argv[0], argv[1:]...)
	cmd.Dir = dir
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
	argv := selfArgv(d.worktree, "up")
	for _, a := range rest {
		if a != "-d" && a != "--detach" {
			argv = append(argv, a)
		}
	}
	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = d.worktree
	cmd.Env = os.Environ()
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

// runUpDetached is `haven up -d`: background the stack and return.
func runUpDetached(d deps, rest []string) error {
	st, err := startDetachedUp(d, rest)
	if err != nil {
		return err
	}
	fmt.Printf("stack %q starting detached (pid %d)\n", st.slug, st.pid)
	fmt.Printf("  logs:   haven logs -f    (%s)\n", st.logPath)
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
	if err := runUpViewer(ctx, st.slug); err != nil {
		return err
	}
	fmt.Printf("detached — stack %q keeps running in the background\n", st.slug)
	fmt.Printf("  logs:   haven logs -f   ·   attach again: haven up   ·   stop: haven down\n")
	return nil
}

// stdoutIsTTY reports whether a human terminal is on the other end — what
// decides between the attached log view and plain foreground streaming.
func stdoutIsTTY() bool {
	fi, err := os.Stdout.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0
}

// prWorktreeBase is where `haven pr` puts new PR worktrees: HAVEN_WORKTREE_DIR if
// set, else the sibling `worktrees/` dir next to the main checkout (matching the
// existing layout, e.g. .../langwatch/worktrees).
func prWorktreeBase(dir string) string {
	if v := os.Getenv("HAVEN_WORKTREE_DIR"); v != "" {
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

// envTruthy reports whether an env var is set to a common "on" value. Accepts the
// two spellings haven's flags already use across the codebase ("1" / "true").
func envTruthy(key string) bool {
	v := os.Getenv(key)
	return v == "1" || v == "true"
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil {
			return n
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
