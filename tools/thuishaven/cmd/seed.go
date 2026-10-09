package cmd

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// seedValueFlags are the seedgen flags `haven seed` passes through, in the order it passes them.
var seedValueFlags = []string{"--size", "--spans", "--days", "--persona", "--private", "--seed", "--anchor", "--shape", "--into"}

func seedSpec() commandSpec {
	flags := []flagSpec{
		{long: "--size", takesValue: true, value: "tiny|small|medium|large", summary: "tier of the seed (default small)"},
		{long: "--spans", takesValue: true, value: "<n>", summary: "exact span count, 1 to 2000000"},
		{long: "--days", takesValue: true, value: "<d>", summary: "days of history before the anchor (default 30)"},
		{long: "--persona", takesValue: true, value: "<list>", summary: "startup,enterprise,gateway,agent-eval or all"},
		{long: "--private", takesValue: true, value: "<n>", summary: "organizations on private stores"},
		{long: "--seed", takesValue: true, value: "<s>", summary: "the seed: the same seed gives the same content"},
		{long: "--anchor", takesValue: true, value: "<rfc3339>", summary: "the moment history ends at"},
		{long: "--shape", takesValue: true, value: "saas|sh-licensed|sh-free", summary: "deployment shape"},
		{long: "--org", takesValue: true, value: "name=..,plan=free,users=N[,persona=..]", summary: "create this org instead of the tier's (repeatable)"},
		{long: "--into", takesValue: true, value: "<org-id>/<project-id>", summary: "send telemetry only, into an existing project"},
		{long: "--live", summary: "stream a gentle live load into the last seed's orgs"},
		{long: "--dry-run", summary: "print the plan's counts, rows, bytes and duration; write nothing"},
		{long: "--json", summary: "end with the logins and credentials as one JSON object"},
		{long: "--reveal", summary: "print the credentials instead of masking them"},
	}
	return commandSpec{
		name:    "seed",
		summary: "fill this stack with seeded data, then print its logins and credentials (--json, --reveal); `seed status` shows the last run",
		args:    "[status]",
		maxArgs: 1,
		flags:   flags,
		run:     runSeed,
	}
}

// runSeed is `haven seed [status]`. Exit 2 means refused before writing, 4 stalled, 1 a check failed.
func runSeed(ctx context.Context, d deps, inv invocation) error {
	if len(inv.args) > 0 {
		if inv.args[0] != "status" {
			return fmt.Errorf("haven seed: unknown subcommand %q — status", inv.args[0])
		}
		return d.orch.SeedStatus(d.params)
	}
	err := d.orch.Seed(ctx, d.params, app.SeedRequest{Args: seedgenArgs(inv), Live: inv.has("--live"), JSON: inv.has("--json") || d.isAgent, Reveal: inv.has("--reveal")})
	if code := seedExitCode(err); code > 1 {
		fmt.Fprintln(os.Stderr, "haven:", err)
		os.Exit(code)
	}
	return err
}

// seedgenArgs is the flags of inv in seedgen's spelling.
func seedgenArgs(inv invocation) []string {
	var args []string
	for _, f := range seedValueFlags {
		if inv.has(f) {
			args = append(args, f, inv.value(f))
		}
	}
	for i, arg := range inv.raw { // --org repeats; the parsed flags keep only the last
		if value, ok := strings.CutPrefix(arg, "--org="); ok {
			args = append(args, "--org", value)
		} else if arg == "--org" && i+1 < len(inv.raw) {
			args = append(args, "--org", inv.raw[i+1])
		}
	}
	if inv.has("--dry-run") {
		args = append(args, "--dry-run")
	}
	return args
}

// seedExitCode is the exit code err asks for: 0 for none, 1 for any other failure.
func seedExitCode(err error) int {
	var exit *app.SeedExit
	switch {
	case err == nil:
		return 0
	case errors.As(err, &exit):
		return exit.Code
	}
	return 1
}

// disableAutoSeed is `haven up --no-seed`: the keeper replays the up's environment, so it sees this.
func disableAutoSeed() { _ = os.Setenv("HAVEN_AUTO_SEED", "0") }
