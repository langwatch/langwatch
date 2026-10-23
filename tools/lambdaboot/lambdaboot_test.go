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
	workdir string // the image's WorkingDir; empty means the default, /
	noPort  bool   // `port` prints nothing, as for a process that already exited
	// entries answers Stat for each path in the image; a missing path fails.
	entries map[string]lambdaboot.Entry
	stats   []string
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
		if f.noPort {
			return "", nil
		}
		return "127.0.0.1:49153\n[::1]:49153", nil
	case "image":
		return f.workdir, nil
	case "create":
		return "probe-1", nil
	case "inspect":
		return f.running, nil
	case "logs":
		return f.logs, nil
	case "rm":
		return "", nil
	}
	return "", errors.New("unexpected docker call: " + strings.Join(args, " "))
}

func (f *fakeDocker) stat(_ context.Context, _ string, path string) (lambdaboot.Entry, error) {
	f.stats = append(f.stats, path)
	e, ok := f.entries[path]
	if !ok {
		return lambdaboot.Entry{}, errors.New("no such path in the image: " + path)
	}
	return e, nil
}

func (f *fakeDocker) runtime(probe lambdaboot.Probe) lambdaboot.Runtime {
	return lambdaboot.Runtime{Docker: f.docker, Probe: probe, Stat: f.stat}
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

// @scenario "The boot check passes an image that serves its health check as a foreign user"
func TestCheckWhenTheImageAnswersAsAForeignUser(t *testing.T) {
	d := &fakeDocker{running: "true 0"}
	probe, urls := probeAnswers(0, 503, 200)

	if err := lambdaboot.Check(context.Background(), options(), d.runtime(probe)); err != nil {
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

// @scenario "The boot check fails an image that cannot start as a foreign user"
func TestCheckWhenTheContainerCannotStart(t *testing.T) {
	d := &fakeDocker{runErr: errors.New(`chdir to cwd ("/home/nonroot") set in config.json failed: permission denied`)}
	probe, urls := probeAnswers(200)

	err := lambdaboot.Check(context.Background(), options(), d.runtime(probe))

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

// @scenario "The boot check fails at once when the image's process exits"
func TestCheckWhenTheProcessExits(t *testing.T) {
	d := &fakeDocker{running: "false 2", logs: "nlpgo: listen tcp :8080: bind: permission denied"}
	probe, _ := probeAnswers(0)
	opts := options()
	opts.Timeout = time.Minute

	start := time.Now()
	err := lambdaboot.Check(context.Background(), opts, d.runtime(probe))

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

// @scenario "The boot check fails an image that never answers its health check"
func TestCheckWhenTheHealthCheckNeverAnswers(t *testing.T) {
	d := &fakeDocker{running: "true 0", logs: "waiting for something"}
	probe, _ := probeAnswers(503)
	opts := options()
	opts.Timeout = 50 * time.Millisecond

	err := lambdaboot.Check(context.Background(), opts, d.runtime(probe))

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
	for _, user := range []string{"", "0", "0:0", "root", "00:9999", "+0:9999", "-1:9999", "9999", "9999:", "nobody:9999"} {
		opts := options()
		opts.User = user
		d := &fakeDocker{running: "true 0"}
		probe, _ := probeAnswers(200)
		if err := lambdaboot.Check(context.Background(), opts, d.runtime(probe)); err == nil {
			t.Errorf("User %q: Check() = nil, want a refusal", user)
		}
		if slices.ContainsFunc(d.calls, func(c []string) bool { return c[0] == "run" }) {
			t.Errorf("User %q: started a container", user)
		}
	}
}

// @scenario "The boot check refuses a working directory a foreign user cannot enter"
func TestCheckWhenTheWorkingDirectoryIsPrivateToTheImagesUser(t *testing.T) {
	d := &fakeDocker{running: "true 0", workdir: "/home/nonroot", entries: map[string]lambdaboot.Entry{
		"/home":         {Mode: 0o755, UID: 0, GID: 0},
		"/home/nonroot": {Mode: 0o700, UID: 65532, GID: 65532},
	}}
	probe, urls := probeAnswers(200)

	err := lambdaboot.Check(context.Background(), options(), d.runtime(probe))

	if err == nil {
		t.Fatal("Check() = nil, want a failure")
	}
	for _, want := range []string{"/home/nonroot", "9999:9999", "permission denied"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("error %q lacks %q", err, want)
		}
	}
	if d.called("run") != nil || len(*urls) != 0 {
		t.Error("booted an image whose working directory the user cannot enter")
	}
	if d.called("rm") == nil {
		t.Error("the container created to read the image was not removed")
	}
}

func TestCheckWhenADirectoryAboveTheWorkingDirectoryIsPrivate(t *testing.T) {
	d := &fakeDocker{running: "true 0", workdir: "/srv/app", entries: map[string]lambdaboot.Entry{
		"/srv":     {Mode: 0o750, UID: 0, GID: 0},
		"/srv/app": {Mode: 0o755, UID: 0, GID: 0},
	}}
	probe, _ := probeAnswers(200)

	err := lambdaboot.Check(context.Background(), options(), d.runtime(probe))

	if err == nil || !strings.Contains(err.Error(), "/srv ") {
		t.Errorf("Check() = %v, want a failure naming /srv", err)
	}
}

func TestCheckWhenTheWorkingDirectoryIsOpenToEveryUser(t *testing.T) {
	d := &fakeDocker{running: "true 0", workdir: "/srv/app", entries: map[string]lambdaboot.Entry{
		"/srv":     {Mode: 0o711, UID: 0, GID: 0},
		"/srv/app": {Mode: 0o755, UID: 65532, GID: 65532},
	}}
	probe, _ := probeAnswers(200)

	if err := lambdaboot.Check(context.Background(), options(), d.runtime(probe)); err != nil {
		t.Fatalf("Check() = %v, want nil", err)
	}
	if !slices.Equal(d.stats, []string{"/srv", "/srv/app"}) {
		t.Errorf("read %v, want every directory down to the working directory", d.stats)
	}
}

func TestCheckWhenTheWorkingDirectoryIsTheRoot(t *testing.T) {
	d := &fakeDocker{running: "true 0", workdir: "/"}
	probe, _ := probeAnswers(200)

	if err := lambdaboot.Check(context.Background(), options(), d.runtime(probe)); err != nil {
		t.Fatalf("Check() = %v, want nil", err)
	}
	if d.called("create") != nil {
		t.Error("created a container to read / when there is nothing to check")
	}
}

func TestCheckBoundsTheWholeCheckIncludingDockerItself(t *testing.T) {
	var sawDeadline bool
	d := &fakeDocker{running: "true 0"}
	rt := d.runtime(func(context.Context, string) (int, error) { return 200, nil })
	inner := rt.Docker
	rt.Docker = func(ctx context.Context, args ...string) (string, error) {
		if args[0] == "run" {
			_, sawDeadline = ctx.Deadline()
		}
		return inner(ctx, args...)
	}

	if err := lambdaboot.Check(context.Background(), options(), rt); err != nil {
		t.Fatalf("Check() = %v, want nil", err)
	}
	if !sawDeadline {
		t.Error("docker run ran without the timeout, so a stalled docker could outlast it")
	}
}

func TestCheckWhenTheProcessExitsBeforeItsPortIsPublished(t *testing.T) {
	d := &fakeDocker{running: "false 1", noPort: true, logs: "nlpgo: open /home/nonroot: permission denied"}
	probe, _ := probeAnswers(200)

	err := lambdaboot.Check(context.Background(), options(), d.runtime(probe))

	if err == nil || !strings.Contains(err.Error(), "exited with code 1") {
		t.Errorf("Check() = %v, want the exit, not a missing port", err)
	}
}

func TestCheckWhenDockerRunFailsStillRemovesTheContainer(t *testing.T) {
	d := &fakeDocker{runErr: errors.New("exec format error")}
	probe, _ := probeAnswers(200)

	if err := lambdaboot.Check(context.Background(), options(), d.runtime(probe)); err == nil {
		t.Fatal("Check() = nil, want a failure")
	}
	run, rm := d.called("run"), d.called("rm")
	if rm == nil {
		t.Fatal("a failed docker run left its container behind")
	}
	if name := run[slices.Index(run, "--name")+1]; rm[len(rm)-1] != name {
		t.Errorf("removed %q, want the container docker run named %q", rm[len(rm)-1], name)
	}
}
