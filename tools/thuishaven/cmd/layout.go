package cmd

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

// buildTable composes the CLI surface of ADR-064's 2026-10-10 amendment from
// the command definitions: the daily verbs at the top level, every tool under
// its noun, the internals hidden. help, dispatch and the retired-spelling
// pointers all read the result, so the layout lives here and nowhere else.
func buildTable() []commandSpec {
	flat := map[string]commandSpec{}
	for _, spec := range append(slices.Clone(baseTable), tabSpecs()...) {
		flat[spec.name] = spec
	}
	for _, spec := range []commandSpec{querySpec(), seedSpec(), apiSpec(), gatewaySpec(), telemetrySpec(), authSpec(), browserSpec(), mfaSpec()} {
		flat[spec.name] = spec
	}
	take := func(name string) commandSpec {
		spec, ok := flat[name]
		if !ok {
			panic("haven: no command definition " + name)
		}
		return spec
	}
	hidden := func(name string) commandSpec {
		spec := take(name)
		spec.hidden = true
		return spec
	}

	sims := make([]commandSpec, 0, len(simulators))
	for _, sim := range simulators {
		sims = append(sims, simCommand(take(sim.name)))
	}
	page := take("page")
	pageVerb := func(verb string) commandSpec {
		spec := page
		spec.name, spec.args, spec.maxArgs = verb, "", 0
		spec.summary = map[string]string{
			"console": "the app page's recent console messages, as the haven orb saw them",
			"network": "the app page's recent requests, as the haven orb saw them",
		}[verb]
		spec.run = func(ctx context.Context, d deps, inv invocation) error {
			inv.args = []string{verb}
			return runPage(ctx, d, inv)
		}
		return spec
	}

	up, down := take("up"), take("down")
	up.rewrite, down.rewrite = retireShortForce("up"), retireShortForce("down")
	top := []commandSpec{
		hidden("simulator"), hidden("static"), hidden("go-watch"), hidden("ui-watch"), hidden("keep"), hidden("daemon"), hidden("gate"),
		up, down, take("restart"), take("reload"), statusCommand(take("status")), take("logs"), take("errors"), take("env"),
		browserCommand(take("browser"), take("auth"), take("mfa")),
		take("pr"), take("switch"), waitSpec(), defaultsSpec(),
		{name: "sim", args: "[<name> <verb>]", summary: "every simulator: bare lists them; sim <name> <verb> drives one", run: runSims, flags: simFlags(), subs: sims},
		{name: "obs", summary: "this stack's own telemetry: traces, metrics, profiles, raw queries", subs: []commandSpec{take("traces"), take("metrics"), take("profiles"), take("query")}},
		{name: "orb", summary: "what the haven orb on the app page saw and was sent", subs: []commandSpec{take("feedback"), pageVerb("console"), pageVerb("network")}},
		dbCommand(take("db"), take("seed")),
		apiCommand(take("api"), take("gateway")),
		{name: "machine", summary: "this machine: limits, slotted runs, typecheck, cleanup", subs: []commandSpec{take("limits"), take("run"), take("slot"), take("typecheck"), take("clean")}},
		{name: "self", summary: "haven itself: install, setup, upgrade, doctor, the shell function", subs: []commandSpec{take("install"), take("setup"), take("upgrade"), doctorSpec(take("install")), take("shell-init")}},
		{name: "hub", summary: "the interactive hub: every stack, health, RAM and actions (a terminal only)", run: func(ctx context.Context, d deps, _ invocation) error {
			if d.isAgent {
				return usageErr("the hub needs a terminal; haven status is the agent view")
			}
			return runHub(ctx, d)
		}},
	}
	for i := range top {
		finish(&top[i], "")
	}
	return top
}

// finish sets each spec's full spelling and drops a per-command --stack: the
// flag is global now, read before dispatch.
func finish(spec *commandSpec, parent string) {
	spec.path = strings.TrimSpace(parent + " " + spec.name)
	spec.flags = slices.DeleteFunc(slices.Clone(spec.flags), func(f flagSpec) bool { return f.long == "--stack" })
	spec.subs = slices.Clone(spec.subs)
	for i := range spec.subs {
		finish(&spec.subs[i], spec.path)
	}
}

// statusCommand folds the old jobs and stores tabs into status.
func statusCommand(spec commandSpec) commandSpec {
	spec.summary = "one-shot report: every stack, service health, shared servers, RAM, this stack's jobs and stores"
	spec.run = runStatus
	return spec
}

