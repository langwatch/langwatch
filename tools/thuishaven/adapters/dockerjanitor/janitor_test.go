package dockerjanitor

import (
	"context"
	"errors"
	"os/exec"
	"testing"
	"time"
)

// fakeRuntime scripts one exec.Cmd per docker invocation (printf/true/false
// stand in for the docker CLI) and records every argv it was asked for.
type fakeRuntime struct {
	isRunning     bool
	dockerHostErr error
	cmds          []*exec.Cmd
	dockerCalls   [][]string
}

func (f *fakeRuntime) IsRunning(context.Context) bool { return f.isRunning }
func (f *fakeRuntime) DockerHost(context.Context) (string, error) {
	return "unix:///fake.sock", f.dockerHostErr
}
func (f *fakeRuntime) Docker(_ context.Context, _ string, args ...string) *exec.Cmd {
	f.dockerCalls = append(f.dockerCalls, args)
	if len(f.cmds) == 0 {
		return exec.Command("true")
	}
	cmd := f.cmds[0]
	f.cmds = f.cmds[1:]
	return cmd
}

// listing builds the printf command that stands in for `docker ps` emitting
// the given tab-separated rows.
func listing(rows string) *exec.Cmd { return exec.Command("printf", "%s", rows) }

func expectArgv(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("argv = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("argv = %v, want %v", got, want)
		}
	}
}

// @scenario "A test container past the grace period is removed"
func TestReapRemovesLeakedContainers(t *testing.T) {
	t.Run("given a listing with one stale and one fresh container", func(t *testing.T) {
		rt := &fakeRuntime{isRunning: true, cmds: []*exec.Cmd{
			listing("abc123\texited\t2026-08-11 14:23:45 +0200 CEST\tlucid_goodall\torg.testcontainers=true\n" +
				"def456\texited\t2026-08-13 11:58:00 +0200 CEST\tfresh_one\torg.testcontainers=true\n"),
			exec.Command("true"),
		}}
		cutoff := time.Date(2026, 8, 13, 9, 0, 0, 0, time.UTC)

		names, err := New(rt).ReapTestContainers(context.Background(), cutoff, cutoff)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		t.Run("only the stale container is removed, by ID, with force", func(t *testing.T) {
			if len(rt.dockerCalls) != 2 {
				t.Fatalf("expected a listing and a removal, got %v", rt.dockerCalls)
			}
			expectArgv(t, rt.dockerCalls[1], []string{"rm", "-f", "-v", "abc123"})
		})

		t.Run("the removed container is reported by name", func(t *testing.T) {
			if len(names) != 1 || names[0] != "lucid_goodall" {
				t.Fatalf("names = %v, want [lucid_goodall]", names)
			}
		})
	})
}

func TestReapToleratesPartialFailures(t *testing.T) {
	cutoff := time.Date(2026, 8, 13, 9, 0, 0, 0, time.UTC)

	t.Run("given two leaked containers where the first rm fails", func(t *testing.T) {
		rt := &fakeRuntime{isRunning: true, cmds: []*exec.Cmd{
			listing("abc123\texited\t2026-08-11 14:23:45 +0200 CEST\tone\torg.testcontainers=true\n" +
				"def456\texited\t2026-08-11 14:23:45 +0200 CEST\ttwo\torg.testcontainers=true\n"),
			exec.Command("false"),
			exec.Command("true"),
		}}

		names, err := New(rt).ReapTestContainers(context.Background(), cutoff, cutoff)

		t.Run("the sweep continues past the failure and reports both outcomes", func(t *testing.T) {
			if err == nil {
				t.Fatal("expected the failed rm to surface as an error")
			}
			if len(names) != 1 || names[0] != "two" {
				t.Fatalf("expected the successful removal reported, got %v", names)
			}
			if len(rt.dockerCalls) != 3 {
				t.Fatalf("expected listing + two removals, got %v", rt.dockerCalls)
			}
		})
	})

	t.Run("given a container already gone by removal time", func(t *testing.T) {
		rt := &fakeRuntime{isRunning: true, cmds: []*exec.Cmd{
			listing("abc123\texited\t2026-08-11 14:23:45 +0200 CEST\tgone\torg.testcontainers=true\n"),
			exec.Command("sh", "-c", "echo 'Error: No such container: abc123' >&2; exit 1"),
		}}

		names, err := New(rt).ReapTestContainers(context.Background(), cutoff, cutoff)

		t.Run("the benign race is treated as success", func(t *testing.T) {
			if err != nil {
				t.Fatalf("a vanished container is not a failure, got %v", err)
			}
			if len(names) != 1 || names[0] != "gone" {
				t.Fatalf("names = %v, want [gone]", names)
			}
		})
	})
}

