package lambdaboot_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/lambdaboot"
)

// fakeDocker answers each docker subcommand from a script and records every call.
type fakeDocker struct {
	runErr  error
	running string // what `inspect` prints: "true 0" or "false <exit code>"
	logs    string
	calls   [][]string
}

func (f *fakeDocker) docker(_ context.Context, args ...string) (string, error) {
	f.calls = append(f.calls, args)
	switch args[0] {
	case "run":
		if f.runErr != nil {
			return "", f.runErr
		}
		return "container-1", nil
	case "port":
		return "127.0.0.1:49153\n[::1]:49153", nil
	case "inspect":
		return f.running, nil
	case "logs":
		return f.logs, nil
	case "rm":
		return "", nil
	}
	return "", errors.New("unexpected docker call: " + strings.Join(args, " "))
}

func (f *fakeDocker) called(sub string) []string {
	for _, call := range f.calls {
		if call[0] == sub {
			return call
		}
	}
	return nil
}

// probeAnswers returns each status in turn, then repeats the last.
func probeAnswers(statuses ...int) (lambdaboot.Probe, *[]string) {
	var urls []string
	i := 0
	return func(_ context.Context, url string) (int, error) {
		urls = append(urls, url)
		status := statuses[min(i, len(statuses)-1)]
		i++
		if status == 0 {
			return 0, errors.New("connection refused")
		}
		return status, nil
	}, &urls
}

func options() lambdaboot.Options {
	return lambdaboot.Options{
		Image:    "registry.example/langwatch-nlp-lambda:git-abc",
		User:     "9999:9999",
		Port:     8080,
		Path:     "/healthz",
		Env:      []string{"STUDIO_RUNTIME=async"},
		Timeout:  2 * time.Second,
		Interval: time.Millisecond,
	}
}

// @scenario "A Lambda image that serves its health check as a foreign user is pushed"
func TestCheckWhenTheImageAnswersAsAForeignUser(t *testing.T) {
	d := &fakeDocker{running: "true 0"}
	probe, urls := probeAnswers(0, 503, 200)

	if err := lambdaboot.Check(context.Background(), options(), lambdaboot.Runtime{Docker: d.docker, Probe: probe}); err != nil {
		t.Fatalf("Check() = %v, want nil", err)
	}

	run := strings.Join(d.called("run"), " ")
	for _, want := range []string{
		"--user 9999:9999",
		"--read-only",
		"--tmpfs /tmp",
		"-p 127.0.0.1::8080",
		"-e STUDIO_RUNTIME=async",
		"registry.example/langwatch-nlp-lambda:git-abc",
	} {
		if !strings.Contains(run, want) {
			t.Errorf("docker run %q lacks %q", run, want)
		}
	}
	if got := (*urls)[len(*urls)-1]; got != "http://127.0.0.1:49153/healthz" {
		t.Errorf("probed %q, want the published port's /healthz", got)
	}
	if d.called("rm") == nil {
		t.Error("the container was not removed")
	}
}

// @scenario "A Lambda image that cannot start as a foreign user is never pushed"
func TestCheckWhenTheContainerCannotStart(t *testing.T) {
	d := &fakeDocker{runErr: errors.New(`chdir to cwd ("/home/nonroot") set in config.json failed: permission denied`)}
	probe, urls := probeAnswers(200)

	err := lambdaboot.Check(context.Background(), options(), lambdaboot.Runtime{Docker: d.docker, Probe: probe})

	if err == nil {
		t.Fatal("Check() = nil, want a failure")
	}
	for _, want := range []string{"langwatch-nlp-lambda:git-abc", "permission denied"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q lacks %q", err, want)
		}
	}
	if len(*urls) != 0 {
		t.Errorf("probed %v after a failed start", *urls)
	}
}

// @scenario "A Lambda image whose process exits during the boot check fails at once"
func TestCheckWhenTheProcessExits(t *testing.T) {
	d := &fakeDocker{running: "false 2", logs: "nlpgo: listen tcp :8080: bind: permission denied"}
	probe, _ := probeAnswers(0)
	opts := options()
	opts.Timeout = time.Minute

	start := time.Now()
	err := lambdaboot.Check(context.Background(), opts, lambdaboot.Runtime{Docker: d.docker, Probe: probe})

	if err == nil {
		t.Fatal("Check() = nil, want a failure")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Errorf("took %s, want an early failure, not the bound", elapsed)
	}
	for _, want := range []string{"exited with code 2", "bind: permission denied"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q lacks %q", err, want)
		}
	}
	if d.called("rm") == nil {
		t.Error("the container was not removed")
	}
}

// @scenario "A Lambda image that never answers its health check fails within the bound"
func TestCheckWhenTheHealthCheckNeverAnswers(t *testing.T) {
	d := &fakeDocker{running: "true 0", logs: "waiting for something"}
	probe, _ := probeAnswers(503)
	opts := options()
	opts.Timeout = 50 * time.Millisecond

	err := lambdaboot.Check(context.Background(), opts, lambdaboot.Runtime{Docker: d.docker, Probe: probe})

	if err == nil {
		t.Fatal("Check() = nil, want a failure")
	}
	for _, want := range []string{"did not answer", "/healthz", "50ms", "waiting for something"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q lacks %q", err, want)
		}
	}
	if d.called("rm") == nil {
		t.Error("the container was not removed")
	}
}

func TestCheckRefusesTheImagesOwnUserOrRoot(t *testing.T) {
	for _, user := range []string{"", "0", "0:0", "root"} {
		opts := options()
		opts.User = user
		d := &fakeDocker{running: "true 0"}
		probe, _ := probeAnswers(200)
		if err := lambdaboot.Check(context.Background(), opts, lambdaboot.Runtime{Docker: d.docker, Probe: probe}); err == nil {
			t.Errorf("User %q: Check() = nil, want a refusal", user)
		}
		if slices.ContainsFunc(d.calls, func(c []string) bool { return c[0] == "run" }) {
			t.Errorf("User %q: started a container", user)
		}
	}
}
