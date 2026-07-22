package cmd

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/dashboard"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/procsupervisor"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// The CLI constitution (ADR-064): one name per command (no aliases, ever), one
// meaning per flag across the whole surface, and flags a command does not
// declare are errors, not silently ignored. The table below is the entire
// surface; dispatch, parsing, and the COMMANDS section of help are all derived
// from it, so a command cannot exist without being visible and a flag cannot
// be accepted without being declared. cmd/table_test.go pins the rules.

// flagSpec declares one flag a command accepts.
type flagSpec struct {
	long       string // "--follow"
	short      string // "-f" or "" — a short means ONE thing across the CLI
	takesValue bool
	value      string // help placeholder for the value, e.g. "<dur>"
	summary    string
}

// commandSpec is one entry of the CLI surface.
type commandSpec struct {
	name    string
	summary string     // one line, shown in help's COMMANDS section
	flags   []flagSpec // the only flags this command accepts
	args    string     // help placeholder for positionals ("" = none)
	maxArgs int        // 0 = no positionals, -1 = unlimited
	// minusArgs treats an argument starting with "-" that matches no declared
	// flag as a positional instead of an error — how `up` reads service deltas
	// like "-nlp" once selection lands.
	minusArgs bool
	hidden    bool // internal (daemon): dispatchable, absent from help
	run       func(ctx context.Context, d deps, inv invocation) error
}

// invocation is a parsed command line: declared flags and positionals. raw is
// the untouched argument list for the transitional commands whose subcommand
// parsing still lives in the app layer.
type invocation struct {
	flags map[string]string
	args  []string
	raw   []string
}

func (inv invocation) has(long string) bool     { _, ok := inv.flags[long]; return ok }
func (inv invocation) value(long string) string { return inv.flags[long] }

// parse validates rest against the spec: every flag must be declared, a value
// flag must carry a value, and positionals must be allowed.
func parse(spec commandSpec, rest []string) (invocation, error) {
	inv := invocation{flags: map[string]string{}, raw: rest}
	findLong := func(name string) *flagSpec {
		for i := range spec.flags {
			if spec.flags[i].long == name {
				return &spec.flags[i]
			}
		}
		return nil
	}
	findShort := func(name string) *flagSpec {
		for i := range spec.flags {
			if spec.flags[i].short == name {
				return &spec.flags[i]
			}
		}
		return nil
	}
	addPositional := func(a string) error {
		if spec.maxArgs == 0 {
			return fmt.Errorf("haven %s takes no arguments (got %q)%s", spec.name, a, flagHint(spec))
		}
		if spec.maxArgs > 0 && len(inv.args) >= spec.maxArgs {
			return fmt.Errorf("haven %s takes at most %d argument(s) (got extra %q)", spec.name, spec.maxArgs, a)
		}
		inv.args = append(inv.args, a)
		return nil
	}
	for i := 0; i < len(rest); i++ {
		a := rest[i]
		switch {
		case strings.HasPrefix(a, "--"):
			name, embedded, hasEmbedded := strings.Cut(a, "=")
			f := findLong(name)
			if f == nil {
				return inv, fmt.Errorf("haven %s: unknown flag %q%s", spec.name, name, flagHint(spec))
			}
			if hasEmbedded {
				if !f.takesValue {
					return inv, fmt.Errorf("haven %s: %s takes no value", spec.name, f.long)
				}
				inv.flags[f.long] = embedded
				continue
			}
			if f.takesValue {
				if i+1 >= len(rest) {
					return inv, fmt.Errorf("haven %s: %s needs a value %s", spec.name, f.long, f.value)
				}
				i++
				inv.flags[f.long] = rest[i]
				continue
			}
			inv.flags[f.long] = ""
		case strings.HasPrefix(a, "-") && len(a) > 1:
			if f := findShort(a); f != nil {
				if f.takesValue {
					if i+1 >= len(rest) {
						return inv, fmt.Errorf("haven %s: %s needs a value %s", spec.name, f.long, f.value)
					}
					i++
					inv.flags[f.long] = rest[i]
					continue
				}
				inv.flags[f.long] = ""
				continue
			}
			if spec.minusArgs {
				if err := addPositional(a); err != nil {
					return inv, err
				}
				continue
			}
			return inv, fmt.Errorf("haven %s: unknown flag %q%s", spec.name, a, flagHint(spec))
		default:
			if err := addPositional(a); err != nil {
				return inv, err
			}
		}
	}
	return inv, nil
}

