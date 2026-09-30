package visualdiff

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCheckAnswersPassOrFailAndHowEachFlowComparesWithMain(t *testing.T) {
	results := newFlowResults()
	results.add(Capture{Kind: "flow", Key: "same", Side: "candidate", Expect: "saved"})
	results.add(Capture{Kind: "flow", Key: "moved", Side: "candidate", Expect: "saved"})
	results.add(Capture{Kind: "flow", Key: "broken", Side: "candidate", Index: 2, Label: "click", Error: "timeout"})
	results.add(Capture{Kind: "flow", Key: "broken", Side: "base", Expect: "a base capture never counts"})
	diffs := []Diff{{Kind: "flow", Key: "same", Ratio: 0.001}, {Kind: "flow", Key: "moved", Ratio: 0.25}}

	outcome := results.outcome(checkOutcomeInputs{
		flows: []Flow{{ID: "same"}, {ID: "moved"}, {ID: "broken"}, {ID: "new"}},
		done:  []string{"finished"}, diffs: diffs, held: map[string]bool{"same": true, "moved": true},
	})

	for _, want := range []string{
		"DONE     finished (skipped; -all runs it)",
		"PASS     same (1 expects) · looks like main",
		"PASS     moved (1 expects) · differs from main (25.0%)",
		"FAIL     broken · step 2 click: timeout · no baseline",
		"UNPROVEN new · no expect held · no baseline",
		"2/4 flows passed",
	} {
		if !strings.Contains(outcome.text, want) {
			t.Errorf("missing %q in\n%s", want, outcome.text)
		}
	}
	if outcome.failed != 2 || len(outcome.passed) != 2 {
		t.Errorf("failed %d, passed %v", outcome.failed, outcome.passed)
	}
}

func TestAPassWithNoBaselineIsVerifiedOnlyWhenAnExpectChecksData(t *testing.T) {
	results := newFlowResults()
	for _, id := range []string{"data", "presence"} {
		results.add(Capture{Kind: "flow", Key: id, Side: "candidate", Expect: "ok"})
	}
	expect := func(key string) Step { return Step{Action: ExpectAction, With: map[string]string{key: "x"}} }
	outcome := results.outcome(checkOutcomeInputs{flows: []Flow{
		{ID: "data", Steps: []Step{expect("testId"), expect("hasText")}},
		{ID: "presence", Steps: []Step{expect("testId")}},
	}})
	for _, want := range []string{
		"VERIFIED data (1 expects, 1 data) · verified, not compared",
		"PASS     presence (1 expects) · no baseline, presence only",
		"2/2 flows passed, 1 verified not compared",
	} {
		if !strings.Contains(outcome.text, want) {
			t.Errorf("missing %q in\n%s", want, outcome.text)
		}
	}
	if len(outcome.passed) != 2 || outcome.failed != 0 {
		t.Errorf("failed %d, passed %v", outcome.failed, outcome.passed)
	}
}

func TestGCNeverTakesChecksOwnStackAsAnOrphan(t *testing.T) {
	plan := SelectGarbage(nil, GCSelection{Registered: []string{CheckSlug, "visualdiff-stray"}})
	if len(plan.OrphanSlugs) != 1 || plan.OrphanSlugs[0] != "visualdiff-stray" {
		t.Errorf("orphans = %v", plan.OrphanSlugs)
	}
}

