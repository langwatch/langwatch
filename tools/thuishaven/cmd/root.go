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

	// SIGINT/SIGTERM cancel the context so up/daemon/watch clean up.
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Bare `haven`: the interactive hub in a terminal, help when driven by an
	// agent/pipe.
	if len(args) == 0 {
		if isAgent {
			fmt.Print(helpText)
			return nil
		}
		return runHub(ctx, d, nil)
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
		orch: app.New(cfg, proxy, store, sup, sys, ch, pg, rds, obs, hyg, sem, logger),
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

// command is one entry in the dispatch table.
type command func(ctx context.Context, d deps, rest []string) error

// commands is the subcommand table. A table rather than a switch so adding a
// command is one line and dispatch itself stays branch-free.
var commands = map[string]command{
	"up": func(ctx context.Context, d deps, _ []string) error {
		if d.opts.IsStub {
			return d.orch.UpStub(ctx, d.params, dashboard.StartEcho)
		}
		return d.orch.Up(ctx, d.params, d.opts)
	},
	"pr": func(ctx context.Context, d deps, rest []string) error {
		return app.TryPR(ctx, app.TryPRParams{
			Ref:                 firstNonFlag(rest),
			RepoRoot:            d.worktree,
			WorktreeBase:        prWorktreeBase(d.worktree),
			NoInstall:           hasFlag(rest, "--no-install"),
			Force:               hasFlag(rest, "--force"),
			DryRun:              hasFlag(rest, "--dry-run"),
			AllowScripts:        hasFlag(rest, "--trusted") || hasFlag(rest, "--allow-scripts"),
			DiscardLocalChanges: hasFlag(rest, "--discard-local-changes"),
		}, runHavenUpIn)
	},
	"setup":  func(ctx context.Context, d deps, _ []string) error { return d.orch.Setup(ctx) },
	"watch":  func(ctx context.Context, d deps, _ []string) error { return d.orch.Watch(ctx) },
	"daemon": func(ctx context.Context, d deps, _ []string) error { return d.orch.RunDaemon(ctx, d.dash) },
	"down": func(ctx context.Context, d deps, rest []string) error {
		return d.orch.Down(ctx, d.params, hasFlag(rest, "--keep-db"))
	},
	"clickhouse": func(ctx context.Context, d deps, rest []string) error {
		return d.orch.RunClickHouse(ctx, d.params, rest)
	},
	"postgres": func(ctx context.Context, d deps, rest []string) error {
		return d.orch.RunPostgres(ctx, d.params, rest)
	},
	"prune": func(ctx context.Context, d deps, rest []string) error {
		return d.orch.Prune(ctx, d.worktree, hasFlag(rest, "--yes"))
	},
	"typecheck": func(ctx context.Context, d deps, rest []string) error {
		return d.orch.Typecheck(ctx, d.lwDir, rest, envInt("HAVEN_TYPECHECK_SLOTS", 0), envInt("HAVEN_TYPECHECK_MAX_RSS_MB", 0))
	},
	"observability": func(ctx context.Context, d deps, rest []string) error {
		return d.orch.RunObservability(ctx, rest)
	},
	"hmr": func(ctx context.Context, d deps, rest []string) error { return d.orch.RunHMR(ctx, d.lwDir, rest) },
	"seed": func(ctx context.Context, d deps, rest []string) error {
		if err := guardSeedEnv(d.lwDir); err != nil {
			return err
		}
		return d.orch.Seed(ctx, d.params, flagValue(rest, "--preset"))
	},
	"list": func(_ context.Context, d deps, rest []string) error {
		return d.orch.List(d.isAgent || hasFlag(rest, "--json"))
	},
	"git":    runGitUI,
	"hub":    runHub,
	"doctor": func(_ context.Context, d deps, _ []string) error { return d.orch.Doctor() },
}

// aliases are the short forms accepted for a canonical command.
var aliases = map[string]string{
	"ch":     "clickhouse",
	"pg":     "postgres",
	"obs":    "observability",
	"tc":     "typecheck",
	"ls":     "list",
	"status": "list",
	"moron":  "git",
	"ps":     "hub",
	"active": "hub",
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
	return l
}

func (d deps) dispatch(ctx context.Context, sub string, rest []string) error {
	if canonical, ok := aliases[sub]; ok {
		sub = canonical
	}
	run, ok := commands[sub]
	if !ok {
		fmt.Fprintf(os.Stderr, "haven: unknown command %q\n\n%s", sub, helpText)
		return fmt.Errorf("unknown command %q", sub)
	}
	return run(ctx, d, rest)
}

func optionsFromEnv(repoRoot string) app.PlanOptions {
	return app.PlanOptions{
		ShouldGoWatch:      os.Getenv("LANGWATCH_GO_WATCH") == "1",
		ShouldStartWorkers: os.Getenv("START_WORKERS") != "false" && os.Getenv("START_WORKERS") != "0",
		// Under haven the worker stack defaults to IN-PROCESS (hosted in the app
		// process), saving the RAM of a second Node process — the sensible default on
		// a laptop juggling several worktrees. Workers keep their own logger name
		// ("langwatch:workers"), so their lines stay identifiable even without a
		// separate lane. Opt back into a standalone `workers` lane with
		// WORKERS_IN_PROCESS=0.
		ShouldRunWorkersInProcess: os.Getenv("WORKERS_IN_PROCESS") != "0" && os.Getenv("WORKERS_IN_PROCESS") != "false",
		ShouldSkipNLP:             os.Getenv("LANGWATCH_SKIP_NLP") == "1",
		ShouldSkipGateway:         os.Getenv("LANGWATCH_SKIP_AIGATEWAY") == "1",
		ShouldSkipLangyAgent:      os.Getenv("LANGWATCH_SKIP_LANGYAGENT") == "1",
		ShouldSeed:                os.Getenv("LANGWATCH_SEED") == "1",
		IsStub:                    os.Getenv("HAVEN_STUB") == "1",
		RepoRoot:                  repoRoot,
	}
}

// resolveAgent turns agent mode on for AI drivers: explicit env, NO_COLOR, or a
// non-terminal stdout — unless FORCE_COLOR asks us to keep colour under a pipe.
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

// firstNonFlag returns the first positional arg (the PR ref), skipping -flags.
func firstNonFlag(args []string) string {
	for _, a := range args {
		if !strings.HasPrefix(a, "-") {
			return a
		}
	}
	return ""
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

// flagValue returns the value following --name (or embedded in --name=value),
// "" when the flag is absent.
func flagValue(args []string, name string) string {
	for i, a := range args {
		if a == name && i+1 < len(args) {
			return args[i+1]
		}
		if v, ok := strings.CutPrefix(a, name+"="); ok {
			return v
		}
	}
	return ""
}

func hasFlag(args []string, flag string) bool {
	for _, a := range args {
		if a == flag {
			return true
		}
	}
	return false
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
