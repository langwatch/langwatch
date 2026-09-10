package visualdiff

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
)

// These cases bind the "A triage loop recaptures only the routes it fixed"
// scenario in specs/tooling/visualdiff-on-haven.feature.

// writeRunPlan persists a RunnerPlan at <runDir>/shots/plan.json, the same
// file RunRunner writes for a real run - what a recapture reads back to
// avoid re-deriving the stacks' URLs.
func writeRunPlan(t *testing.T, runDir string, plan RunnerPlan) {
	t.Helper()
	outDir := filepath.Join(runDir, "shots")
	if err := os.MkdirAll(outDir, 0o750); err != nil {
		t.Fatalf("mkdir shots dir: %v", err)
	}
	encoded, err := json.Marshal(plan)
	if err != nil {
		t.Fatalf("marshal plan: %v", err)
	}
	if err := os.WriteFile(filepath.Join(outDir, "plan.json"), encoded, 0o600); err != nil {
		t.Fatalf("write plan.json: %v", err)
	}
}

// @scenario "A triage loop recaptures only the routes it fixed"
func TestATriageLoopRecapturesOnlyTheRoutesItFixed(t *testing.T) {
	root := t.TempDir()
	writeCatalogue(t, root)
	runDir := filepath.Join(root, ".visualdiff", "20260910t0300")
	persistedPlan := RunnerPlan{
		Sides: []RunnerSide{
			{Name: "base", BaseURL: "https://app.visualdiff-20260910t0300-base.langwatch.localhost"},
			{Name: "candidate", BaseURL: "https://app.visualdiff-20260910t0300-candidate.langwatch.localhost"},
		},
		Slug:   "vd",
		Routes: []string{"/{slug}/analytics", "/{slug}/settings", "/{slug}/traces"},
		Flows:  []Flow{{ID: "prompt-create"}},
	}
	writeRunPlan(t, runDir, persistedPlan)

	// Seed findings.jsonl the way the original run would have, so the test
	// can assert a recapture appends after it rather than truncating it.
	findingsPath := filepath.Join(runDir, FindingsFile)
	writer, err := OpenFindingsFile(findingsPath)
	if err != nil {
		t.Fatalf("OpenFindingsFile: %v", err)
	}
	if err := writer.WriteLine(Finding{Kind: FindingChanged, Route: "/{slug}/settings"}); err != nil {
		t.Fatalf("seed WriteLine: %v", err)
	}
	writer.Close()

	var sawPlan RunnerPlan
	capture := scriptedCapture(
		[]Capture{
			{Kind: "route", Key: "/{slug}/settings", Side: "base", Screenshot: "/x/base.png"},
			{Kind: "route", Key: "/{slug}/settings", Side: "candidate", Screenshot: "/x/candidate.png"},
		},
		[]Diff{{Kind: "route", Key: "/{slug}/settings", Ratio: 0.0, File: "/x/diff.png"}},
	)
	runCalled := false
	deps := Deps{
		Capture: func(ctx context.Context, plan RunnerPlan, options CaptureOptions) (RunnerStream, error) {
			sawPlan = plan
			return capture(ctx, plan, options)
		},
		Run: func(context.Context, commandSpec, io.Writer) error {
			t.Fatal("recapture must never run a shell command - no checkout, no haven up, nothing")
			return nil
		},
	}
	deps.fill()

	t.Run("given a run was started with -keep, so its two haven stacks are still up", func(t *testing.T) {
		t.Run(`when "visualdiff recapture -run RUNID -routes a,b,c" runs`, func(t *testing.T) {
			result, err := Recapture(context.Background(),
				RecaptureRequest{Root: root, RunID: "20260910t0300", Routes: []string{"/{slug}/settings"}, Deps: deps},
				Streams{Out: os.Stdout, Err: os.Stderr})
			if err != nil {
				t.Fatalf("Recapture: %v", err)
			}
			runCalled = true

			t.Run("then it reads that run's own persisted plan for the two stacks' URLs", func(t *testing.T) {
				if len(sawPlan.Sides) != 2 || sawPlan.Sides[0].BaseURL != persistedPlan.Sides[0].BaseURL || sawPlan.Sides[1].BaseURL != persistedPlan.Sides[1].BaseURL {
					t.Fatalf("recapture plan sides = %+v, want the persisted run's own URLs", sawPlan.Sides)
				}
			})

			t.Run("and it captures only the named routes", func(t *testing.T) {
				if len(sawPlan.Routes) != 1 || sawPlan.Routes[0] != "/{slug}/settings" {
					t.Errorf("recapture routes = %v, want only the requested one", sawPlan.Routes)
				}
				if len(sawPlan.Flows) != 0 {
					t.Errorf("recapture must not replay flows: %v", sawPlan.Flows)
				}
			})

			t.Run("and its findings are appended after whatever the run itself already wrote", func(t *testing.T) {
				raw, err := os.ReadFile(findingsPath)
				if err != nil {
					t.Fatalf("read findings file: %v", err)
				}
				lines := splitNonEmptyLines(string(raw))
				if len(lines) < 2 {
					t.Fatalf("expected the seeded line plus at least the recapture's own, got %d:\n%s", len(lines), raw)
				}
				var first Finding
				if err := json.Unmarshal([]byte(lines[0]), &first); err != nil || first.Route != "/{slug}/settings" || first.Kind != FindingChanged {
					t.Fatalf("first (seeded) line was overwritten: %s", lines[0])
				}
			})

			t.Run("and its own findings reflect the recapture's own comparison", func(t *testing.T) {
				if result.FindingsPath != findingsPath {
					t.Errorf("FindingsPath = %q, want %q", result.FindingsPath, findingsPath)
				}
			})
		})
	})

	if !runCalled {
		t.Fatal("Recapture never actually ran")
	}
}

// @scenario "A triage loop recaptures only the routes it fixed"
func TestRecaptureRequiresRunAndRoutes(t *testing.T) {
	root := t.TempDir()
	deps := Deps{}
	deps.fill()

	t.Run("given no -run", func(t *testing.T) {
		_, err := Recapture(context.Background(), RecaptureRequest{Root: root, Routes: []string{"/a"}, Deps: deps}, Streams{Out: os.Stdout, Err: os.Stderr})
		if err == nil {
			t.Fatal("expected an error when -run is empty")
		}
	})

	t.Run("given no -routes", func(t *testing.T) {
		_, err := Recapture(context.Background(), RecaptureRequest{Root: root, RunID: "x", Deps: deps}, Streams{Out: os.Stdout, Err: os.Stderr})
		if err == nil {
			t.Fatal("expected an error when -routes is empty")
		}
	})
}
