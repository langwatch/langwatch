package app

import (
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func modeStack(mode string, env ...string) domain.Stack {
	st := droppedStack(42)
	st.Mode, st.ModeEnv = mode, env
	return st
}

func modeRequest(mode string, env ...string) PlanOptions {
	return PlanOptions{
		Selection:      domain.Selection{Mode: mode},
		DeploymentMode: domain.DeploymentMode{Name: mode, Env: env},
	}
}

// A mode term missing from the "already matches" comparison turns `haven up
// --mode <other>` into a silent no-op while the stack keeps its old values.
// @scenario "haven up --mode on a running stack restarts it only when the mode differs"
func TestUpRestartsARunningStackOnlyWhenTheModeDiffers(t *testing.T) {
	cases := []struct {
		name        string
		running     domain.Stack
		requested   PlanOptions
		wantRestart bool
	}{
		{"a different mode", modeStack("saas", "IS_SAAS=true"), modeRequest("sh-free", "IS_SAAS=false"), true},
		{"the mode cleared with none", modeStack("saas", "IS_SAAS=true"), modeRequest(""), true},
		{"the same mode with edited values", modeStack("saas", "IS_SAAS=true"), modeRequest("saas", "IS_SAAS=false"), true},
		{"the same mode and values", modeStack("saas", "IS_SAAS=true"), modeRequest("saas", "IS_SAAS=true"), false},
		{"no mode on either side", modeStack(""), modeRequest(""), false},
	}
	for _, tc := range cases {
		t.Run("given "+tc.name, func(t *testing.T) {
			store := &fakeStore{
				stacks:    []domain.Stack{tc.running},
				slugCache: map[string]string{"/wt/feat-x": "feat-x"},
			}
			sys := &fakeSystem{alive: map[int]bool{42: true}}
			o, _ := deadStackOrch(store, sys, 0)

			proceed, err := o.reconcileRunningStack(UpParams{WorktreeDir: "/wt/feat-x", IsLinkedWorktree: true}, tc.requested)
			if err != nil {
				t.Fatalf("reconcile: %v", err)
			}
			if proceed != tc.wantRestart {
				t.Errorf("proceed = %v, want %v", proceed, tc.wantRestart)
			}
			if restarted := len(sys.terminated) == 1; restarted != tc.wantRestart {
				t.Errorf("terminated = %v, want the old launcher terminated: %v", sys.terminated, tc.wantRestart)
			}
		})
	}
}