func browserCommand(browser, auth, mfa commandSpec) commandSpec {
	login := auth
	login.name, login.args, login.maxArgs = "login", "--as <admin|email>", 0
	login.summary = "sign in as admin or a seeded login and write a Playwright storage-state file (the password is never printed)"
	login.flags = append(slices.Clone(auth.flags), flagSpec{long: "--as", takesValue: true, value: "<admin|email>", summary: "who to sign in as"})
	login.run = func(ctx context.Context, d deps, inv invocation) error {
		who := inv.value("--as")
		if who == "" {
			return usageErr("usage: haven browser login --as <admin|email> [--out file]")
		}
		inv.args = []string{who}
		return runAuth(ctx, d, inv)
	}
	browser.subs = []commandSpec{login, mfa}
	browser.args = "login|mfa|<verb> …"
	browser.summary = "the shared headless browser, a signed-in context per --lane: login | mfa | open | goto | snapshot | click | fill | screenshot | record | replay | …"
	return browser
}

func dbCommand(db, seed commandSpec) commandSpec {
	db.summary = "this stack's data: reset [preset] | seed [preset] [seed flags] | url | prune | status | logins"
	db.args = "reset|seed|url|prune|status|logins"
	for _, f := range seed.flags {
		if !slices.ContainsFunc(db.flags, func(have flagSpec) bool { return have.long == f.long }) {
			db.flags = append(db.flags, f)
		}
	}
	db.subs = []commandSpec{
		{name: "status", summary: "connection URLs and the last seed run", fields: true, flags: []flagSpec{{long: "--json", summary: "machine-readable"}}, run: runDBStatus},
		{name: "logins", summary: "the seeded logins, credentials masked unless --reveal", flags: []flagSpec{{long: "--json", summary: "machine-readable"}, {long: "--reveal", summary: "print the credentials"}}, run: func(_ context.Context, d deps, inv invocation) error {
			return d.orch.PrintSeedAccess(d.params, inv.has("--json") || d.isAgent, inv.has("--reveal"))
		}},
	}
	return db
}

func apiCommand(api, gateway commandSpec) commandSpec {
	api.summary = "call this stack's REST API (or, with --gateway, its AI gateway) with a key haven holds and never prints"
	api.flags = append(slices.Clone(api.flags),
		flagSpec{long: "--gateway", summary: "call the AI gateway with a virtual key haven mints and holds"})
	for _, f := range gateway.flags {
		if !slices.ContainsFunc(api.flags, func(have flagSpec) bool { return have.long == f.long }) {
			api.flags = append(api.flags, f)
		}
	}
	run := api.run
	api.run = func(ctx context.Context, d deps, inv invocation) error {
		if inv.has("--gateway") {
			return runGateway(ctx, d, inv)
		}
		return run(ctx, d, inv)
	}
	return api
}

// doctorSpec is `haven self doctor`: what this machine has and lacks for
// haven, changing nothing.
func doctorSpec(install commandSpec) commandSpec {
	return commandSpec{
		name:    "doctor",
		summary: "report what this machine has and lacks for haven; changes nothing",
		run: func(ctx context.Context, d deps, inv invocation) error {
			inv.flags["--list"] = ""
			return install.run(ctx, d, inv)
		},
	}
}

// retireShortForce points up's and down's retired -f at --force: -f is
// logs' --follow now, and a shorthand means one thing.
func retireShortForce(name string) func(rest []string) ([]string, error) {
	return func(rest []string) ([]string, error) {
		if !slices.Contains(rest, "-f") {
			return rest, nil
		}
		now := slices.Clone(rest)
		now[slices.Index(now, "-f")] = "--force"
		return nil, retiredError(append([]string{name}, rest...), append([]string{name}, now...))
	}
}

// retireLogsTail points the retired -t/--tail at -f.
func retireLogsTail(rest []string) ([]string, error) {
	for _, a := range rest {
		if a == "-t" || a == "--tail" {
			now := slices.Clone(rest)
			for i := range now {
				if now[i] == "-t" || now[i] == "--tail" {
					now[i] = "-f"
				}
			}
			return nil, retiredError(append([]string{"logs"}, rest...), append([]string{"logs"}, now...))
		}
	}
	return rest, nil
}

// printBareHaven is bare `haven`: the status summary and the grouped help,
// never interactive.
func printBareHaven(d deps) error {
	if err := d.orch.Status(false, d.worktree, false); err != nil {
		fmt.Println("status:", err)
	}
	fmt.Println()
	fmt.Print(helpText)
	return nil
}
