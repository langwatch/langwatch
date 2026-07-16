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

// command is one entry in the dispatch table.
type command func(ctx context.Context, d deps, rest []string) error

// commands is the subcommand table. A table rather than a switch so adding a
// command is one line and dispatch itself stays branch-free.
var commands = map[string]command{
	"up": func(ctx context.Context, d deps, rest []string) error {
		if hasFlag(rest, "-w") || hasFlag(rest, "--watch") {
			d.opts.ShouldGoWatch = true
		}
		d.opts.ShouldForce = hasFlag(rest, "-f") || hasFlag(rest, "--force")
		if d.opts.IsStub {
			return d.orch.UpStub(ctx, d.params, dashboard.StartEcho)
		}
		if hasFlag(rest, "-d") || hasFlag(rest, "--detach") {
			return runUpDetached(d, rest)
		}
		return d.orch.Up(ctx, d.params, d.opts)
	},
	"restart": func(ctx context.Context, d deps, rest []string) error {
		return d.orch.Restart(ctx, d.params, firstNonFlag(rest))
	},
	"logs": func(ctx context.Context, d deps, rest []string) error {
		return runLogs(ctx, d, hasFlag(rest, "-f") || hasFlag(rest, "--follow"))
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
		// Databases are kept by default; --drop-db is the explicit fresh-DB ask.
		// --keep-db (the old flag) is accepted as a no-op — it now IS the default.
		return d.orch.Down(ctx, d.params, hasFlag(rest, "--drop-db"))
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
	"cleanup": func(ctx context.Context, d deps, rest []string) error {
		if !hasFlag(rest, "--force") {
			return fmt.Errorf("refusing cleanup without --force")
		}
		procsupervisor.ReapOrphans([]string{d.worktree})
		fmt.Printf("haven cleaned orphaned dev runtimes under %s\n", d.worktree)
		return nil
	},
	"upgrade": func(ctx context.Context, d deps, _ []string) error {
		cmd := exec.CommandContext(ctx, "go", "install", "./cmd/haven")
		cmd.Dir = d.worktree
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("install updated haven: %w", err)
		}
		fmt.Println("haven binary updated; restart the active launcher to load it (haven restart)")
		return nil
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
		preset, err := seedPresetArg(rest)
		if err != nil {
			return err
		}
		if hasFlag(rest, "--first-message") && hasFlag(rest, "--no-first-message") {
			return fmt.Errorf("--first-message and --no-first-message are mutually exclusive — pass one or the other")
		}
		return d.orch.Seed(ctx, d.params, app.SeedOptions{
			Preset:             preset,
			ShouldIngestTraces: hasFlag(rest, "--traces") || os.Getenv("HAVEN_SEED_TRACES") == "1",
			ExtraEnv:           seedExtraEnv(rest),
		})
	},
	"list": func(_ context.Context, d deps, rest []string) error {
		return d.orch.List(d.isAgent || hasFlag(rest, "--json"))
	},
	"switch": func(_ context.Context, d deps, rest []string) error {
		return runSwitch(d, rest)
	},
	"shell-init": func(_ context.Context, _ deps, _ []string) error {
		fmt.Print(shellInitScript)
		return nil
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
	"rs":     "restart",
	"sw":     "switch",
	"ps":     "hub",
	"active": "hub",
	"oc":     "cleanup",
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

// runSwitch resolves a worktree by name and prints its directory. A process
// cannot change its parent shell's cwd, so the actual cd happens in the shell
// function `haven shell-init` emits — this command just answers "where".
func runSwitch(d deps, rest []string) error {
	if hasFlag(rest, "--list") {
		for _, t := range d.orch.SwitchTargets(d.worktree) {
			fmt.Println(t.Name)
		}
		return nil
	}
	query := firstNonFlag(rest)
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
    switch|sw|cd)
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
    if [ "${words[2]}" = "switch" ] || [ "${words[2]}" = "sw" ] || [ "${words[2]}" = "cd" ]; then
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

// runUpDetached backgrounds `haven up`: it re-invokes haven's own up in a new
// session with stdout/stderr streaming to a per-slug log file, then returns
// immediately. Follow with `haven logs -f`; stop with `haven down`.
func runUpDetached(d deps, rest []string) error {
	slug, err := d.orch.ResolveSlug(d.params)
	if err != nil {
		return err
	}
	logPath := stackLogPath(slug)
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return err
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
		return fmt.Errorf("opening log file %s: %w", logPath, ferr)
	}
	// Chmod too — the mode above only applies on create, and older runs
	// created this file 0644.
	if err := f.Chmod(0o600); err != nil {
		_ = f.Close()
		return fmt.Errorf("securing log file %s: %w", logPath, err)
	}
	cmd.Stdout, cmd.Stderr = f, f
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		_ = f.Close()
		return err
	}
	_ = f.Close()
	go func() { _ = cmd.Wait() }() // reap if it exits while we're still around
	fmt.Printf("stack %q starting detached (pid %d)\n", slug, cmd.Process.Pid)
	fmt.Printf("  logs:   haven logs -f    (%s)\n", logPath)
	fmt.Printf("  stop:   haven down\n")
	return nil
}

