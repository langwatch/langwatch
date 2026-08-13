package dockerjanitor

import (
	"context"
	"os/exec"
	"testing"
	"time"
)

// fakeRuntime records docker invocations; the returned commands are real
// exec.Cmds against /usr/bin/true so Run()/Output() succeed without docker.
type fakeRuntime struct {
	running     bool
	dockerCalls [][]string
}

func (f *fakeRuntime) IsRunning(context.Context) bool             { return f.running }
func (f *fakeRuntime) DockerHost(context.Context) (string, error) { return "unix:///fake.sock", nil }
func (f *fakeRuntime) Docker(_ context.Context, _ string, args ...string) *exec.Cmd {
	f.dockerCalls = append(f.dockerCalls, args)
	return exec.Command("true")
}

// @scenario "The sweep never boots the container VM"
func TestReapDoesNothingWhenTheVMIsDown(t *testing.T) {
	t.Run("given the container VM is not running", func(t *testing.T) {
		rt := &fakeRuntime{running: false}

		t.Run("when the sweep runs", func(t *testing.T) {
			names, err := New(rt).ReapTestContainers(context.Background(), time.Now())
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
		rt := &fakeRuntime{running: true}

		if _, err := New(rt).ReapTestContainers(context.Background(), time.Now()); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		t.Run("the one docker call filters on the testcontainers label", func(t *testing.T) {
			if len(rt.dockerCalls) != 1 {
				t.Fatalf("expected exactly the listing call, got %v", rt.dockerCalls)
			}
			args := rt.dockerCalls[0]
			found := false
			for _, a := range args {
				if a == "label=org.testcontainers=true" {
					found = true
				}
			}
			if !found {
				t.Fatalf("listing must filter on the testcontainers label, got %v", args)
			}
		})
	})
}
