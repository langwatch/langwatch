package cmd

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

// fakeNx prints what nx --outputStyle=static prints, so no real nx runs.
const fakeNx = `echo ' NX   Running target build for 3 projects:'
echo '> nx run @langwatch/a-web:build  [local cache]'
echo 'vite noise'
echo '> nx run @langwatch/b-web:build'
echo '> nx run @langwatch/c-web:build  [local cache]'`

func TestAnNxStepSummarisesCountsAndKeepsNxNoiseInItsLog(t *testing.T) {
	var out bytes.Buffer
	dir := t.TempDir()
	run := buildRun{w: &out, logDir: dir, steps: []buildStep{
		{running: "building haven consoles", done: "haven consoles built", log: "haven-web.log", argv: []string{"sh", "-c", fakeNx}, nx: true},
	}}
	if err := runBuildSteps(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	got := out.String()
	if !strings.Contains(got, "haven consoles built (3, 2 cached)") {
		t.Errorf("summary lacks the counts:\n%s", got)
	}
	if strings.Contains(got, "vite noise") || strings.Count(got, "\n") != 1 {
		t.Errorf("a pipe gets the summary line only:\n%s", got)
	}
}

func TestAFailedConsoleStepShowsItsLogTailAndTheRunCarriesOn(t *testing.T) {
	var out bytes.Buffer
	run := buildRun{w: &out, logDir: t.TempDir(), steps: []buildStep{
		{running: "building bad", done: "bad built", log: "bad.log", argv: []string{"sh", "-c", "echo first; echo the real error; exit 3"}, optional: true},
		{running: "installing ok", done: "ok installed", log: "ok.log", argv: []string{"sh", "-c", "true"}},
	}}
	if err := runBuildSteps(context.Background(), run); err != nil {
		t.Fatalf("an optional step failing must not fail the run: %v", err)
	}
	got := out.String()
	for _, want := range []string{"building bad failed", "the real error", "bad.log", "names 'make haven-web'", "ok installed"} {
		if !strings.Contains(got, want) {
			t.Errorf("output lacks %q:\n%s", want, got)
		}
	}
}

func TestARequiredBuildStepFailingStopsTheRun(t *testing.T) {
	var out bytes.Buffer
	run := buildRun{w: &out, logDir: t.TempDir(), steps: []buildStep{
		{running: "installing the haven binary", done: "installed", log: "go.log", argv: []string{"sh", "-c", "exit 1"}},
		{running: "building never", done: "never built", log: "never.log", argv: []string{"sh", "-c", "true"}, optional: true},
	}}
	if err := runBuildSteps(context.Background(), run); err == nil {
		t.Fatal("a failed go install must fail the run")
	}
	if strings.Contains(out.String(), "never") {
		t.Errorf("nothing runs after a required step fails:\n%s", out.String())
	}
}
