package domain

import (
	"path/filepath"
	"testing"
)

// @scenario "Each stack's gateway spools its spend apart from every other stack's"
func TestOverlayGivesEachStackItsOwnGatewaySpendSpool(t *testing.T) {
	a := Stack{Slug: "cloud", WorktreeDir: "/repo"}
	b := Stack{Slug: "install", WorktreeDir: "/repo"}
	gotA := valueOf(a.OverlayEnv(), "LW_GATEWAY_SPEND_SPOOL_DIR")
	gotB := valueOf(b.OverlayEnv(), "LW_GATEWAY_SPEND_SPOOL_DIR")
	if want := filepath.Join("/repo", ".haven", "run", "cloud", "gateway-spend-spool"); gotA != want {
		t.Errorf("cloud spool = %q, want %q", gotA, want)
	}
	if gotA == gotB {
		t.Errorf("two stacks share the spend spool %q", gotA)
	}
	if hasKey(Stack{Slug: "bare"}.OverlayEnv(), "LW_GATEWAY_SPEND_SPOOL_DIR") {
		t.Error("a stack with no worktree dir must leave the gateway's own default alone")
	}
}
