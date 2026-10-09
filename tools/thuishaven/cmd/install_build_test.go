package cmd

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

func TestABuildStepIsQuietUntilItFailsThenShowsItsLogTail(t *testing.T) {
	var out bytes.Buffer
	run := buildRun{w: &out, logDir: t.TempDir(), steps: []buildStep{
		{label: "building ok-web", argv: []string{"sh", "-c", "echo nx noise"}, optional: true},
		{label: "building bad-web", argv: []string{"sh", "-c", "echo first; echo the real error; exit 3"}, optional: true},
	}}
	if err := runBuildSteps(context.Background(), run); err != nil {
		t.Fatalf("an optional step failing must not fail the run: %v", err)
	}
	got := out.String()
	if strings.Contains(got, "nx noise") {
		t.Errorf("a passing step's output belongs in its log, not on screen:\n%s", got)
	}
	for _, want := range []string{"building ok-web (1/2)", "building bad-web (2/2)", "the real error", "building-bad-web.log", "not built: bad-web"} {
		if !strings.Contains(got, want) {
			t.Errorf("output lacks %q:\n%s", want, got)
		}
	}
}

func TestARequiredBuildStepFailingStopsTheRun(t *testing.T) {
	var out bytes.Buffer
	run := buildRun{w: &out, logDir: t.TempDir(), steps: []buildStep{
		{label: "installing the haven binary", argv: []string{"sh", "-c", "exit 1"}},
		{label: "building never-web", argv: []string{"sh", "-c", "true"}, optional: true},
	}}
	if err := runBuildSteps(context.Background(), run); err == nil {
		t.Fatal("a failed go install must fail the run")
	}
	if strings.Contains(out.String(), "never-web") {
		t.Errorf("nothing runs after a required step fails:\n%s", out.String())
	}
}