func flagHint(spec commandSpec) string {
	if len(spec.flags) == 0 {
		return ""
	}
	names := make([]string, 0, len(spec.flags))
	for _, f := range spec.flags {
		if f.short != "" {
			names = append(names, f.short+"/"+f.long)
			continue
		}
		names = append(names, f.long)
	}
	return " — flags: " + strings.Join(names, ", ")
}

// removed maps every retired spelling to what replaced it. A removed spelling
// fails with a one-line pointer; it never keeps working silently (ADR-064:
// clean break, no compatibility layer).
var removed = map[string]string{
	"ls":     "haven list",
	"status": "haven list",
	"ps":     "haven",
	"active": "haven",
	"rs":     "haven restart",
	"sw":     "haven switch",
	"cd":     "haven switch",
	"ch":     "haven clickhouse",
	"pg":     "haven postgres",
	"obs":    "haven observability",
	"tc":     "haven typecheck",
	"oc":     "haven cleanup",
	"moron":  "haven git",
}

// table is the whole CLI surface, in help order.
var table = []commandSpec{
	{
		name:    "up",
		summary: "start + supervise this worktree's stack (hostnames, DBs, services)",
		flags: []flagSpec{
			{long: "--watch", short: "-w", summary: "air hot-reload for the Go services"},
			{long: "--detach", short: "-d", summary: "run in the background; follow with haven logs -f"},
			{long: "--force", summary: "replace an already-running stack"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			if inv.has("--watch") {
				d.opts.ShouldGoWatch = true
			}
			d.opts.ShouldForce = inv.has("--force")
			if d.opts.IsStub {
				return d.orch.UpStub(ctx, d.params, dashboard.StartEcho)
			}
			if inv.has("--detach") {
				return runUpDetached(d, inv.raw)
			}
			return d.orch.Up(ctx, d.params, d.opts)
		},
	},
	{
		name:    "down",
		summary: "stop this worktree's stack; databases are kept",
		flags: []flagSpec{
			{long: "--drop-db", summary: "also drop this stack's databases (fresh DB next up)"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			return d.orch.Down(ctx, d.params, inv.has("--drop-db"))
		},
	},
	{
		name:    "restart",
		summary: "bounce one supervised service (or all) without tearing the stack down",
		args:    "[service]",
		maxArgs: 1,
		run: func(ctx context.Context, d deps, inv invocation) error {
			name := ""
			if len(inv.args) > 0 {
				name = inv.args[0]
			}
			return d.orch.Restart(ctx, d.params, name)
		},
	},
	{
		name:    "logs",
		summary: "print a detached stack's log file",
		flags: []flagSpec{
			{long: "--follow", short: "-f", summary: "stream live"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			return runLogs(ctx, d, inv.has("--follow"))
		},
	},
	{
		name:    "list",
		summary: "every running stack: slug, branch, worktree, hostnames",
		flags: []flagSpec{
			{long: "--json", summary: "machine-readable"},
		},
		run: func(_ context.Context, d deps, inv invocation) error {
			return d.orch.List(d.isAgent || inv.has("--json"))
		},
	},
	{
		name:    "doctor",
		summary: "proxy / daemon / observability / stack health + memory footprints",
		run:     func(_ context.Context, d deps, _ invocation) error { return d.orch.Doctor() },
	},
	{
		name:    "seed",
		summary: "reseed this stack's database (refuses non-local database URLs)",
		flags: []flagSpec{
			{long: "--preset", takesValue: true, value: "<name>", summary: "seed variant (demo)"},
			{long: "--traces", summary: "ingest the sample traces"},
			{long: "--first-message", summary: "mark the project as past its first trace"},
			{long: "--no-first-message", summary: "clear the first-trace flag"},
			{long: "--skip-model-providers", summary: "do not seed env-derived model providers"},
			{long: "--skip-feature-flags", summary: "do not enable the dev feature set"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			if err := guardSeedEnv(d.lwDir); err != nil {
				return err
			}
			if inv.has("--first-message") && inv.has("--no-first-message") {
				return fmt.Errorf("--first-message and --no-first-message are mutually exclusive — pass one or the other")
			}
			if inv.has("--preset") && inv.value("--preset") == "" {
				return fmt.Errorf("--preset needs a value — available: %s", strings.Join(app.SeedPresets, ", "))
			}
			return d.orch.Seed(ctx, d.params, app.SeedOptions{
				Preset:             inv.value("--preset"),
				ShouldIngestTraces: inv.has("--traces") || os.Getenv("HAVEN_SEED_TRACES") == "1",
				ExtraEnv:           seedExtraEnv(inv),
			})
		},
	},
	{
		name:    "pr",
		summary: "try a GitHub PR locally: worktree, install, stack up on a hostname",
		args:    "<ref>",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--dry-run", summary: "resolve + print the plan, create nothing"},
			{long: "--no-install", summary: "skip dependency install"},
			{long: "--allow-closed", summary: "allow a non-open PR"},
			{long: "--allow-scripts", summary: "run install lifecycle scripts for a fork"},
			{long: "--discard-local-changes", summary: "overwrite local edits instead of stashing"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			ref := ""
			if len(inv.args) > 0 {
				ref = inv.args[0]
			}
			return app.TryPR(ctx, app.TryPRParams{
				Ref:                 ref,
				RepoRoot:            d.worktree,
				WorktreeBase:        prWorktreeBase(d.worktree),
				NoInstall:           inv.has("--no-install"),
				Force:               inv.has("--allow-closed"),
				DryRun:              inv.has("--dry-run"),
				AllowScripts:        inv.has("--allow-scripts"),
				DiscardLocalChanges: inv.has("--discard-local-changes"),
			}, runHavenUpIn)
		},
	},
	{
		name:    "git",
		summary: "embedded git TUI for a worktree (slug, name, or path)",
		args:    "[target]",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--json", summary: "machine-readable per-worktree overview"},
		},
		run: runGitUI,
	},
	{
		name:    "switch",
		summary: "print a worktree's dir by name (a real cd with haven shell-init)",
		args:    "[name]",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--list", summary: "names only, for shell completion"},
		},
		run: func(_ context.Context, d deps, inv invocation) error { return runSwitch(d, inv) },
	},
	{
		name:    "shell-init",
		summary: "emit the shell function + completion for haven switch",
		run: func(_ context.Context, _ deps, _ invocation) error {
			fmt.Print(shellInitScript)
			return nil
		},
	},
	{
		name:    "watch",
		summary: "passive live view of every running stack",
		run:     func(ctx context.Context, d deps, _ invocation) error { return d.orch.Watch(ctx) },
	},
	{
		name:    "setup",
		summary: "one-time machine bootstrap: portless proxy + trusted CA",
		run:     func(ctx context.Context, d deps, _ invocation) error { return d.orch.Setup(ctx) },
	},
	{
		name:    "clickhouse",
		summary: "the shared managed ClickHouse: status | up | url | stop | drop [--all]",
		args:    "[subcommand]",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--all", summary: "drop every lw_* database (lw_main is kept)"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			return d.orch.RunClickHouse(ctx, d.params, inv.raw)
		},
	},
	{
		name:    "postgres",
		summary: "the shared managed Postgres: status | up | url | drop [--all]",
		args:    "[subcommand]",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--all", summary: "drop every lw_* database (lw_main is kept)"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			return d.orch.RunPostgres(ctx, d.params, inv.raw)
		},
	},
	{
		name:    "observability",
		summary: "the shared LGTM stack: status | up | down",
		args:    "[subcommand]",
		maxArgs: 1,
		run: func(ctx context.Context, d deps, inv invocation) error {
			return d.orch.RunObservability(ctx, inv.raw)
		},
	},
	{
		name:    "hmr",
		summary: "AI-gated HMR: on [--ttl <dur>] defers Vite reloads, off resumes",
		args:    "[on|off|status]",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--ttl", takesValue: true, value: "<dur>", summary: "how long the gate holds (default 30s)"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			return d.orch.RunHMR(ctx, d.lwDir, inv.raw)
		},
	},
	{
		name:    "prune",
		summary: "interactive worktree cleanup; --artifacts is the conservative reclaim",
		flags: []flagSpec{
			{long: "--artifacts", summary: "reclaim regenerable disk only, delete no worktree"},
			{long: "--yes", summary: "apply without prompting (with --artifacts; else dry-run)"},
			{long: "--stale-days", takesValue: true, value: "<n>", summary: "idle age pre-ticked for deletion"},
		},
		run: runPrune,
	},
	{
		name:    "cleanup",
		summary: "reap orphaned dev runtimes (tsgo, node, pnpm, …) of this worktree",
		flags: []flagSpec{
			{long: "--yes", summary: "confirm — cleanup refuses without it"},
		},
		run: func(_ context.Context, d deps, inv invocation) error {
			if !inv.has("--yes") {
				return fmt.Errorf("refusing cleanup without --yes")
			}
			procsupervisor.ReapOrphans([]string{d.worktree})
			fmt.Printf("haven cleaned orphaned dev runtimes under %s\n", d.worktree)
			return nil
		},
	},
	{
		name:    "typecheck",
		summary: "pnpm typecheck under a machine-wide RAM slot (args forwarded)",
		args:    "[args…]",
		maxArgs: -1,
		run: func(ctx context.Context, d deps, inv invocation) error {
			return d.orch.Typecheck(ctx, d.lwDir, inv.raw, envInt("HAVEN_TYPECHECK_SLOTS", 0), envInt("HAVEN_TYPECHECK_MAX_RSS_MB", 0))
		},
	},
	{
		name:    "upgrade",
		summary: "reinstall the haven binary from this checkout",
		run:     runUpgrade,
	},
	{
		name:   "daemon",
		hidden: true,
		run:    func(ctx context.Context, d deps, _ invocation) error { return d.orch.RunDaemon(ctx, d.dash) },
	},
}

