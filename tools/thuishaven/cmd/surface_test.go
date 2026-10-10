package cmd

import (
	"context"
	"os/exec"
	"slices"
	"strings"
	"testing"
)

// pointerCases runs each old argv through dispatch and checks it exits 64
// naming the exact new spelling.
func pointerCases(t *testing.T, cases map[string]string) {
	t.Helper()
	for old, now := range cases {
		t.Run(old, func(t *testing.T) {
			argv := strings.Fields(old)
			err := deps{}.dispatch(context.Background(), argv[0], argv[1:])
			if ExitCode(err) != exitUsage || !strings.Contains(err.Error(), "now: haven "+now) {
				t.Errorf("haven %s = %d %v, want 64 and now: haven %s", old, ExitCode(err), err, now)
			}
		})
	}
}

// @scenario "A simulator's old verb names its core verb"
func TestSimulatorOldVerbsPointAtTheCoreVerb(t *testing.T) {
	pointerCases(t, map[string]string{
		"mail inbox": "sim mail status", "mail set --error 503": "sim mail fault 503",
		"llm calls": "sim llm list", "llm call abc": "sim llm get abc", "lambda info": "sim lambda status",
		"analytics records": "sim analytics list", "outbound records": "sim outbound list",
		"payment events": "sim payment list", "payment reset": "sim payment clear", "payment fail": "sim payment fault",
		"payment clear-failures": "sim payment fault off", "storage requests": "sim storage list",
		"voice calls": "sim voice list", "idp tenants": "sim idp list", "idp tenant show acme": "sim idp get acme",
		"idp reset acme": "sim idp clear acme", "telemetry runs": "sim telemetry list", "telemetry run abc": "sim telemetry get abc",
		"sims": "sim", "llm set --seed 42": "sim llm config --seed 42",
	})
}

// @scenario "The old observability commands point under obs"
// @scenario "feedback and page move under orb"
// @scenario "auth and mfa point under browser"
// @scenario "Machine and self commands point at their group"
// @scenario "haven seed folds into db seed"
// @scenario "A spelling retired by v2 points at the new surface"
func TestOldCommandsPointAtTheirGroup(t *testing.T) {
	pointerCases(t, map[string]string{
		"traces": "obs traces", "metrics": "obs metrics", "profiles": "obs profiles", "query logql x": "obs query logql x",
		"feedback list": "orb feedback list", "page console": "orb console", "page network": "orb network",
		"auth admin": "browser login --as admin", "mfa list": "browser mfa list", "mfa totp fill": "browser mfa totp fill",
		"limits": "machine limits", "slot explain": "machine slot explain", "typecheck --affected": "machine typecheck --affected",
		"clean": "machine clean", "install": "self install", "setup": "self setup", "upgrade": "self upgrade",
		"shell-init": "self shell-init", "destroy feat-x": "down --destroy --stack feat-x", "play 4913": "pr 4913 --throwaway",
		"seed --size small": "db seed --size small",
		"ps":                "hub", "watch": "hub", "ls": "status", "tc": "machine typecheck", "oc": "machine clean",
		"doctor": "self doctor", "ch": "db url clickhouse", "cd": "switch",
	})
}

// @scenario "A deleted command exits 64 with one line"
func TestDeletedCommandsSaySo(t *testing.T) {
	for old, want := range map[string]string{"hmr": "removed, no replacement", "git": "removed, no replacement", "jobs": "now: haven status", "stores": "now: haven status"} {
		err := deps{}.dispatch(context.Background(), old, nil)
		if ExitCode(err) != exitUsage || !strings.Contains(err.Error(), want) {
			t.Errorf("haven %s = %d %v, want 64 and %q", old, ExitCode(err), err, want)
		}
	}
}

// @scenario "Hidden internals dispatch but stay out of help"
func TestHiddenInternalsStayOutOfHelp(t *testing.T) {
	help := commandsHelp()
	for _, name := range []string{"simulator", "static", "go-watch", "ui-watch", "keep", "daemon", "gate"} {
		spec, ok := tableByName[name]
		if !ok || !spec.hidden {
			t.Errorf("%s must stay dispatchable and hidden", name)
		}
		if strings.Contains(help, "    "+name+" ") {
			t.Errorf("help lists the internal %s", name)
		}
	}
}

// @scenario "A simulator's own verbs stay on it"
func TestSimulatorExtrasStayBesideTheCoreVerbs(t *testing.T) {
	verbs := simVerbs("payment")
	for _, want := range []string{"advance", "complete", "deliver", "hold", "release", "list", "fault", "clear"} {
		if !slices.Contains(verbs, want) {
			t.Errorf("payment's verbs %v lack %q", verbs, want)
		}
	}
	got, err := simInternalArgv("payment", []string{"fault", "off"})
	if err != nil || !slices.Equal(got, []string{"clear-failures"}) {
		t.Errorf("sim payment fault off = %v %v, want clear-failures", got, err)
	}
}

// @scenario "An agent environment variable means agent mode inside a terminal"
func TestAgentEnvironmentMeansAgentMode(t *testing.T) {
	for _, kv := range []string{"CLAUDECODE=1", "CODEX_HOME=/x", "CODEX_SANDBOX=seatbelt"} {
		if !agentEnvSet([]string{"HOME=/h", kv}) {
			t.Errorf("%s did not turn on agent mode", kv)
		}
	}
	if agentEnvSet([]string{"HOME=/h", "TERM=xterm"}) {
		t.Error("a plain shell turned on agent mode")
	}
}

