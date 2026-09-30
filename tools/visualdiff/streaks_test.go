package visualdiff

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/diffkit"
)

func TestJudgeCaptureSeparatesHarnessErrorsFromFails(t *testing.T) {
	cases := []struct {
		name    string
		capture Capture
		want    captureVerdict
	}{
		{"a step that worked", Capture{Kind: "flow"}, captureWorked},
		{"a route that timed out", Capture{Kind: "route", Error: "page.goto: Timeout 30000ms exceeded"}, captureBroken},
		{"a route that could not connect", Capture{Kind: "route", Error: "net::ERR_CONNECTION_REFUSED"}, captureBroken},
		{"a closed browser", Capture{Kind: "flow", Error: "page.click: Target page, context or browser has been closed"}, captureBroken},
		{"sign-in that failed", Capture{Kind: "flow", Error: "sign-in: the form never appeared"}, captureBroken},
		{"a page whose modules failed", Capture{Kind: "flow", ModuleFailures: []string{"/src/x.tsx"}}, captureBroken},
		{"an expectation that failed", Capture{Kind: "flow", Expect: "text Saved", Error: "expect: text Saved not found"}, captureFailed},
		{"a locator that never matched", Capture{Kind: "flow", Error: "locator.click: Timeout 10000ms exceeded waiting for getByRole('button')"}, captureFailed},
	}
	for _, item := range cases {
		if got, _ := judgeCapture(item.capture); got != item.want {
			t.Errorf("%s: judged %d, want %d", item.name, got, item.want)
		}
	}
}

func brokenCapture(side string) Capture {
	return Capture{Kind: "route", Side: side, Error: "net::ERR_CONNECTION_REFUSED"}
}

func TestAStreakOfBrokenCapturesOnOneSideStops(t *testing.T) {
	streaks := newCaptureStreaks(3)
	for range 2 {
		if streaks.file(brokenCapture("candidate")) != nil {
			t.Fatal("stopped before the limit")
		}
		streaks.file(Capture{Side: "base"}) // the base working does not hide the candidate
	}
	stopped := streaks.file(brokenCapture("candidate"))
	if stopped == nil || !strings.Contains(stopped.Reason, "stopping: 3 consecutive errors, most common cause: net::ERR_CONNECTION_REFUSED (x3)") {
		t.Fatalf("stopped = %+v", stopped)
	}
}

func TestAFailedExpectationNeitherCountsNorResets(t *testing.T) {
	streaks := newCaptureStreaks(2)
	failed := Capture{Kind: "flow", Side: "candidate", Error: "expect: text Saved not found"}
	streaks.file(brokenCapture("candidate"))
	for range 5 {
		if streaks.file(failed) != nil {
			t.Fatal("a FAIL tripped the streak")
		}
	}
	if streaks.file(brokenCapture("candidate")) == nil {
		t.Fatal("a FAIL reset the streak")
	}
}

func TestZeroLimitNeverStops(t *testing.T) {
	streaks := newCaptureStreaks(0)
	for range 500 {
		if streaks.file(brokenCapture("candidate")) != nil {
			t.Fatal("a limit of 0 stopped the run")
		}
	}
}

func TestAStoppedRunWritesItsPartialResultsAndExitsThree(t *testing.T) {
	fake := &fakeRunner{}
	deps := passingDeps(fake, nil, nil)
	deps.Capture = func(context.Context, RunnerPlan, CaptureOptions) (RunnerStream, error) {
		return RunnerStream{}, &diffkit.Stopped{Reason: "stopping: 10 consecutive errors, most common cause: sign-in (x10)"}
	}
	options := testOptions(t)
	result, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard})
	if err == nil || err.Error() != "stopping: 10 consecutive errors, most common cause: sign-in (x10)" {
		t.Fatalf("err = %v", err)
	}
	if ExitCode(result, err) != diffkit.ExitStopped {
		t.Fatalf("exit %d, want %d", ExitCode(result, err), diffkit.ExitStopped)
	}
	if _, statErr := os.Stat(filepath.Join(options.RunDir, "summary.txt")); statErr != nil {
		t.Fatalf("the partial summary was not written: %v", statErr)
	}
}

func TestASetupFailureStopsAtOnceAndNamesTheCause(t *testing.T) {
	fake := &fakeRunner{}
	deps := passingDeps(fake, nil, nil)
	deps.Preflight = func(context.Context, string) error { return errors.New("cannot launch chromium") }
	captured := 0
	deps.Capture = func(context.Context, RunnerPlan, CaptureOptions) (RunnerStream, error) {
		captured++
		return RunnerStream{}, nil
	}
	result, err := Execute(context.Background(), Request{Options: testOptions(t), Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard})
	if err == nil || err.Error() != "stopping: setup failed: cannot launch chromium" {
		t.Fatalf("err = %v", err)
	}
	if captured != 0 || ExitCode(result, err) != ExitOperational {
		t.Fatalf("captured %d, exit %d", captured, ExitCode(result, err))
	}
}
