package app

import (
	"errors"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "A lane resolves to the process listening on its port"
func TestNodeLane(t *testing.T) {
	fixture := func(pids map[int][]int) *Orchestrator {
		store := &fakeStore{stacks: []domain.Stack{restartStack()}}
		return restartOrch(store, &fakeSystem{alive: map[int]bool{42: true}, pidsByPort: pids})
	}

	t.Run("the api lane is the process on the API port, and says it also serves the workers", func(t *testing.T) {
		o := fixture(map[int][]int{9000: {100}, 9100: {102}, 9200: {102}})
		nl, err := o.NodeLane("feat-x", "")
		if err != nil {
			t.Fatal(err)
		}
		if nl.Lane != APILane || nl.PID != 102 || nl.Port != 9100 || nl.WorktreeDir != "/wt/feat-x" {
			t.Errorf("got %+v, want the api lane on 9100, pid 102", nl)
		}
		if !slices.Equal(nl.SharedWith, []string{WorkersLane}) {
			t.Errorf("shared with %v, want [workers]", nl.SharedWith)
		}
	})

	t.Run("a workers lane run apart is its own process", func(t *testing.T) {
		o := fixture(map[int][]int{9000: {100}, 9100: {102}, 9200: {103}})
		nl, err := o.NodeLane("feat-x", WorkersLane)
		if err != nil || nl.PID != 103 || len(nl.SharedWith) != 0 {
			t.Errorf("got %+v, %v; want pid 103 alone", nl, err)
		}
	})

	t.Run("an unknown lane names the lanes the stack has", func(t *testing.T) {
		_, err := fixture(nil).NodeLane("feat-x", "gateway")
		if !errors.Is(err, ErrUnknownLane) || !strings.Contains(err.Error(), "ui, api, workers") {
			t.Errorf("err = %v", err)
		}
	})

	t.Run("a lane with nothing listening is not running", func(t *testing.T) {
		_, err := fixture(map[int][]int{}).NodeLane("feat-x", "api")
		if !errors.Is(err, ErrLaneNotRunning) {
			t.Errorf("err = %v", err)
		}
	})

	t.Run("a stack whose launcher is gone is not running", func(t *testing.T) {
		store := &fakeStore{stacks: []domain.Stack{restartStack()}}
		o := restartOrch(store, &fakeSystem{alive: map[int]bool{}})
		if _, err := o.NodeLane("feat-x", "api"); !errors.Is(err, ErrStackNotRunning) {
			t.Errorf("err = %v", err)
		}
		if _, err := o.NodeLane("nope", "api"); !errors.Is(err, ErrStackNotRunning) {
			t.Errorf("unregistered stack: err = %v", err)
		}
	})

	t.Run("profiles are saved under the stack's checkout", func(t *testing.T) {
		o := fixture(nil)
		if got := o.ProfileDir("feat-x", "/elsewhere"); got != "/wt/feat-x/.claude/tmp/haven-profiles/feat-x" {
			t.Errorf("ProfileDir = %q", got)
		}
		if got := o.ProfileDir("gone", "/elsewhere"); got != "/elsewhere/.claude/tmp/haven-profiles/gone" {
			t.Errorf("ProfileDir of an unregistered stack = %q", got)
		}
	})
}
