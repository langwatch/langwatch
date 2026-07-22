package cmd

import (
	"context"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/dashboard"
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
	"ls":            "haven status",
	"list":          "haven status",
	"doctor":        "haven status",
	"watch":         "haven status (or bare `haven` for the live hub)",
	"hub":           "haven (bare)",
	"ps":            "haven",
	"active":        "haven",
	"rs":            "haven restart",
	"sw":            "haven switch",
	"cd":            "haven switch",
	"ch":            "haven db url clickhouse (the server is managed automatically)",
	"clickhouse":    "haven db url clickhouse (the server is managed automatically)",
	"pg":            "haven db url postgres (the server is managed automatically)",
	"postgres":      "haven db url postgres (the server is managed automatically)",
	"obs":           "haven status — the observability stack is managed automatically (haven restart obs bounces it)",
	"observability": "haven status — the observability stack is managed automatically (haven restart obs bounces it)",
	"seed":          "haven db reset [--demo]",
	"tc":            "haven typecheck",
	"oc":            "haven cleanup",
	"moron":         "haven git",
	"setup":         "nothing — `haven up` bootstraps the machine itself (portless install, CA trust, proxy)",
}

// table is the whole CLI surface, in help order.
var table = []commandSpec{
	{
		name:      "up",
		summary:   "start or reconcile this worktree's stack; +svc/-svc picks services and sticks",
		args:      "[+svc|-svc …]",
		maxArgs:   -1,
		minusArgs: true,
		flags: []flagSpec{
			{long: "--watch", short: "-w", summary: "air hot-reload for the Go services"},
			{long: "--detach", short: "-d", summary: "run in the background; follow with haven logs -f"},
			{long: "--rebuild", summary: "rebuild container images even when unchanged"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			sel, err := d.orch.ResolveSelection(d.worktree, inv.args)
			if err != nil {
				return err
			}
			d.opts.Selection = applyLegacySelectionEnv(sel, &d.opts)
			if inv.has("--watch") {
				d.opts.ShouldGoWatch = true
			}
			d.opts.ShouldRebuildImages = inv.has("--rebuild")
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
		summary: "stop this worktree's stack; data is always kept",
		flags: []flagSpec{
			{long: "--all", summary: "stop every stack, the shared servers, the daemon, and the proxy"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			if inv.has("--all") {
				return d.orch.DownAll(ctx)
			}
			return d.orch.Down(ctx, d.params)
		},
	},
	{
		name:    "restart",
		summary: "bounce one supervised service (or all) without tearing the stack down",
		args:    "[service]",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--rebuild", summary: "rebuild the image first (haven restart langy --rebuild)"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			name := ""
			if len(inv.args) > 0 {
				name = inv.args[0]
			}
			return d.orch.Restart(ctx, d.params, name, inv.has("--rebuild"))
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
		name:    "status",
		summary: "one-shot report: every stack, service health, shared servers, RAM",
		flags: []flagSpec{
			{long: "--json", summary: "machine-readable"},
		},
		run: func(_ context.Context, d deps, inv invocation) error {
			return d.orch.Status(d.isAgent || inv.has("--json"), d.worktree)
		},
	},
	{
		name:    "db",
		summary: "this stack's data: reset [--demo] (drop + migrate + seed) | url [engine]",
		args:    "<reset|url> [engine]",
		maxArgs: 2,
		flags: []flagSpec{
			{long: "--demo", summary: "seed the demo preset after the reset (sample traces need the stack up)"},
			{long: "--yes", summary: "confirm without prompting (required in agent mode)"},
		},
		run: runDB,
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
		name:    "clean",
		summary: "one cleanup: worktree picker, then safe reclaim (artifacts, orphan processes)",
		flags: []flagSpec{
			{long: "--yes", summary: "no picker: apply only the safe categories, never worktree deletion"},
			{long: "--stale-days", takesValue: true, value: "<n>", summary: "idle age pre-ticked for deletion"},
		},
		run: runClean,
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