func TestAFlowsSetupPostsItsPrerequisitesAndFilesWhatTheyAnswerUnderTheFlow(t *testing.T) {
	var bodies []map[string]any
	var keys []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		bodies, keys = append(bodies, body), append(keys, r.Header.Get("X-Auth-Token"))
		_, _ = w.Write([]byte(`{"agent":{"id":"agent_` + r.URL.Path[len(r.URL.Path)-1:] + `"}}`))
	}))
	t.Cleanup(server.Close)
	flows := []Flow{
		{ID: "plain"},
		{ID: "suite", Isolated: true, Setup: []SetupStep{
			{Post: "/api/agents/1", Body: map[string]any{"name": `in "{isolatedSlug}"`}, As: map[string]string{"agentId": "agent.id"}},
			{Post: "/api/suites/2", Body: map[string]any{"agent": "{agentId}"}},
		}},
	}

	captured, warnings := runFlowSetups(context.Background(), setupRequest{
		client: server.Client(), apiURL: server.URL, key: "sk-main",
		fixtures: map[string]string{FixtureIsolatedSlug: "iso", FixtureIsolatedKey: "sk-iso"}, flows: flows,
	})

	if len(warnings) != 0 || captured["suite/agentId"] != "agent_1" || len(captured) != 1 {
		t.Fatalf("captured %v, warnings %v", captured, warnings)
	}
	if bodies[0]["name"] != `in "iso"` || bodies[1]["agent"] != "agent_1" || keys[0] != "sk-iso" {
		t.Errorf("bodies %v, keys %v", bodies, keys)
	}
}

func TestCheckRefusesACheckoutWhoseInstallOrGeneratedFilesAreStale(t *testing.T) {
	root := t.TempDir()
	write := func(path string, at time.Time) {
		full := filepath.Join(root, path)
		if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(full, at, at); err != nil {
			t.Fatal(err)
		}
	}
	earlier, later := time.Now().Add(-time.Hour), time.Now()
	prepares := []checkoutPrepare{
		{output: "node_modules/.modules.yaml", inputs: []string{"pnpm-lock.yaml"}, command: "pnpm install"},
		{output: "sdks/typescript/dist/index.mjs", inputs: []string{"sdks/typescript/src"}, command: "pnpm ensure:built"},
	}
	write("node_modules/.modules.yaml", later)
	write("pnpm-lock.yaml", earlier)
	write("sdks/typescript/src/index.ts", earlier)
	write("sdks/typescript/dist/index.mjs", later)
	if err := checkoutUnprepared(root, prepares); err != nil {
		t.Fatalf("a prepared checkout was refused: %v", err)
	}

	write("pnpm-lock.yaml", later.Add(time.Minute))
	if err := os.Remove(filepath.Join(root, "sdks/typescript/dist/index.mjs")); err != nil {
		t.Fatal(err)
	}
	err := checkoutUnprepared(root, prepares)

	if err == nil || strings.Contains(err.Error(), "\n") {
		t.Fatalf("want one refusal line, got %v", err)
	}
	for _, want := range []string{"node_modules/.modules.yaml", "sdks/typescript/dist/index.mjs", "run pnpm install && pnpm ensure:built"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("refusal %q lacks %q", err, want)
		}
	}
}

func TestSharedStackLockMakesASecondLaneWait(t *testing.T) {
	dir := t.TempDir()
	unlock, err := lockCheckStack(dir, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	var waited bytes.Buffer
	acquired := make(chan func())
	go func() {
		second, err := lockCheckStack(dir, &waited)
		if err != nil {
			t.Error(err)
		}
		acquired <- second
	}()
	select {
	case <-acquired:
		t.Fatal("the second lane took the lock while the first held it")
	case <-time.After(200 * time.Millisecond):
	}
	unlock()
	(<-acquired)()
	if !strings.Contains(waited.String(), "waiting") {
		t.Fatalf("the waiting lane said nothing: %q", waited.String())
	}
}

func TestARunnerThatDroveNoCandidatePageIsOneRunnerFailure(t *testing.T) {
	replayed := RunnerStream{Captures: []Capture{{Side: "base"}}}
	if got := runnerFailure(replayed, errors.New("exit status 1")); got == "" {
		t.Fatal("base replays alone must count as a runner failure")
	}
	if got := runnerFailure(RunnerStream{}, nil); got == "" {
		t.Fatal("an empty stream must count as a runner failure")
	}
	drove := RunnerStream{Captures: []Capture{{Side: "base"}, {Side: "candidate"}}}
	if got := runnerFailure(drove, errors.New("exit status 1")); got != "" {
		t.Fatalf("a runner that drove pages is not a runner failure: %s", got)
	}
}
