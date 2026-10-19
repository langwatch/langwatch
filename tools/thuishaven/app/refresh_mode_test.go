package app

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "The stack mode is not sticky"
func TestUpRestartsARunningStackWhenTheRefreshModeDiffers(t *testing.T) {
	cases := []struct {
		name        string
		running     domain.RefreshMode
		requested   domain.RefreshMode
		wantRestart bool
	}{
		{"a watch stack and a plain up", domain.RefreshWatch, domain.RefreshStill, true},
		{"a still stack and up --hmr", domain.RefreshStill, domain.RefreshHMR, true},
		{"a watch stack and up --watch", domain.RefreshWatch, domain.RefreshWatch, false},
		{"a still stack and a plain up", domain.RefreshStill, domain.RefreshStill, false},
	}
	for _, tc := range cases {
		t.Run("given "+tc.name, func(t *testing.T) {
			running := droppedStack(42)
			running.Refresh = tc.running
			store := &fakeStore{stacks: []domain.Stack{running}, slugCache: map[string]string{"/wt/feat-x": "feat-x"}}
			sys := &fakeSystem{alive: map[int]bool{42: true}}
			o, _ := deadStackOrch(store, sys, 0)
			opts := PlanOptions{Selection: domain.Selection{Refresh: tc.requested}}
			if proceed, err := o.reconcileRunningStack(UpParams{WorktreeDir: "/wt/feat-x", IsLinkedWorktree: true}, opts); err != nil || proceed != tc.wantRestart {
				t.Errorf("proceed = %v (%v), want %v", proceed, err, tc.wantRestart)
			}
		})
	}
}

// @scenario "Status names the stack mode"
func TestStatusNamesTheRefreshMode(t *testing.T) {
	o := statusOrch(&fakeStore{}, &fakeSystem{alive: map[int]bool{42: true}})
	for mode, want := range map[domain.RefreshMode]string{domain.RefreshStill: "still", domain.RefreshWatch: "watch", domain.RefreshHMR: "hmr"} {
		st := droppedStack(42)
		st.Refresh = mode
		if out := captureStdout(t, func() { o.printStacks(statusReport{stacks: []domain.Stack{st}}) }); !strings.Contains(out, "  refresh "+want+"\n") {
			t.Errorf("status output has no refresh %s line:\n%s", want, out)
		}
		if got := o.stackStatuses([]domain.Stack{st}); got[0].Refresh != want {
			t.Errorf("status --json refresh = %q, want %q", got[0].Refresh, want)
		}
	}
}
