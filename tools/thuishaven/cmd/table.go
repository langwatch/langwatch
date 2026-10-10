package cmd

import (
	"context"
	"fmt"
	"os"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/dashboard"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
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
	isSwitch   bool   // bare means on; "--flag=false" turns it off (a default-on switch)
	value      string // help placeholder for the value, e.g. "<dur>"
	summary    string
	hidden     bool // internal (pr's --launch): accepted, absent from help
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
	// subs makes this a group (`haven sim mail list`): a first argument naming
	// a sub runs it, anything else runs this spec's own run, if it has one.
	subs []commandSpec
	// rewrite turns the public argv into the one run parses, refusing a
	// retired spelling first (the simulators' verbs, logs -t).
	rewrite func(rest []string) ([]string, error)
	// fields marks a read whose --json output is an object of selectable
	// fields: bare --json lists them, --json a,b selects them.
	fields bool
	// stream marks a command whose --json output is NDJSON, never enveloped.
	stream bool
	path   string // the full spelling, "sim mail"; set by buildTable
}

// display is how messages name the command: its full spelling.
func (spec commandSpec) display() string {
	if spec.path != "" {
		return spec.path
	}
	return spec.name
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
			return fmt.Errorf("haven %s takes no arguments (got %q)%s", spec.display(), a, flagHint(spec))
		}
		if spec.maxArgs > 0 && len(inv.args) >= spec.maxArgs {
			return fmt.Errorf("haven %s takes at most %d argument(s) (got extra %q)", spec.display(), spec.maxArgs, a)
		}
		inv.args = append(inv.args, a)
		return nil
	}
	for i := 0; i < len(rest); i++ {
		a := rest[i]
		switch {
		case a == "--":
			// The standard end-of-flags separator: everything after it is a
			// positional verbatim, so a wrapped command's own flags (`haven
			// slot run -- tsgo --noEmit`) can never be read as haven's.
			for _, tail := range rest[i+1:] {
				if err := addPositional(tail); err != nil {
					return inv, err
				}
			}
			return inv, nil
		case strings.HasPrefix(a, "--"):
			name, embedded, hasEmbedded := strings.Cut(a, "=")
			f := findLong(name)
			if f == nil {
				return inv, fmt.Errorf("haven %s: unknown flag %q%s", spec.display(), name, flagHint(spec))
			}
			if hasEmbedded {
				if !f.takesValue && !f.isSwitch {
					return inv, fmt.Errorf("haven %s: %s takes no value", spec.display(), f.long)
				}
				if f.isSwitch {
					if _, err := strconv.ParseBool(embedded); err != nil {
						return inv, fmt.Errorf("haven %s: %s=%s is not true or false", spec.display(), f.long, embedded)
					}
				}
				inv.flags[f.long] = embedded
				continue
			}
			if f.takesValue {
				if i+1 >= len(rest) {
					return inv, fmt.Errorf("haven %s: %s needs a value %s", spec.display(), f.long, f.value)
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
						return inv, fmt.Errorf("haven %s: %s needs a value %s", spec.display(), f.long, f.value)
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
			return inv, fmt.Errorf("haven %s: unknown flag %q%s", spec.display(), a, flagHint(spec))
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

// table is the whole CLI surface, in help order. The viewer's own tabs are
// appended to it: every tab of the up viewer is a command too, so a stack is
// as readable from a pipe as it is from a keyboard.
var table = buildTable()

// baseTable is the surface that is not derived from the viewer's tabs.
var baseTable = []commandSpec{
	{
		name:    "simulator",
		args:    "<mail|idp|storage|voice|llm|analytics|outbound>",
		maxArgs: 1,
		hidden:  true,
		run:     runBundledSimulator,
	},
	{
		name:    "static",
		args:    "<lane> <dir> <port>",
		maxArgs: 3,
		hidden:  true,
		run:     runStatic,
	},
	{
		name:    "go-watch",
		args:    "<binary> <service>…",
		maxArgs: -1,
		hidden:  true,
		run:     runGoWatch,
	},
	{
		name:   "ui-watch",
		hidden: true,
		run:    runUIWatch,
	},
	{
		name:    "keep",
		args:    "<slug>",
		maxArgs: 1,
		hidden:  true,
		run:     runKeep,
	},
	{
		name:      "up",
		summary:   "start or reconcile this worktree's stack; +svc/-svc picks services and sticks",
		args:      "[+svc|-svc …]",
		maxArgs:   -1,
		minusArgs: true,
		flags: []flagSpec{
			{long: "--watch", short: "-w", isSwitch: true, summary: "reload on a change: Go rebuilds and Node reloads (the UI rebuilds only under --ui=watch). Off by default for the built UI, on for watch and bundled; --watch=false holds any stack. Sticks; `haven reload` applies changes"},
			{long: "--detach", short: "-d", summary: "run in the background without the log view"},
			{long: "--force", summary: "restart the stack even when it already matches"},
			{long: "--rebuild", summary: "rebuild container images even when unchanged"},
			{long: "--ui", takesValue: true, value: "<built|watch|bundled>", summary: "built (the default) serves a production build of apps/ui from the api, built once at up and on `haven reload ui`; watch rebuilds it on a change and open pages reload once idle; bundled runs Vite bundledDev with HMR. `pnpm dev` runs the Vite dev server outside haven; sticks"},
			{long: "--mode", takesValue: true, value: "<mode>", summary: "deployment mode from dev/tests/modes; sticks, none clears"},
			{long: "--no-seed", summary: "skip the auto-seed of an empty stack (HAVEN_AUTO_SEED=0 does too)"},
			{long: "--no-mail", summary: "the app sees no mail provider, even one .env names (HAVEN_NO_MAIL=1 does too); not sticky"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			if inv.has("--no-seed") {
				disableAutoSeed()
			}
			if inv.has("--no-mail") {
				_ = os.Setenv(domain.NoMailKnob, "1")
			}
			if err := rejectRemovedSelectionEnv(); err != nil {
				return err
			}
			if err := checkOneProcessEnv(os.Stderr); err != nil {
				return err
			}
			sel, err := d.orch.ResolveSelection(d.worktree, upDeltas(d, inv.args))
			if err != nil {
				return err
			}
			sel, mode, err := d.orch.ResolveMode(d.worktree, sel, inv.value("--mode"))
			if err != nil {
				return err
			}
			if err := applyDeploymentMode(&d.opts, mode, d.worktree); err != nil {
				return err
			}
			if inv.has("--watch") {
				d.opts.ShouldGoWatch = inv.value("--watch") != "false" && inv.value("--watch") != "0"
				if sel, err = d.orch.ResolveHold(d.worktree, sel, !d.opts.ShouldGoWatch); err != nil {
					return err
				}
			}
			if inv.has("--ui") {
				if sel, err = d.orch.ResolveUI(d.worktree, sel, inv.value("--ui")); err != nil {
					return err
				}
			}
			d.opts.ShouldGoWatch = d.opts.ShouldGoWatch && !sel.IsHeld()
			d.opts.Selection = sel
			d.opts.ShouldRebuildImages = inv.has("--rebuild")
			d.opts.ShouldForce = inv.has("--force")
			if d.opts.IsStub {
				return d.orch.UpStub(ctx, d.params, dashboard.StartEcho)
			}
			if inv.has("--detach") {
				return runUpDetached(d, inv.raw)
			}
			if upRunsAttached(d.isAgent, stdoutIsTTY()) {
				return runUpAttached(ctx, d, inv.raw)
			}
			// The foreground run dies with whoever launched it; the detached
			// child above runs under Setsid and is naturally exempt.
			ctx, unwatch := watchLaunchingGroup(ctx)
			defer unwatch()
			d.opts.IsForegroundClient = !isSessionLeader()
			if err := d.orch.Up(ctx, d.params, d.opts); err != nil {
				return err
			}
			return followAsOwner(ctx, d)
		},
	},
	{
		name:    "down",
		summary: "stop this stack and keep its data; --destroy drops its databases too",
		flags: []flagSpec{
			{long: "--all", summary: "stop every stack, the shared servers, the daemon, and the proxy"},
			{long: "--force", summary: "kill hard — no graceful shutdown"},
			{long: "--destroy", summary: "also DROP this stack's databases: a terminal types the slug, an agent passes --yes"},
			{long: "--yes", summary: "confirm --destroy without prompting (required in agent mode)"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			if inv.has("--destroy") {
				return runDownDestroy(ctx, d, inv)
			}
			if inv.has("--all") {
				return d.orch.DownAll(ctx)
			}
			if slug, err := d.orch.ResolveSlug(d.params); err == nil {
				stopBrowser(slug)
			}
			return d.orch.Down(ctx, d.params, inv.has("--force"))
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
		name:    "reload",
		summary: "restart the Node host (app|api|worker) onto the current code and wait until it is ready; ui rebuilds a built-UI stack's bundle and swaps it in",
		args:    "[app|api|worker|ui]",
		maxArgs: 1,
		run: func(ctx context.Context, d deps, inv invocation) error {
			name := "app"
			if len(inv.args) > 0 {
				name = inv.args[0]
			}
			return d.orch.Reload(ctx, d.params, name)
		},
	},
	{
		name:    "idp",
		summary: "idpsim: bare runs the standalone IdP simulator; with a verb it drives this stack's (tenants | tenant show | apps | populate | churn | user add | scim ... | dns | verification | activity | signin | reset | samlp | legacy | tamper | auth0-webhook | scim-event | rotate-key | skew | user disable/enable | saml unsolicited)",
		args:    "[verb] [tenant] [args]",
		maxArgs: -1,
		flags:   simFlags(idpFlags...),
		run:     runIdP,
	},
	{
		name:    "limits",
		summary: "machine resource limits: show them, or set <name> <value> | unset <name>",
		args:    "[set <name> <value> | unset <name>]",
		maxArgs: 3,
		flags: []flagSpec{
			{long: "--json", summary: "machine-readable"},
		},
		run: runLimits,
	},
	{
		name:    "mail",
		summary: "read this worktree's caught email: address | inbox | list | get <id> | links <id> | wait | delete <id> | clear | set --error <status>",
		args:    "<address|inbox|list|get|links|wait|delete|clear|set> [id]",
		maxArgs: 2,
		flags: []flagSpec{
			simErrorFlag,
			{long: "--to", takesValue: true, value: "<addr>", summary: "list/wait: only messages to a matching recipient"},
			{long: "--subject", takesValue: true, value: "<text>", summary: "list/wait: only messages with a matching subject"},
			{long: "--timeout", takesValue: true, value: "<dur>", summary: "wait: how long to block for a match (default 30s)"},
			{long: "--after", takesValue: true, value: "<id>", summary: "wait: only mail caught after this message"},
			{long: "--html", summary: "get: the message's raw HTML body instead of its text"},
			{long: "--json", summary: "machine-readable"},
		},
		run: runMail,
	},
	{
		name:    "llm",
		summary: "llmsim's calls and settings: info | calls [--model <text>] [--failed] | call <id> | clear | set --error <status> --seed <value>",
		args:    "<info|calls|call|clear|set> [id]",
		maxArgs: 2,
		flags: simFlags(
			flagSpec{long: "--error", takesValue: true, value: "<status>", summary: "set: force this 4xx/5xx on generation calls (0 turns it off)"},
			flagSpec{long: "--seed", takesValue: true, value: "<value>", summary: "set: seed for deterministic replies (\"random\" or empty to unseed)"},
			flagSpec{long: "--model", takesValue: true, value: "<text>", summary: "calls: only calls whose model contains this text"},
			flagSpec{long: "--failed", summary: "calls: only calls answered with a 4xx or 5xx"},
		),
		run: runLLM,
	},
	{
		name:    "analytics",
		summary: "analyticssim's caught PostHog and Customer.io calls: status | records | clear | wait | set --error <status>",
		args:    "<status|records|clear|wait|set>",
		maxArgs: 1,
		flags: simFlags(
			simErrorFlag,
			flagSpec{long: "--provider", takesValue: true, value: "<name>", summary: "records/wait: posthog or customerio"},
			flagSpec{long: "--kind", takesValue: true, value: "<kind>", summary: "records/wait: only this kind of record"},
			flagSpec{long: "--event", takesValue: true, value: "<name>", summary: "records/wait: only this event name"},
			flagSpec{long: "--id", takesValue: true, value: "<id>", summary: "records/wait: only this distinct or person id"},
			flagSpec{long: "--timeout", takesValue: true, value: "<dur>", summary: "wait: how long to block for a match (default 30s)"},
		),
		run: runAnalytics,
	},
	{
		name:    "outbound",
		summary: "outboundsim's caught Slack, webhook and SQS sends: status | records | deliveries | clear | wait | fault | receiver | urls",
		args:    "<status|records|deliveries|clear|wait|fault|receiver|urls> [add|list|clear|set] [name]",
		maxArgs: 3,
		flags: simFlags(
			flagSpec{long: "--channel", takesValue: true, value: "<name>", summary: "records/wait/fault add: slack-webhook, slack-api, webhook or sqs"},
			flagSpec{long: "--target", takesValue: true, value: "<glob>", summary: "records/wait/fault add: only this target"},
			flagSpec{long: "--event-id", takesValue: true, value: "<id>", summary: "records/deliveries: only this event"},
			flagSpec{long: "--since", takesValue: true, value: "<time>", summary: "records: only newer than this"},
			flagSpec{long: "--count", takesValue: true, value: "<n>", summary: "wait: how many matches to wait for (default 1)"},
			flagSpec{long: "--timeout", takesValue: true, value: "<dur>", summary: "wait: how long to block for a match (default 30s)"},
			flagSpec{long: "--status", takesValue: true, value: "<code>", summary: "fault add: the status to answer with"},
			flagSpec{long: "--body", takesValue: true, value: "<text>", summary: "fault add: the body to answer with"},
			flagSpec{long: "--retry-after", takesValue: true, value: "<seconds>", summary: "fault add: Retry-After to send"},
			flagSpec{long: "--latency", takesValue: true, value: "<ms>", summary: "fault add: stall this long before answering"},
			flagSpec{long: "--drop", summary: "fault add: close the connection without answering"},
			flagSpec{long: "--times", takesValue: true, value: "<n>", summary: "fault add: apply this many times, then delete itself"},
			flagSpec{long: "--secret", takesValue: true, value: "<secret>", summary: "receiver set: the webhook secret to verify signatures with"},
		),
		run: runOutbound,
	},
	{
		name:    "lambda",
		summary: "lambdasim's NLP Lambda invocations: info | calls | call <id> | clear | set --error <kind>",
		args:    "<info|calls|call|clear|set> [id]",
		maxArgs: 2,
		flags: simFlags(
			flagSpec{long: "--error", takesValue: true, value: "<kind>", summary: "set: force throttled, not-found, function-error or service on every invoke (none turns it off)"},
		),
		run: runLambda,
	},
	{
		name:    "payment",
		summary: "paymentsim, the Stripe stand-in: status | customers | subscriptions | checkouts | invoices | events | usage | complete | retry | advance | fail | clear-failures | deliver | hold | release | reset",
		args:    "<status|customers|subscriptions|checkouts|invoices|events|usage|complete|retry|advance|fail|clear-failures|deliver|hold|release|reset> [id]",
		maxArgs: 2,
		flags: simFlags(
			flagSpec{long: "--type", takesValue: true, value: "<event type>", summary: "events: only this type"},
			flagSpec{long: "--customer", takesValue: true, value: "<id>", summary: "usage/fail: the customer"},
			flagSpec{long: "--seconds", takesValue: true, value: "<n>", summary: "advance: move the test clock on this far"},
			flagSpec{long: "--times", takesValue: true, value: "<n>", summary: "fail: decline this many charges (default 1, -1 every one)"},
			flagSpec{long: "--ids", takesValue: true, value: "<a,b>", summary: "deliver: event ids, in the order to send them; repeat one for a duplicate"},
			flagSpec{long: "--secret", takesValue: true, value: "<whsec>", summary: "deliver: sign with this secret instead (tests the refusal)"},
		),
		run: runPayment,
	},
	{
		name:    "feedback",
		summary: "notes readers sent from the haven orb in the app page: list | show | resolve | wait",
		args:    "<list|show|resolve|wait> [id]",
		maxArgs: 2,
		flags: simFlags(
			flagSpec{long: "--open", summary: "list: only feedback nobody resolved"},
			flagSpec{long: "--timeout", takesValue: true, value: "<dur>", summary: "wait: how long to block for new feedback (default 30s)"},
		),
		run: runFeedback,
	},
	{
		name:    "page",
		summary: "the app page's recent console messages and requests, as the haven orb saw them: console | network",
		args:    "<console|network>",
		maxArgs: 1,
		flags: simFlags(
			flagSpec{long: "--level", takesValue: true, value: "<level>", summary: "console: only this level (error, warn, info, log, debug)"},
			flagSpec{long: "--failed", summary: "network: only requests that failed"},
		),
		run: runPage,
	},
	{
		name:    "storage",
		summary: "storagesim's S3: buckets | objects [bucket] | object <bucket> <key> [--raw] | presign <bucket> <key> | delete | clear [bucket] | seed | requests | set --error <status>",
		args:    "<buckets|objects|object|presign|delete|clear|seed|requests|set> [bucket] [key]",
		maxArgs: 3,
		flags: simFlags(
			simErrorFlag,
			flagSpec{long: "--raw", summary: "object: the stored bytes instead of the metadata"},
			flagSpec{long: "--put", summary: "presign: a PUT URL instead of a GET"},
			flagSpec{long: "--expires", takesValue: true, value: "<seconds>", summary: "presign: lifetime, 1..604800 (default 3600)"},
		),
		run: runStorage,
	},
	{
		name:    "voice",
		summary: "voicesim's calls: status | calls | call <id> | clear",
		args:    "<status|calls|call|clear> [id]",
		maxArgs: 2,
		flags:   simFlags(),
		run:     runVoice,
	},
	{
		name:    "logs",
		summary: "captured service logs from any terminal: all interleaved, or the named ones",
		args:    "[service…]",
		maxArgs: -1,
		flags: []flagSpec{
			{long: "--follow", short: "-f", summary: "stream live"},
			{long: "--since", takesValue: true, value: "<dur>", summary: "only lines from the last e.g. 10m"},
			{long: "--level", takesValue: true, value: "<lvl>", summary: "only warn-or-worse (warn) / errors (error)"},
			{long: "--loki", summary: "read the full stream from the stack's Loki (info/debug the consoles mute)"},
			{long: "--grep", takesValue: true, value: "<text>", summary: "only lines containing text"},
			{long: "--trace", takesValue: true, value: "<trace-id>", summary: "Loki lines for one trace (implies --loki)"},
			{long: "--raw", summary: "the child's own bytes, unrendered"},
			{long: "--json", summary: "NDJSON: one typed event per line, lane stamped on"},
		},
		stream:  true,
		rewrite: retireLogsTail,
		run:     runLogsCmd,
	},
	querySpec(),
	seedSpec(),
	apiSpec(),
	gatewaySpec(),
	telemetrySpec(),
	authSpec(),
	browserSpec(),
	mfaSpec(),
	{
		name:    "status",
		summary: "one-shot report: every stack, service health, shared servers, RAM",
		fields:  true,
		flags: []flagSpec{
			{long: "--json", summary: "machine-readable"},
			{long: "--reveal", summary: "print this worktree's overlay secrets instead of masking them"},
		},
		run: func(_ context.Context, d deps, inv invocation) error {
			return d.orch.Status(d.isAgent || inv.has("--json"), d.worktree, inv.has("--reveal"))
		},
	},
	{
		name:    "env",
		summary: "print this stack's resolved environment: eval \"$(haven env --reveal)\" to load it in a shell",
		flags: []flagSpec{
			{long: "--json", summary: "machine-readable"},
			{long: "--reveal", summary: "print secret values instead of masking them"},
		},
		run: func(_ context.Context, d deps, inv invocation) error {
			return d.orch.Env(d.params, inv.has("--json"), inv.has("--reveal"))
		},
	},
	{
		name:    "db",
		summary: "this stack's data: reset [preset] (drop + migrate + seed) | seed [preset] (drops nothing) | url | prune (stray test/apidiff databases; dry run unless --yes)",
		args:    "<reset|seed|url|prune> [preset|engine]",
		maxArgs: 2,
		flags: []flagSpec{
			{long: "--yes", summary: "confirm a reset without prompting (required in agent mode); drops for prune"},
			{long: "--dry-run", summary: "prune: list the stray databases only (the default)"},
		},
		run: runDB,
	},
	{
		name:    "pr",
		summary: "a GitHub PR locally: a lasting worktree + stack; --throwaway gives a sandbox that quitting DESTROYS",
		args:    "<ref>",
		maxArgs: 1,
		flags: []flagSpec{
			{long: "--throwaway", summary: "own checkout + databases; quitting DESTROYS everything it created"},
			{long: "--allow-untrusted", summary: "--throwaway: proceed although not every PR author has write access (the only way in agent mode)"},
			{long: "--seed", takesValue: true, value: "<preset>", summary: "--throwaway: seed the sandbox's database: " + strings.Join(app.SeedPresetNames(), ", ")},
			{long: "--launch", hidden: true, summary: "internal: the sandbox's backgrounded launcher"},
			{long: "--dry-run", summary: "resolve + print the plan, create nothing"},
			{long: "--no-install", summary: "skip dependency install"},
			{long: "--allow-closed", summary: "allow a non-open PR"},
			{long: "--allow-scripts", summary: "run install lifecycle scripts for a fork"},
			{long: "--discard-local-changes", summary: "overwrite local edits instead of stashing"},
		},
		run: func(ctx context.Context, d deps, inv invocation) error {
			switch {
			case inv.has("--launch"):
				return runPlayLaunchCmd(ctx, d, inv)
			case inv.has("--throwaway"):
				return runPlay(ctx, d, inv)
			}
			if inv.has("--allow-untrusted") || inv.has("--seed") {
				return usageErr("--allow-untrusted and --seed belong to haven pr --throwaway")
			}
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
		name:    "switch",
		summary: "cd to a worktree by name (the shell function comes from haven self setup)",
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
		name:    "clean",
		summary: "one cleanup: worktree picker, then job-scratch picker, then safe reclaim",
		flags: []flagSpec{
			{long: "--yes", summary: "no pickers: apply exactly the pre-tick defaults — never a database"},
			{long: "--stale-days", takesValue: true, value: "<n>", summary: "idle age pre-ticked for deletion"},
			{long: "--include-recent", summary: "also reclaim agent jobs that finished within the last 48h"},
		},
		run: runClean,
	},
	{
		name:    "run",
		summary: "run a command under a machine-wide heavy slot, so parallel test runs can't take the machine",
		args:    "--sh <command>",
		flags: []flagSpec{
			{long: "--sh", takesValue: true, value: "<command>", summary: "the command line to run, as one argument — quoted so operators stay inside the slot"},
			{long: "--class", takesValue: true, value: "heavy", summary: "which slot pool to take (only \"heavy\" today)"},
			// NOT --agent: that already means plain, token-free output everywhere
			// else in this CLI, and ADR-064 rule 2 is one meaning per flag.
			{long: "--agent-id", takesValue: true, value: "<id>", summary: "the sub-agent this run belongs to — picks the shorter wait ceiling its prompt cache needs"},
			{long: "--workers", takesValue: true, value: "<n>", summary: "run this narrowed to n test workers, the width the gate admitted it at"},
		},
		run: runHeavy,
	},
	{
		// install is about the MACHINE, setup about the CHECKOUT. Two commands
		// rather than one because they answer to different people: everything
		// here is something a developer installs once per laptop, and
		// everything in setup is per worktree and gitignored.
		name:    "install",
		summary: "check this machine for what haven needs and offer to install it (portless, node, brew formulae, a runtime)",
		args:    "[prerequisite…]",
		maxArgs: -1,
		flags: []flagSpec{
			{long: "--list", summary: "report what is installed and what is missing; change nothing"},
			{long: "--yes", summary: "install what haven needs without asking (leaves the optional ones alone)"},
			{long: "--reset-skips", summary: "forget every never-ask-again, so the next run offers them all"},
			{long: "--build", summary: "build the consoles and go-install haven quietly, one progress line per step (what make haven install runs first)"},
		},
		run: runInstall,
	},
	{
		name:    "setup",
		summary: "install optional integrations into this checkout (interactive; nothing is assumed)",
		args:    "[feature…]",
		maxArgs: -1,
		flags: []flagSpec{
			{long: "--list", summary: "what can be installed, and what each one does"},
			{long: "--off", summary: "turn a feature back off here, so haven up stops reinstalling it (e.g. gate-hook)"},
		},
		run: runSetup,
	},
	{
		name:    "gate",
		summary: "answer a coding-agent PreToolUse hook on stdin (opt in with `haven self setup`)",
		flags: []flagSpec{
			{long: "--client", takesValue: true, value: "<client>", summary: "hook output protocol: claude (default) or codex"},
		},
		run: runGate,
	},
	{
		name:    "slot",
		summary: "run any command under the machine-wide check slot (`slot run -- <cmd>`, `slot explain`)",
		args:    "run [--label <name>] [--timeout <duration>] -- <command> [args…] | explain",
		maxArgs: -1,
		// The wrapped command lives after the `--` separator; only --label and
		// --timeout are ours, and they arrive before the `--`.
		minusArgs: true,
		flags: []flagSpec{
			{long: "--label", value: "<name>", takesValue: true, summary: "how the run is named while it queues"},
			{long: "--timeout", value: "<duration>", takesValue: true, summary: "stop the command and exit 124 once it has run this long (e.g. 10m)"},
		},
		run: runSlot,
	},
	{
		name:    "typecheck",
		summary: "typecheck under the machine-wide RAM slot: --affected (agent default) or --all (human default); other args forwarded",
		args:    "[--affected|--all] [args…]",
		maxArgs: -1,
		flags: []flagSpec{
			{long: "--affected", summary: "nx affected -t typecheck from the merge-base with the upstream, or origin/main (the agent default)"},
			{long: "--all", summary: "the whole-tree pnpm typecheck (the default for a person)"},
		},
		// The summary promises the arguments are forwarded, and they are handed
		// to tsc verbatim — so tsc's own flags (--watch, --noEmit, -p) have to
		// reach it. Without this every one of them was rejected as an unknown
		// haven flag and the command could only ever run bare.
		minusArgs: true,
		run: func(ctx context.Context, d deps, inv invocation) error {
			args, affected := typecheckScope(inv.raw, d.isAgent)
			return d.orch.Typecheck(ctx, app.TypecheckRun{
				RepoDir: d.worktree, ExtraArgs: args, Affected: affected,
				SlotsOverride: envInt("HAVEN_TYPECHECK_SLOTS", 0), MaxRSSOverrideMB: envInt("HAVEN_TYPECHECK_MAX_RSS_MB", 0),
			})
		},
	},
	{
		name:    "upgrade",
		summary: "reinstall the haven binary from this checkout",
		run:     runUpgrade,
	},
	{
		name:    "daemon",
		args:    "[restart]",
		maxArgs: 1,
		flags:   []flagSpec{{long: "--after", takesValue: true, value: "<pid>", summary: "wait for this daemon to exit, then take over"}},
		hidden:  true,
		run:     runDaemon,
	},
}

// tableByName indexes every command by its full spelling: "up", "sim",
// "sim mail", "machine typecheck".
var tableByName = func() map[string]commandSpec {
	m := map[string]commandSpec{}
	var index func(specs []commandSpec)
	index = func(specs []commandSpec) {
		for _, spec := range specs {
			if _, dup := m[spec.display()]; dup {
				panic("duplicate haven command " + spec.display())
			}
			m[spec.display()] = spec
			index(spec.subs)
		}
	}
	index(table)
	return m
}()

func (d deps) dispatch(ctx context.Context, sub string, rest []string) error {
	if now, ok := retired[sub]; ok {
		if now == nil {
			return retiredError(append([]string{sub}, rest...), nil)
		}
		return retiredError(append([]string{sub}, rest...), now(rest))
	}
	spec, ok := tableByName[sub]
	if !ok {
		msg := fmt.Sprintf("unknown command %q", sub)
		if close := closestCommands(sub); len(close) > 0 {
			msg += " — did you mean: " + strings.Join(close, ", ")
		}
		return usageErr("%s\nRun `haven help` for the full reference.", msg)
	}
	return d.run(ctx, spec, rest)
}

// run walks into a group's sub, rewrites a public argv to the one the command
// parses, and runs it, enveloping its --json output.
func (d deps) run(ctx context.Context, spec commandSpec, rest []string) error {
	if len(spec.subs) > 0 && len(rest) > 0 && !strings.HasPrefix(rest[0], "-") {
		for _, sub := range spec.subs {
			if sub.name == rest[0] {
				return d.run(ctx, sub, rest[1:])
			}
		}
		if spec.run == nil {
			return usageErr("haven %s: unknown subcommand %q; one of: %s", spec.display(), rest[0], strings.Join(subNames(spec), ", "))
		}
	}
	if spec.run == nil {
		return usageErr("haven %s needs a subcommand: %s", spec.display(), strings.Join(subNames(spec), ", "))
	}
	if spec.rewrite != nil {
		var err error
		if rest, err = spec.rewrite(rest); err != nil {
			return err
		}
	}
	rest, sel, err := takeJSONSelection(spec, rest)
	if err != nil {
		return err
	}
	inv, err := parse(spec, rest)
	if err != nil {
		return exitError{code: exitUsage, err: err}
	}
	if d.target != "" {
		inv.flags["--stack"] = d.target
	}
	if !inv.has("--json") || spec.stream {
		return spec.run(ctx, d, inv)
	}
	return d.envelope(spec, sel, func() error { return spec.run(ctx, d, inv) })
}

func subNames(spec commandSpec) []string {
	var names []string
	for _, sub := range spec.subs {
		if !sub.hidden {
			names = append(names, sub.name)
		}
	}
	return names
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
	if len(out) == 0 {
		for _, spec := range table {
			for _, sub := range spec.subs {
				if !sub.hidden && (sub.name == input || editDistanceAtMost(sub.name, input, 1)) {
					out = append(out, sub.display())
				}
			}
		}
	}
	sort.Strings(out)
	isPrefix := func(name string) bool { return strings.HasPrefix(name, input) || strings.HasPrefix(input, name) }
	sort.SliceStable(out, func(i, j int) bool { return isPrefix(out[i]) && !isPrefix(out[j]) })
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

// dailyCommands are the top-level verbs help lists first; everything else
// visible is a group or a tool.
var dailyCommands = []string{"up", "down", "restart", "reload", "status", "logs", "errors", "env", "browser", "pr", "switch", "wait", "defaults"}

// commandsHelp renders help's command sections from the table, so a command
// cannot exist without being documented: the daily verbs, then each group
// with its subcommands. Flags live in `haven help <command>`.
func commandsHelp() string {
	var daily, groups strings.Builder
	for _, spec := range table {
		if spec.hidden {
			continue
		}
		left := spec.name
		switch {
		case len(spec.subs) > 0 && spec.run == nil:
			left += " " + strings.Join(subNames(spec), "|")
		case spec.args != "":
			left += " " + spec.args
		}
		section := &groups
		if slices.Contains(dailyCommands, spec.name) {
			section = &daily
		}
		fmt.Fprintf(section, "    %-16s %s\n", left, spec.summary)
	}
	return "DAILY\n" + daily.String() + "\nGROUPS\n" + groups.String()
}

// commandHelp renders one command in full: what it is for, how it is called,
// and every flag it takes. A group lists its subcommands.
func commandHelp(name string) (string, bool) {
	spec, ok := tableByName[name]
	if !ok || spec.hidden {
		return "", false
	}
	return renderCommandHelp(spec), true
}

func renderCommandHelp(spec commandSpec) string {
	var b strings.Builder
	usage := "    haven " + spec.display()
	if spec.args != "" {
		usage += " " + spec.args
	}
	fmt.Fprintf(&b, "%s\n\n%s\n", spec.summary, usage)
	if names := subNames(spec); len(names) > 0 {
		b.WriteString("\nSUBCOMMANDS\n")
		for _, sub := range spec.subs {
			if !sub.hidden {
				fmt.Fprintf(&b, "    %-16s %s\n", sub.name, sub.summary)
			}
		}
	}
	var flags []flagSpec
	for _, f := range spec.flags {
		if !f.hidden {
			flags = append(flags, f)
		}
	}
	if len(flags) > 0 {
		b.WriteString("\nFLAGS\n")
		for _, f := range flags {
			fmt.Fprintf(&b, "    %-22s %s\n", helpFlagLabel(f), f.summary)
		}
	}
	return b.String()
}

func helpFlagLabel(f flagSpec) string {
	label := f.long
	if f.short != "" {
		label = f.short + "/" + f.long
	}
	if f.takesValue {
		label += " " + f.value
	}
	return label
}

// commandNames lists every visible top-level command, for the "unknown topic" pointer.
func commandNames() []string {
	var names []string
	for _, spec := range table {
		if !spec.hidden {
			names = append(names, spec.name)
		}
	}
	return names
}

// typecheckScope takes haven's own --affected/--all and the `--` separator out
// of the forwarded args. An agent gets the affected run unless it asks for
// --all; a person the reverse.
func typecheckScope(raw []string, isAgent bool) (args []string, affected bool) {
	affected = isAgent
	for _, a := range raw {
		switch a {
		case "--":
		case "--affected":
			affected = true
		case "--all":
			affected = false
		default:
			args = append(args, a)
		}
	}
	return args, affected
}
