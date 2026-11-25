package app

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "haven status names the effective mode"
func TestStatusNamesTheEffectiveMode(t *testing.T) {
	printed := func(st domain.Stack) string {
		o := statusOrch(&fakeStore{}, &fakeSystem{alive: map[int]bool{42: true}})
		return captureStdout(t, func() { o.printStacks(statusReport{stacks: []domain.Stack{st}}) })
	}

	t.Run("given a stack started with --mode saas, status prints mode saas", func(t *testing.T) {
		st := droppedStack(42)
		st.Mode, st.EffectiveMode = "saas", "saas"

		if out := printed(st); !strings.Contains(out, "  mode saas\n") {
			t.Errorf("status output has no %q line:\n%s", "mode saas", out)
		}
	})

	t.Run("given a root .env override, status names the override with the mode", func(t *testing.T) {
		st := droppedStack(42)
		st.Mode, st.EffectiveMode = "saas", domain.EffectiveMode("saas", []string{"IS_SAAS"})

		if out := printed(st); !strings.Contains(out, "mode saas (overridden by .env: IS_SAAS)") {
			t.Errorf("status output does not name the override:\n%s", out)
		}
	})

	t.Run("given a stack with no mode, status prints no mode line", func(t *testing.T) {
		if out := printed(droppedStack(42)); strings.Contains(out, "mode ") {
			t.Errorf("status printed a mode for a stack without one:\n%s", out)
		}
	})
}
