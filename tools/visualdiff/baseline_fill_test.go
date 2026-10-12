package visualdiff

import (
	"bytes"
	"context"
	"io"
	"path/filepath"
	"strings"
	"testing"
)

// @scenario "Main boots only for what its cached baseline lacks, and the baseline grows by it"
func TestMainBootsOnlyForWhatItsBaselineLacks(t *testing.T) {
	options, fake, deps := cachingRun(t)
	options.Editions = []Edition{EditionEnterprise}
	var handed []RunnerPlan
	deps.Capture = func(_ context.Context, plan RunnerPlan, _ CaptureOptions) (RunnerStream, error) {
		handed = append(handed, plan)
		var captures []Capture
		for _, side := range plan.Sides {
			for _, route := range plan.Routes {
				captures = append(captures, Capture{Kind: "route", Key: route, Side: side.Name})
			}
			for _, flow := range plan.Flows {
				captures = append(captures, Capture{Kind: "flow", Key: flow.ID, Side: side.Name})
			}
		}
		return RunnerStream{Captures: captures}, nil
	}
	execute := func(runDir string, config *Config) string {
		t.Helper()
		again := options
		again.RunDir = filepath.Join(options.Root, runDir)
		var stderr bytes.Buffer
		if _, err := Execute(context.Background(), Request{Options: again, Config: config, Deps: deps}, Streams{Out: io.Discard, Err: &stderr}); err != nil {
			t.Fatalf("Execute: %v", err)
		}
		return stderr.String()
	}
	execute("run", testConfig())

	t.Run("given a cached baseline, a run adding a route and changing a flow's steps", func(t *testing.T) {
		fake.commands, handed = nil, nil
		fake.haven.readyStacks["visualdiff-run2-base"] = "https://app.visualdiff-run2-base.langwatch.localhost"
		changed := testConfig()
		changed.Routes = append(changed.Routes, "/me")
		changed.Flows[1].Steps = []Step{{Action: "annotate"}, {Action: "expect", With: map[string]string{"text": "Saved"}}}
		stderr := execute("run2", changed)

		t.Run("then the run says what of main is cached and what is live and why", func(t *testing.T) {
			if !strings.Contains(stderr, "main: enterprise cached (3) / live (2, 1 new route(s); changed flow(s) annotate)") {
				t.Fatalf("no cached/live line:\n%s", stderr)
			}
		})
		t.Run("and main renders only the new route and the changed flow", func(t *testing.T) {
			if len(fake.matching("up --agent --detach")) != 2 {
				t.Fatalf("main was not booted for what it lacks: %v", fake.commands)
			}
			if len(handed) != 2 || len(handed[0].Sides) != 1 || handed[0].Sides[0].Name != "base" {
				t.Fatalf("want a base-only top-up then the diff, got %+v", handed)
			}
			if !equalStrings(handed[0].Routes, []string{"/me"}) || len(handed[0].Flows) != 1 || handed[0].Flows[0].ID != "annotate" {
				t.Fatalf("the top-up rendered %v and %v", handed[0].Routes, handed[0].Flows)
			}
		})
		t.Run("and the diff replays main from the grown baseline", func(t *testing.T) {
			replay := handed[1].Sides[0].Replay
			if replay == "" {
				t.Fatalf("the diff did not replay main: %+v", handed[1].Sides[0])
			}
			held, err := readBaselineCaptures(replay)
			if err != nil {
				t.Fatal(err)
			}
			if len(held) != 5 {
				t.Fatalf("the baseline holds %d captures, want the 4 it had with the changed flow replaced and /me added: %+v", len(held), held)
			}
			if !readBaselineMeta(filepath.Dir(replay)).Covers(changed.Routes, flowHashes(changed.Flows)) {
				t.Fatal("the baseline's meta does not cover what it now holds")
			}
		})
	})

	t.Run("when nothing is new, main does not boot", func(t *testing.T) {
		fake.commands, handed = nil, nil
		fake.haven.readyStacks["visualdiff-run3-candidate"] = "https://app.visualdiff-run3-candidate.langwatch.localhost"
		changed := testConfig()
		changed.Routes = append(changed.Routes, "/me")
		changed.Flows[1].Steps = []Step{{Action: "annotate"}, {Action: "expect", With: map[string]string{"text": "Saved"}}}
		stderr := execute("run3", changed)
		if len(fake.matching("up --agent --detach")) != 1 || !strings.Contains(stderr, "main: enterprise cached (5) / live (0)") {
			t.Fatalf("main booted with a complete baseline: %v\n%s", fake.commands, stderr)
		}
	})
}