func TestReapPropagatesFailures(t *testing.T) {
	cutoff := time.Date(2026, 8, 13, 9, 0, 0, 0, time.UTC)

	t.Run("when the docker host cannot be resolved", func(t *testing.T) {
		rt := &fakeRuntime{isRunning: true, dockerHostErr: errors.New("no socket")}
		if _, err := New(rt).ReapTestContainers(context.Background(), cutoff, cutoff); err == nil {
			t.Fatal("expected the DockerHost error to propagate")
		}
	})

	t.Run("when the listing command fails", func(t *testing.T) {
		rt := &fakeRuntime{isRunning: true, cmds: []*exec.Cmd{exec.Command("false")}}
		if _, err := New(rt).ReapTestContainers(context.Background(), cutoff, cutoff); err == nil {
			t.Fatal("expected the ps failure to propagate")
		}
	})

	t.Run("when every listed row is undateable", func(t *testing.T) {
		rt := &fakeRuntime{isRunning: true, cmds: []*exec.Cmd{
			listing("abc123\trunning\tSOME NEW FORMAT\tone\torg.testcontainers=true\n"),
		}}
		if _, err := New(rt).ReapTestContainers(context.Background(), cutoff, cutoff); err == nil {
			t.Fatal("expected a blind sweep to surface as an error, not silence")
		}
	})
}

// @scenario "The sweep never boots the container VM"
func TestReapDoesNothingWhenTheVMIsDown(t *testing.T) {
	t.Run("given the container VM is not running", func(t *testing.T) {
		rt := &fakeRuntime{isRunning: false}

		t.Run("when the sweep runs", func(t *testing.T) {
			names, err := New(rt).ReapTestContainers(context.Background(), time.Now(), time.Now())
			if err != nil {
				t.Fatalf("expected a clean no-op, got %v", err)
			}
			if len(names) != 0 {
				t.Fatalf("expected nothing reaped, got %v", names)
			}
			if len(rt.dockerCalls) != 0 {
				t.Fatalf("expected no docker invocation at all, got %v", rt.dockerCalls)
			}
		})
	})
}

// @scenario "Only containers a test library marked as its own are candidates"
func TestReapListsOnlyLabeledContainers(t *testing.T) {
	t.Run("when the VM is running and the listing is empty", func(t *testing.T) {
		rt := &fakeRuntime{isRunning: true}

		if _, err := New(rt).ReapTestContainers(context.Background(), time.Now(), time.Now()); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		t.Run("the one docker call is a listing filtered on the testcontainers label", func(t *testing.T) {
			// The exclusion of haven's own containers rests entirely on this
			// docker-side filter — they never carry the label — so the full argv
			// is pinned, not just the presence of some filter flag.
			if len(rt.dockerCalls) != 1 {
				t.Fatalf("expected exactly the listing call, got %v", rt.dockerCalls)
			}
			expectArgv(t, rt.dockerCalls[0], []string{
				"ps", "-a",
				"--filter", "label=org.testcontainers=true",
				"--format", "{{.ID}}\t{{.State}}\t{{.CreatedAt}}\t{{.Names}}\t{{.Labels}}",
			})
		})
	})
}
