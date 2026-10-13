package domain

import "testing"

// @scenario "The instant-eval mock judge is a setting that reaches the stack's environment"
func TestOverlayNamesTheMemoryJudgeOnlyWhenAskedAndOnlyOnAModularCheckout(t *testing.T) {
	base := Stack{Slug: "brave-otter", APIPort: 1}
	if hasKey(base.OverlayEnv(), "INSTANT_EVAL_CLASSIFIER") {
		t.Fatal("off by default: a stack that did not ask keeps whatever judge .env names")
	}
	mocked := base
	mocked.MockInstantEvalJudge = true
	if got := valueOf(mocked.OverlayEnv(), "INSTANT_EVAL_CLASSIFIER"); got != "memory" {
		t.Errorf("INSTANT_EVAL_CLASSIFIER = %q, want memory", got)
	}
	monolith := mocked
	monolith.Layout = LayoutMonolith
	if hasKey(monolith.OverlayEnv(), "INSTANT_EVAL_CLASSIFIER") {
		t.Error("the monolith's env parse refuses \"memory\"; emitting it would stop the stack booting")
	}
}

func TestInstantEvalMockJudgeIsAnOffByDefaultSwitch(t *testing.T) {
	report := ResolveLimits(LimitMachine{TotalRAMBytes: 16 << 30, NumCPU: 8}, "default",
		func(string) (string, string, bool) { return "", "", false })
	if got := report.Values()[LimitInstantEvalMockJudge]; got != 0 {
		t.Errorf("default = %d, want 0", got)
	}
	if err := report.Check(LimitInstantEvalMockJudge, 1); err != nil {
		t.Errorf("1 must be accepted: %v", err)
	}
	if err := report.Check(LimitInstantEvalMockJudge, 2); err == nil {
		t.Error("2 must be refused: the switch is 0 or 1")
	}
}