// tableByName is the dispatch index over table.
var tableByName = func() map[string]commandSpec {
	m := make(map[string]commandSpec, len(table))
	for _, spec := range table {
		if _, dup := m[spec.name]; dup {
			panic("duplicate haven command " + spec.name)
		}
		m[spec.name] = spec
	}
	return m
}()

func (d deps) dispatch(ctx context.Context, sub string, rest []string) error {
	if hint, gone := removed[sub]; gone {
		return fmt.Errorf("haven %s was removed — use %s", sub, hint)
	}
	spec, ok := tableByName[sub]
	if !ok {
		msg := fmt.Sprintf("haven: unknown command %q", sub)
		if close := closestCommands(sub); len(close) > 0 {
			msg += " — did you mean: " + strings.Join(close, ", ")
		}
		fmt.Fprintf(os.Stderr, "%s\nRun `haven help` for the full reference.\n", msg)
		return fmt.Errorf("unknown command %q", sub)
	}
	inv, err := parse(spec, rest)
	if err != nil {
		return err
	}
	return spec.run(ctx, d, inv)
}

// closestCommands suggests near-misses for an unknown command: prefix matches
// first, then small-edit-distance ones.
func closestCommands(input string) []string {
	var out []string
	for _, spec := range table {
		if spec.hidden {
			continue
		}
		if strings.HasPrefix(spec.name, input) || strings.HasPrefix(input, spec.name) || editDistanceAtMost(spec.name, input, 2) {
			out = append(out, spec.name)
		}
	}
	sort.Strings(out)
	if len(out) > 3 {
		out = out[:3]
	}
	return out
}

// editDistanceAtMost reports whether the Levenshtein distance between a and b
// is <= max. Sizes here are tiny (command names), so the plain DP is fine.
func editDistanceAtMost(a, b string, max int) bool {
	if diff := len(a) - len(b); diff > max || -diff > max {
		return false
	}
	prev := make([]int, len(b)+1)
	cur := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		cur[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			cur[j] = min(min(cur[j-1]+1, prev[j]+1), prev[j-1]+cost)
		}
		prev, cur = cur, prev
	}
	return prev[len(b)] <= max
}

// commandsHelp renders the COMMANDS section of help from the table, so a
// command cannot exist without being documented.
func commandsHelp() string {
	var b strings.Builder
	for _, spec := range table {
		if spec.hidden {
			continue
		}
		left := spec.name
		if spec.args != "" {
			left += " " + spec.args
		}
		b.WriteString(fmt.Sprintf("    %-14s %s\n", left, spec.summary))
		for _, f := range spec.flags {
			name := f.long
			if f.short != "" {
				name = f.short + "/" + f.long
			}
			if f.takesValue {
				name += " " + f.value
			}
			b.WriteString(fmt.Sprintf("    %-14s   %s: %s\n", "", name, f.summary))
		}
	}
	return b.String()
}
