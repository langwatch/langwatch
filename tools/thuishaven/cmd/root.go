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
	"strings"
	"syscall"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/clickhouseserver"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/dashboard"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/fileregistry"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/hygiene"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/portlessproxy"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/procsupervisor"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/semaphore"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/system"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Root wires everything and runs a subcommand. logger is the injected zap logger.
func Root(ctx context.Context, logger *zap.Logger, version string, args []string) error {
	var agentFlag bool
	args, agentFlag = stripFlag(args, "--agent")
	agent := agentFlag || resolveAgent()

	if len(args) > 0 {
		switch args[0] {
		case "help", "-h", "--help":
			fmt.Print(helpText)
			return nil
		case "version", "-v", "--version":
			fmt.Println(version)
			return nil
		}
	}

	cwd, _ := os.Getwd()
	worktree := gitTopLevel(cwd)
	lwDir := filepath.Join(worktree, "langwatch")

	naming := domain.DefaultNaming(os.Getenv("LANGWATCH_LOCAL_TLD"))
	proxy := portlessproxy.New(naming, lwDir)
	store := fileregistry.New(havenHome())
	sup := procsupervisor.New(agent)
	sys := system.New()
	ch := clickhouseserver.New(havenHome(), os.Getenv("CLICKHOUSE_BIN"), envBytes("LANGWATCH_HAVEN_CH_MAX_MEMORY", 0))
	hyg := hygiene.New()
	sem := semaphore.New(havenHome())
	sharedURL := func(svc string) string {
		scheme, port := proxy.Endpoint()
		return naming.URL(svc, "", scheme, port)
	}
	dash := dashboard.New(store.Stacks, sharedURL)

	cfg := app.Config{
		Naming:             naming,
		Home:               havenHome(),
		ObservabilityPort:  envInt("LANGWATCH_OBSERVABILITY_PORT", 3000),
		IdleTTL:            envDuration("HAVEN_IDLE_TTL", 4*time.Hour),
		HeartbeatEvery:     30 * time.Second,
		DaemonArgv:         selfArgv(worktree, "daemon"),
		Agent:              agent,
		ManageClickHouse:   os.Getenv("LANGWATCH_HAVEN_CH") != "0",
		StopClickHouseIdle: os.Getenv("LANGWATCH_HAVEN_CH_STOP_IDLE") == "1",
		LocalAPIKey:        envOr("LANGWATCH_LOCAL_API_KEY", domain.DefaultLocalAPIKey),
		RepoRoot:           worktree,
	}
	orch := app.New(cfg, proxy, store, sup, sys, ch, hyg, sem, logger)

	// SIGINT/SIGTERM cancel the context so up/daemon/watch clean up.
	ctx, stop := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Bare `haven`: the TUI in a terminal, help when driven by an agent/pipe.
	if len(args) == 0 {
		if agent {
			fmt.Print(helpText)
			return nil
		}
		return orch.Watch(ctx)
	}

	params := app.UpParams{WorktreeDir: worktree, LwDir: lwDir, Branch: gitBranch(worktree), ExplicitSlug: os.Getenv("LANGWATCH_SLUG"), Baseline: os.Getenv("HAVEN_BASELINE") == "1"}
	opts := optionsFromEnv(worktree)
	sub, rest := args[0], args[1:]
	switch sub {
	case "up":
		if opts.Stub {
			return orch.UpStub(ctx, params, dashboard.StartEcho)
		}
		return orch.Up(ctx, params, opts)
	case "watch":
		return orch.Watch(ctx)
	case "daemon":
		return orch.RunDaemon(ctx, dash)
	case "down":
		return orch.Down(ctx, params, hasFlag(rest, "--keep-db"))
	case "clickhouse", "ch":
		return orch.RunClickHouse(ctx, params, rest)
	case "prune":
		return orch.Prune(ctx, worktree, hasFlag(rest, "--yes"))
	case "typecheck", "tc":
		return orch.Typecheck(ctx, lwDir, rest, envInt("HAVEN_TYPECHECK_SLOTS", 0))
	case "seed":
		return orch.Seed(ctx, params)
	case "list", "ls", "status":
		return orch.List(agent || hasFlag(rest, "--json"))
	case "doctor":
		return orch.Doctor()
	default:
		fmt.Fprintf(os.Stderr, "haven: unknown command %q\n\n%s", sub, helpText)
		return fmt.Errorf("unknown command %q", sub)
	}
}

func optionsFromEnv(repoRoot string) app.PlanOptions {
	return app.PlanOptions{
		GoWatch:      os.Getenv("LANGWATCH_GO_WATCH") == "1",
		StartWorkers: os.Getenv("START_WORKERS") != "false" && os.Getenv("START_WORKERS") != "0",
		SkipNLP:      os.Getenv("LANGWATCH_SKIP_NLP") == "1",
		SkipGateway:  os.Getenv("LANGWATCH_SKIP_AIGATEWAY") == "1",
		Seed:         os.Getenv("LANGWATCH_SEED") == "1",
		Stub:         os.Getenv("HAVEN_STUB") == "1",
		RepoRoot:     repoRoot,
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

// envBytes parses a byte count (plain integer) from an env var; def when unset.
func envBytes(key string, def int64) int64 {
	if v := os.Getenv(key); v != "" {
		var n int64
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