// @scenario "A wrapped command's exit code passes through"
func TestWrappedExitCodesPassThrough(t *testing.T) {
	err := exec.Command("sh", "-c", "exit 7").Run()
	if code := ExitCode(err); code != 7 {
		t.Errorf("a wrapped exit 7 became %d", code)
	}
	if code := ExitCode(usageErr("x")); code != exitUsage {
		t.Errorf("a usage error exited %d", code)
	}
}

// @scenario "Every --json output is versioned"
// @scenario "--json with fields selects them"
// @scenario "An unknown field is a usage error"
func TestJSONEnvelope(t *testing.T) {
	obj, ok := envelopeOf([]byte(`{"stacks":[],"proxy":{}}`), "feat-a")
	if !ok || obj["v"] != outputVersion || obj["stack"] != "feat-a" {
		t.Fatalf("envelope = %v, want v 1 and the stack", obj)
	}
	arr, _ := envelopeOf([]byte(`[1,2]`), "")
	if _, ok := arr["items"]; !ok {
		t.Errorf("an array must sit under items, got %v", arr)
	}
	if _, ok := envelopeOf([]byte("{\"a\":1}\n{\"a\":2}\n"), ""); ok {
		t.Error("NDJSON must not be enveloped")
	}
	sel, err := selectFields(obj, []string{"stacks"})
	if err != nil || len(sel) != 3 {
		t.Errorf("selected %v %v, want v, stack and stacks", sel, err)
	}
	if _, err := selectFields(obj, []string{"nonsense"}); ExitCode(err) != exitUsage {
		t.Errorf("an unknown field exited %d", ExitCode(err))
	}
}

// @scenario "Bare --json on a command with fields lists them"
func TestBareJSONOnAFieldsCommandListsThem(t *testing.T) {
	_, sel, _ := takeJSONSelection(specByName(t, "status"), []string{"--json"})
	if !sel.listFields {
		t.Error("bare --json on status must list its fields")
	}
	rest, sel, _ := takeJSONSelection(specByName(t, "status"), []string{"--json", "stacks,proxy"})
	if sel.listFields || !slices.Equal(sel.fields, []string{"stacks", "proxy"}) || !slices.Equal(rest, []string{"--json"}) {
		t.Errorf("--json stacks,proxy read as %+v, rest %v", sel, rest)
	}
}

// @scenario "wait without --for is a usage error"
func TestWaitWithoutForIsUsage(t *testing.T) {
	inv, _ := parse(specByName(t, "wait"), nil)
	if code := ExitCode(runWait(context.Background(), deps{}, inv)); code != exitUsage {
		t.Errorf("haven wait exited %d, want %d", code, exitUsage)
	}
}

// @scenario "An unknown slug is a usage error"
// @scenario "Outside a worktree an agent gets the list of slugs"
func TestTargetsAreKnownOrRefused(t *testing.T) {
	t.Setenv("LANGWATCH_PORTLESS_HOME", t.TempDir())
	if _, _, err := resolveTarget("status", "nope", "/repo", true); ExitCode(err) != exitUsage {
		t.Errorf("an unknown slug exited %d", ExitCode(err))
	}
	if _, _, err := resolveTarget("logs", "", "", true); ExitCode(err) != exitUsage || !strings.Contains(err.Error(), "--stack") {
		t.Errorf("an agent outside a worktree got %v", err)
	}
	if _, _, err := resolveTarget("machine", "feat-a", "/repo", true); ExitCode(err) != exitUsage {
		t.Errorf("--stack on a machine-wide command exited %d", ExitCode(err))
	}
}

// @scenario "defaults edits the machine-wide default set"
func TestDefaultsEditTheMachineSet(t *testing.T) {
	t.Setenv("LANGWATCH_PORTLESS_HOME", t.TempDir())
	inv, err := parse(specByName(t, "defaults"), []string{"+llm", "-langy"})
	if err != nil {
		t.Fatal(err)
	}
	if err := runDefaults(context.Background(), deps{isAgent: true}, inv); err != nil {
		t.Fatal(err)
	}
	if got := readMachineDefaults(); !slices.Equal(got, []string{"+llm", "-langy"}) {
		t.Errorf("defaults = %v, want +llm -langy", got)
	}
	if got := mergeDeltas([]string{"+llm"}, []string{"-llm"}); !slices.Equal(got, []string{"-llm"}) {
		t.Errorf("a later delta must win, got %v", got)
	}
}

// @scenario "logs follows with -f and -t is retired"
func TestLogsStreamIsTypedAndTailIsRetired(t *testing.T) {
	if got := typedLogEvent(`{"lane":"nlp","msg":"x"}`); !strings.HasPrefix(got, `{"type":"log",`) {
		t.Errorf("a log event lacks its type: %s", got)
	}
	if _, err := retireLogsTail([]string{"-t"}); ExitCode(err) != exitUsage || !strings.Contains(err.Error(), "now: haven logs -f") {
		t.Errorf("logs -t = %v", err)
	}
}