// runLogs prints (or follows, with -f) the detached stack's log file via tail.
func runLogs(ctx context.Context, d deps, shouldFollow bool) error {
	slug, err := d.orch.ResolveSlug(d.params)
	if err != nil {
		return err
	}
	logPath := stackLogPath(slug)
	if _, err := os.Stat(logPath); err != nil {
		return fmt.Errorf("no log file for stack %q (%s) — logs are captured when the stack is started with `haven up -d`", slug, logPath)
	}
	args := []string{"-n", "200"}
	if shouldFollow {
		args = append(args, "-f")
	}
	cmd := exec.CommandContext(ctx, "tail", append(args, logPath)...)
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
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

// seedExtraEnv maps `haven seed`'s extra flags to the HAVEN_SEED_* switches
// the seed script reads. Only explicit flags are emitted — env vars the user
// already exported flow through the child's inherited environment untouched.
func seedExtraEnv(rest []string) []string {
	var env []string
	if hasFlag(rest, "--first-message") {
		env = append(env, "HAVEN_SEED_FIRST_MESSAGE=1")
	}
	if hasFlag(rest, "--no-first-message") {
		env = append(env, "HAVEN_SEED_FIRST_MESSAGE=0")
	}
	if hasFlag(rest, "--skip-model-providers") {
		env = append(env, "HAVEN_SEED_MODEL_PROVIDERS=0")
	}
	if hasFlag(rest, "--skip-feature-flags") {
		env = append(env, "HAVEN_SEED_FEATURE_FLAGS=0")
	}
	return env
}

// seedPresetArg extracts --preset for `haven seed`, rejecting the two silent
// footguns: a trailing --preset with no value, and a positional arg (`haven
// seed demo`) that flagValue would ignore — both would otherwise run the plain
// default seed and exit successfully.
func seedPresetArg(rest []string) (string, error) {
	preset := flagValue(rest, "--preset")
	if hasFlag(rest, "--preset") && preset == "" {
		return "", fmt.Errorf("--preset needs a value — available: %s", strings.Join(app.SeedPresets, ", "))
	}
	for i := 0; i < len(rest); i++ {
		if rest[i] == "--preset" {
			i++ // skip the flag's value
			continue
		}
		if !strings.HasPrefix(rest[i], "-") {
			return "", fmt.Errorf("unexpected argument %q — presets are passed as --preset <name>; available: %s", rest[i], strings.Join(app.SeedPresets, ", "))
		}
	}
	return preset, nil
}

func hasFlag(args []string, flag string) bool {
	for _, a := range args {
		if a == flag {
			return true
		}
	}
	return false
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
