package fuzz

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

func newFileRun(limit int) (*apiRun, *bool) {
	cancelled := false
	return &apiRun{streak: diffkit.NewStreak(limit), cancel: func() { cancelled = true }}, &cancelled
}

func TestATransportErrorStreakStopsTheRunAtN(t *testing.T) {
	run, cancelled := newFileRun(3)
	run.file("connection refused")
	run.file("connection refused")
	if *cancelled {
		t.Fatal("cancelled before the limit")
	}
	run.file("connection refused")
	if !*cancelled || run.streak.Stopped() == nil {
		t.Fatal("did not stop at the limit")
	}
	want := "stopping: 3 consecutive errors, most common cause: connection refused (x3)"
	if run.streak.Stopped().Reason != want {
		t.Fatalf("reason %q", run.streak.Stopped().Reason)
	}
}

func TestAnAnswerEndsTheStreakWhateverItsStatus(t *testing.T) {
	run, cancelled := newFileRun(2)
	run.file("timeout")
	run.file("") // a 5xx is an answer: a finding, not a harness error
	run.file("timeout")
	if *cancelled {
		t.Fatal("an answered request did not end the streak")
	}
}

func TestZeroDisablesTheAPIStreak(t *testing.T) {
	run, cancelled := newFileRun(0)
	for range 1000 {
		run.file("timeout")
	}
	if *cancelled {
		t.Fatal("a limit of 0 stopped the run")
	}
}

func TestTheLimitDefaultsPerModeUnlessGiven(t *testing.T) {
	if got := (Options{MaxConsecutiveErrors: -1}).errorLimit(DefaultUIMaxErrors); got != 10 {
		t.Errorf("ui default %d", got)
	}
	if got := (Options{MaxConsecutiveErrors: 0}).errorLimit(DefaultAPIMaxErrors); got != 0 {
		t.Errorf("0 must disable, got %d", got)
	}
	if got := (Options{MaxConsecutiveErrors: 7}).errorLimit(DefaultAPIMaxErrors); got != 7 {
		t.Errorf("given limit %d", got)
	}
}

func TestATransportCauseDropsTheURL(t *testing.T) {
	err := &url.Error{Op: "Get", URL: "https://x/api/a", Err: errors.New("connection refused")}
	if got := transportCause(err); got != "connection refused" {
		t.Fatal(got)
	}
}

func TestAStoppedRunExitsThreeAndPrintsItsReason(t *testing.T) {
	var out bytes.Buffer
	run := func(context.Context, Streams, Options) error {
		return &diffkit.Stopped{Reason: "stopping: 200 consecutive errors, most common cause: timeout (x200)"}
	}
	code := runOrReport(context.Background(), Streams{Err: &out}, Options{Mode: "api"}, run)
	if code != diffkit.ExitStopped || strings.TrimSpace(out.String()) != "fuzz api: stopping: 200 consecutive errors, most common cause: timeout (x200)" {
		t.Fatalf("code %d, %q", code, out.String())
	}
}

func TestARunnerThatAlreadyPrintedItsStopIsNotPrintedTwice(t *testing.T) {
	var out bytes.Buffer
	run := func(context.Context, Streams, Options) error { return &diffkit.Stopped{} }
	if code := runOrReport(context.Background(), Streams{Err: &out}, Options{Mode: "ui"}, run); code != diffkit.ExitStopped || out.Len() != 0 {
		t.Fatalf("code %d, %q", code, out.String())
	}
}

func TestASetupFailureStopsBeforeAnyRequestIsFuzzed(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	server.Close()
	var out bytes.Buffer
	options := Options{Mode: "api", URL: server.URL, Root: t.TempDir(), Duration: time.Second, MaxConsecutiveErrors: -1}
	code := runOrReport(context.Background(), Streams{Err: &out, Out: &bytes.Buffer{}}, options, runAPI)
	if code != 1 || !strings.Contains(out.String(), "fuzz api: stopping: setup failed: seed fuzzer org:") {
		t.Fatalf("code %d, %q", code, out.String())
	}
}
