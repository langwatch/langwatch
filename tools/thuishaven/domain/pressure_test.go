package domain

import (
	"testing"
	"time"
)

const gib = uint64(1) << 30

// @scenario "Pressure is classified from the compressor and swap, not from summed RSS"
func TestClassifyPressureUsesCompressorAndSwap(t *testing.T) {
	t.Run("given a machine with room to spare", func(t *testing.T) {
		m := MemStat{TotalBytes: 18 * gib, CompressedBytes: gib, SwapUsedBytes: 0, SwapTotalBytes: 4 * gib}

		t.Run("when pressure is classified", func(t *testing.T) {
			t.Run("reads green", func(t *testing.T) {
				if got := ClassifyPressure(m); got != Green {
					t.Fatalf("expected green, got %s", got)
				}
			})
		})
	})

	t.Run("given a compressor working hard", func(t *testing.T) {
		// 2 GiB occupied of 18 GiB is over the amber fraction and under red.
		m := MemStat{TotalBytes: 18 * gib, CompressedBytes: 2 * gib, SwapTotalBytes: 4 * gib}

		t.Run("when pressure is classified", func(t *testing.T) {
			t.Run("reads amber", func(t *testing.T) {
				if got := ClassifyPressure(m); got != Amber {
					t.Fatalf("expected amber, got %s", got)
				}
			})
		})
	})

	t.Run("given swap nearly full", func(t *testing.T) {
		m := MemStat{TotalBytes: 18 * gib, SwapUsedBytes: 3900 * (1 << 20), SwapTotalBytes: 4 * gib}

		t.Run("when pressure is classified", func(t *testing.T) {
			t.Run("reads red", func(t *testing.T) {
				if got := ClassifyPressure(m); got != Red {
					t.Fatalf("expected red, got %s", got)
				}
			})
		})
	})
}

// @scenario "Either signal alone can raise the level"
func TestEitherSignalAloneRaisesTheLevel(t *testing.T) {
	t.Run("given a machine with swap disabled, so its swap term is permanently zero", func(t *testing.T) {
		m := MemStat{TotalBytes: 18 * gib, CompressedBytes: 4 * gib, SwapUsedBytes: 0, SwapTotalBytes: 0}

		t.Run("when compressor occupancy alone crosses the threshold", func(t *testing.T) {
			t.Run("the level still rises", func(t *testing.T) {
				if got := ClassifyPressure(m); got != Red {
					t.Fatalf("a machine with no swap still thrashes its compressor; got %s", got)
				}
			})
		})
	})

	t.Run("given a machine whose compressor is idle", func(t *testing.T) {
		m := MemStat{TotalBytes: 18 * gib, CompressedBytes: 0, SwapUsedBytes: 3 * gib, SwapTotalBytes: 4 * gib}

		t.Run("when swap alone crosses the threshold", func(t *testing.T) {
			t.Run("the level still rises", func(t *testing.T) {
				if got := ClassifyPressure(m); got == Green {
					t.Fatal("swap alone should raise the level")
				}
			})
		})
	})
}

// @scenario "An undetectable machine reads as unloaded"
func TestUndetectableMachineReadsGreen(t *testing.T) {
	t.Run("given a machine whose memory cannot be read", func(t *testing.T) {
		t.Run("when pressure is classified", func(t *testing.T) {
			t.Run("reads green, because a governor must never throttle on a guess", func(t *testing.T) {
				if got := ClassifyPressure(MemStat{}); got != Green {
					t.Fatalf("expected green, got %s", got)
				}
			})
		})
	})
}

// @scenario "A reading that cannot be trusted reads as green"
func TestUntrustworthyPressureRecordReadsGreen(t *testing.T) {
	now := time.Date(2026, 8, 6, 12, 0, 0, 0, time.UTC)
	fresh := PressureRecord{Version: PressureRecordVersion, Level: "red", WrittenAt: now}

	t.Run("given a fresh record of the current version", func(t *testing.T) {
		t.Run("when it is read", func(t *testing.T) {
			t.Run("it is believed", func(t *testing.T) {
				if got := ReadPressure(fresh, true, now); got != Red {
					t.Fatalf("expected red, got %s", got)
				}
			})
		})
	})

	t.Run("given a record that is absent", func(t *testing.T) {
		t.Run("it reads green", func(t *testing.T) {
			if got := ReadPressure(PressureRecord{}, false, now); got != Green {
				t.Fatalf("expected green, got %s", got)
			}
		})
	})

	t.Run("given a record written by a different version", func(t *testing.T) {
		other := fresh
		other.Version = PressureRecordVersion + 1
		t.Run("it reads green", func(t *testing.T) {
			if got := ReadPressure(other, true, now); got != Green {
				t.Fatalf("expected green, got %s", got)
			}
		})
	})

	t.Run("given a record older than the staleness threshold", func(t *testing.T) {
		t.Run("it reads green", func(t *testing.T) {
			later := now.Add(PressureStaleAfter + time.Second)
			if got := ReadPressure(fresh, true, later); got != Green {
				t.Fatalf("expected green, got %s", got)
			}
		})
	})
}

// @scenario "A caller that cannot be identified is treated as a sub-agent"
// @scenario "A sub-agent is not held past its five-minute floor"
// @scenario "An interactive run keeps the long failsafe"
// @scenario "A main session keeps the long failsafe"
func TestWaitCeilingFollowsTheCaller(t *testing.T) {
	t.Run("given a sub-agent, which holds the five-minute cache", func(t *testing.T) {
		c := CallerFromAgentID("agent_123", false)

		t.Run("when its ceiling is resolved", func(t *testing.T) {
			t.Run("is capped below the five-minute floor", func(t *testing.T) {
				if c != SubAgent {
					t.Fatalf("expected a sub-agent, got %v", c)
				}
				if c.WaitCeiling() >= c.CacheFloor() {
					t.Fatalf("ceiling %s must sit under the floor %s", c.WaitCeiling(), c.CacheFloor())
				}
			})
		})
	})

	t.Run("given a main session", func(t *testing.T) {
		c := CallerFromAgentID("", false)

		t.Run("when its ceiling is resolved", func(t *testing.T) {
			t.Run("keeps the long failsafe, which sits inside its hour", func(t *testing.T) {
				if c != MainSession {
					t.Fatalf("expected a main session, got %v", c)
				}
				if c.WaitCeiling() != LongFailsafe {
					t.Fatalf("expected the long failsafe, got %s", c.WaitCeiling())
				}
				if LongFailsafe >= c.CacheFloor() {
					t.Fatal("the long failsafe is supposed to sit inside a one-hour floor")
				}
			})
		})
	})

	t.Run("given a run started from a terminal", func(t *testing.T) {
		c := CallerFromAgentID("", true)

		t.Run("keeps the long failsafe, because a human waiting is not an idle API session", func(t *testing.T) {
			if c != Interactive || c.WaitCeiling() != LongFailsafe {
				t.Fatalf("expected an interactive caller on the long failsafe, got %v / %s", c, c.WaitCeiling())
			}
		})
	})

	t.Run("given a caller that cannot be identified", func(t *testing.T) {
		// An unidentified caller arrives with no agent id and no terminal, which
		// is indistinguishable from a main session by inspection — so the rule is
		// stated as a deliberate default rather than inferred.
		t.Run("the tighter sub-agent ceiling is what a conservative default means", func(t *testing.T) {
			if SubAgent.WaitCeiling() >= MainSession.WaitCeiling() {
				t.Fatal("the sub-agent ceiling must be the tighter of the two")
			}
		})
	})
}
