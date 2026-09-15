package domain

import (
	"testing"
	"time"
)

/** @scenario "Priority classes rank a person above a main session above a sub-agent" */
func TestClassPriorityRanksPersonAboveMainSessionAboveSubAgent(t *testing.T) {
	if ClassPriority(Interactive) <= ClassPriority(MainSession) {
		t.Fatalf("a person must outrank a main session")
	}
	if ClassPriority(MainSession) <= ClassPriority(SubAgent) {
		t.Fatalf("a main session must outrank a sub-agent")
	}
}

/** @scenario "A queued run's effective priority rises with how long it has waited" */
func TestPriorityAgeBonusRisesWithWaitAndCaps(t *testing.T) {
	t.Run("no wait adds nothing", func(t *testing.T) {
		if got := PriorityAgeBonus(0); got != 0 {
			t.Fatalf("bonus = %d, want 0", got)
		}
	})
	t.Run("waiting longer adds more, up to the cap", func(t *testing.T) {
		short := PriorityAgeBonus(1 * time.Minute)
		long := PriorityAgeBonus(5 * time.Minute)
		if long <= short {
			t.Fatalf("longer wait must age higher: short=%d long=%d", short, long)
		}
	})
	t.Run("aging never exceeds one class step", func(t *testing.T) {
		if got := PriorityAgeBonus(24 * time.Hour); got != PriorityAgeCap {
			t.Fatalf("bonus = %d, want the cap %d", got, PriorityAgeCap)
		}
	})
}

/** @scenario "Aging alone lets a sub-agent catch up to a main session, never past a person waiting the same time" */
func TestAgingCatchesUpOneRankNotTwo(t *testing.T) {
	waited := 24 * time.Hour
	subAgent := EffectivePriority(SubAgent, waited, false)
	mainSession := EffectivePriority(MainSession, 0, false)
	interactive := EffectivePriority(Interactive, waited, false)

	if subAgent != mainSession {
		t.Fatalf("a fully aged sub-agent should reach a fresh main session's own priority: %d != %d", subAgent, mainSession)
	}
	if subAgent >= interactive {
		t.Fatalf("aging alone must not let a sub-agent reach a person waiting the same time: sub-agent=%d interactive=%d", subAgent, interactive)
	}
}

/** @scenario "An explicit HAVEN_PRIORITY=high raises effective priority by one class step" */
func TestPriorityOverrideBonusIsOneClassStep(t *testing.T) {
	without := EffectivePriority(SubAgent, 0, false)
	with := EffectivePriority(SubAgent, 0, true)
	if with-without != PriorityOverrideBonus {
		t.Fatalf("override bonus = %d, want %d", with-without, PriorityOverrideBonus)
	}
}

/** @scenario "An honored HAVEN_PRIORITY=high claim is limited to once per agent id per 10 minutes" */
func TestPriorityOverrideHonoredOncePerWindow(t *testing.T) {
	now := time.Now()

	t.Run("no earlier claim is honored", func(t *testing.T) {
		if !PriorityOverrideHonored(PriorityOverrideRequest{Requested: true, Now: now}) {
			t.Fatal("a first claim must be honored")
		}
	})
	t.Run("not requested is never honored", func(t *testing.T) {
		if PriorityOverrideHonored(PriorityOverrideRequest{Requested: false, Now: now}) {
			t.Fatal("an unrequested override must never be honored")
		}
	})
	t.Run("a claim inside the window is refused", func(t *testing.T) {
		last := now.Add(-5 * time.Minute)
		if PriorityOverrideHonored(PriorityOverrideRequest{Requested: true, LastHonoredAt: last, HasLast: true, Now: now}) {
			t.Fatal("a claim 5 minutes after the last must be refused")
		}
	})
	t.Run("a claim at or past the window is honored again", func(t *testing.T) {
		last := now.Add(-PriorityOverrideWindow)
		if !PriorityOverrideHonored(PriorityOverrideRequest{Requested: true, LastHonoredAt: last, HasLast: true, Now: now}) {
			t.Fatal("a claim exactly at the window boundary must be honored")
		}
	})
}

/** @scenario "An explicit HAVEN_PRIORITY=high in the caller's environment lets an agent state that this run matters" */
func TestPriorityClaimMarkerNeverEntersADurationEstimate(t *testing.T) {
	now := time.Now()
	claim := NewPriorityClaim("agent_7", now)

	if claim.Succeeded() {
		t.Fatal("a priority-claim marker must never read as a completed, successful run")
	}
	if got, ok := medianFor([]RunRecord{claim}, KindOther); ok {
		t.Fatalf("a claim marker must contribute no duration at all, got %v", got)
	}
}

/** @scenario "haven slot explain shows each holder and waiter with class, age and effective priority" */
func TestLastPriorityClaimFindsTheNewestMatchingAgent(t *testing.T) {
	now := time.Now()
	history := []RunRecord{
		NewPriorityClaim("agent_1", now.Add(-30*time.Minute)),
		NewPriorityClaim("agent_7", now.Add(-20*time.Minute)),
		NewPriorityClaim("agent_7", now.Add(-2*time.Minute)),
	}
	at, ok := LastPriorityClaim(history, "agent_7")
	if !ok {
		t.Fatal("expected a claim for agent_7")
	}
	if !at.Equal(now.Add(-2 * time.Minute)) {
		t.Fatalf("expected the newest claim, got %v", at)
	}
	if _, ok := LastPriorityClaim(history, "agent_unknown"); ok {
		t.Fatal("an agent with no claim must report none")
	}
}

/** @scenario "A queued run's effective priority rises with how long it has waited" */
func TestShouldYieldToAHigherPriorityWaiter(t *testing.T) {
	t.Run("a lower-priority waiter yields", func(t *testing.T) {
		self := WaiterState{Caller: SubAgent, Waited: 0}
		others := []WaiterState{{Caller: Interactive, Waited: 0}}
		if !ShouldYield(self, others) {
			t.Fatal("a sub-agent that just arrived must yield to a person")
		}
	})
	t.Run("the highest-priority waiter never yields", func(t *testing.T) {
		self := WaiterState{Caller: Interactive, Waited: 0}
		others := []WaiterState{{Caller: SubAgent, Waited: 24 * time.Hour}}
		if ShouldYield(self, others) {
			t.Fatal("a person must not yield to a fully aged sub-agent, only catch up to")
		}
	})
	t.Run("no other waiters never yields", func(t *testing.T) {
		if ShouldYield(WaiterState{Caller: SubAgent}, nil) {
			t.Fatal("a lone waiter has nobody to yield to")
		}
	})
}
