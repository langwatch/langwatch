package domain

import (
	"testing"
	"time"
)

// base is a short sub-agent unit run that finds no free slot, which narrows.
// Each test below changes exactly the one thing it is about.
func base() AdmissionRequest {
	return AdmissionRequest{
		Pressure:         Green,
		IsSlotFree:       false,
		Caller:           SubAgent,
		Kind:             UnitRun,
		ObservedDuration: 30 * time.Second,
	}
}

// @scenario "A short sub-agent run is narrowed instead of queued"
func TestShortSubAgentRunIsNarrowed(t *testing.T) {
	t.Run("given no slot is free and the caller is a sub-agent", func(t *testing.T) {
		r := base()

		t.Run("when the command has been observed to finish inside five minutes", func(t *testing.T) {
			t.Run("it is narrowed rather than queued", func(t *testing.T) {
				if got := DecideAdmission(r); got != Narrow {
					t.Fatalf("expected narrow, got %s", got)
				}
			})
		})
	})
}

// @scenario "A long sub-agent run is queued anyway"
func TestLongSubAgentRunIsQueued(t *testing.T) {
	t.Run("given a sub-agent run observed to take longer than five minutes", func(t *testing.T) {
		r := base()
		r.ObservedDuration = 9 * time.Minute

		t.Run("when it finds no free slot", func(t *testing.T) {
			t.Run("it queues, because its cache is lost by running", func(t *testing.T) {
				if got := DecideAdmission(r); got != Queue {
					t.Fatalf("expected queue, got %s", got)
				}
			})
		})
	})
}

// @scenario "A command haven has never seen is queued"
func TestUnobservedCommandIsQueued(t *testing.T) {
	t.Run("given a command with no recorded duration", func(t *testing.T) {
		r := base()
		r.ObservedDuration = 0

		t.Run("when it finds no free slot", func(t *testing.T) {
			t.Run("it queues rather than narrowing", func(t *testing.T) {
				if got := DecideAdmission(r); got != Queue {
					t.Fatalf("unknown must be treated as long; got %s", got)
				}
			})
		})
	})
}

// @scenario "A main-session run with no slot free waits"
func TestMainSessionRunQueues(t *testing.T) {
	t.Run("given a main-session run with no slot free", func(t *testing.T) {
		r := base()
		r.Caller = MainSession

		t.Run("when it is admitted", func(t *testing.T) {
			t.Run("it waits rather than being narrowed", func(t *testing.T) {
				if got := DecideAdmission(r); got != Queue {
					t.Fatalf("a main session holds the one-hour cache; got %s", got)
				}
			})
		})
	})
}

// @scenario "An integration run is never narrowed"
func TestIntegrationRunIsNeverNarrowed(t *testing.T) {
	t.Run("given an integration suite with no slot free", func(t *testing.T) {
		r := base()
		r.Kind = IntegrationRun

		t.Run("when it is admitted", func(t *testing.T) {
			t.Run("its worker count is left alone and it queues", func(t *testing.T) {
				if got := DecideAdmission(r); got != Queue {
					t.Fatalf("integration files are serial by construction; got %s", got)
				}
			})
			t.Run("the kind reports itself as not narrowable", func(t *testing.T) {
				if IntegrationRun.Narrowable() {
					t.Fatal("narrowing an integration run trips the serialism guard")
				}
			})
		})
	})
}

// @scenario "A run that cannot be narrowed always queues"
func TestSingleProcessRunAlwaysQueues(t *testing.T) {
	t.Run("given a typecheck, which is one process with nothing to divide", func(t *testing.T) {
		r := base()
		r.Kind = SingleProcessRun

		t.Run("when it finds no free slot", func(t *testing.T) {
			t.Run("it queues", func(t *testing.T) {
				if got := DecideAdmission(r); got != Queue {
					t.Fatalf("expected queue, got %s", got)
				}
			})
		})
	})
}

// @scenario "A caller's own worker count is respected but still admitted"
func TestCallerSuppliedWorkerCountIsNotOverridden(t *testing.T) {
	t.Run("given a command that already specifies its worker count", func(t *testing.T) {
		r := base()
		r.HasCallerWorkerCount = true

		t.Run("when it goes through the counter", func(t *testing.T) {
			t.Run("it is not narrowed, but it is still admitted by the same rules", func(t *testing.T) {
				if got := DecideAdmission(r); got != Queue {
					t.Fatalf("expected the run to queue unchanged, got %s", got)
				}
			})
			t.Run("and at red with no slot it is refused like anything else", func(t *testing.T) {
				red := r
				red.Pressure = Red
				if got := DecideAdmission(red); got != Refuse {
					t.Fatalf("expected refuse, got %s", got)
				}
			})
		})
	})
}

// @scenario "At critical pressure a run with no slot is refused"
// @scenario "At critical pressure a run with a slot free still proceeds"
func TestRedThrottlesAdmissionWithoutStoppingWork(t *testing.T) {
	t.Run("given pressure is red", func(t *testing.T) {
		t.Run("when no slot is free", func(t *testing.T) {
			r := base()
			r.Pressure = Red

			t.Run("the run is refused, and does not queue", func(t *testing.T) {
				if got := DecideAdmission(r); got != Refuse {
					t.Fatalf("expected refuse, got %s", got)
				}
			})
		})

		t.Run("when a slot is free", func(t *testing.T) {
			r := base()
			r.Pressure = Red
			r.IsSlotFree = true

			t.Run("the run proceeds, because red throttles admission and does not stop work", func(t *testing.T) {
				// Proceeding is the assertion, not the width: a loaded machine
				// takes width off a run that has some to give, and that is still
				// starting now rather than waiting or being turned away.
				if got := DecideAdmission(r); got == Refuse || got == Queue {
					t.Fatalf("expected the run to start, got %s", got)
				}
			})

			t.Run("and a run with no width to give up starts at full width", func(t *testing.T) {
				single := r
				single.Kind = SingleProcessRun
				if got := DecideAdmission(single); got != Admit {
					t.Fatalf("expected admit, got %s", got)
				}
			})
		})
	})
}

// @scenario "A wait too long to serve is backgrounded rather than refused"
// @scenario "A wait that fits the ceiling still blocks"
func TestAWaitTooLongToServeIsBackgrounded(t *testing.T) {
	// Long enough that narrowing is off the table, so the choice is purely
	// between blocking and handing the run back detached.
	longRun := func() AdmissionRequest {
		r := base()
		r.ObservedDuration = 20 * time.Minute
		r.CanBackground = true
		return r
	}

	t.Run("given a sub-agent whose queue is deeper than its ceiling", func(t *testing.T) {
		r := longRun()
		r.EstimatedWait = SubAgent.WaitCeiling() + time.Minute

		t.Run("when the run is admitted", func(t *testing.T) {
			t.Run("it is handed back to run in the background", func(t *testing.T) {
				if got := DecideAdmission(r); got != Background {
					t.Fatalf("expected background, got %s", got)
				}
			})
		})
	})

	t.Run("given a wait that fits inside the ceiling", func(t *testing.T) {
		r := longRun()
		r.EstimatedWait = time.Minute

		t.Run("when the run is admitted", func(t *testing.T) {
			t.Run("it queues inline, because backgrounding breaks causality", func(t *testing.T) {
				if got := DecideAdmission(r); got != Queue {
					t.Fatalf("expected queue, got %s", got)
				}
			})
		})
	})

	t.Run("given a main session, which can afford a much longer wait", func(t *testing.T) {
		r := longRun()
		r.Caller = MainSession
		r.EstimatedWait = 10 * time.Minute

		t.Run("the same wait that would background a sub-agent still queues", func(t *testing.T) {
			if got := DecideAdmission(r); got != Queue {
				t.Fatalf("expected queue, got %s", got)
			}
		})
	})

	t.Run("given a caller with nowhere to put a detached run", func(t *testing.T) {
		r := longRun()
		r.CanBackground = false
		r.EstimatedWait = time.Hour

		t.Run("it queues on the ordinary failsafe rather than being backgrounded", func(t *testing.T) {
			if got := DecideAdmission(r); got != Queue {
				t.Fatalf("expected queue, got %s", got)
			}
		})
	})

	t.Run("given red pressure and no slot", func(t *testing.T) {
		r := longRun()
		r.Pressure = Red
		r.EstimatedWait = time.Hour

		t.Run("it is refused and not backgrounded, because deferring only moves the burst", func(t *testing.T) {
			if got := DecideAdmission(r); got != Refuse {
				t.Fatalf("expected refuse, got %s", got)
			}
		})
	})
}

// @scenario "A loaded machine stops admitting at full width"
func TestAmberStopsAdmittingAtFullWidth(t *testing.T) {
	t.Run("given a loaded machine that still has a slot free", func(t *testing.T) {
		r := base()
		r.Pressure = Amber
		r.IsSlotFree = true

		t.Run("when a unit run asks for admission", func(t *testing.T) {
			t.Run("it starts immediately, but not at full width", func(t *testing.T) {
				if got := DecideAdmission(r); got != Narrow {
					t.Fatalf("amber has to change something a caller can observe; got %s", got)
				}
			})

			t.Run("and a main session is narrowed too, because this is about the machine", func(t *testing.T) {
				main := r
				main.Caller = MainSession
				if got := DecideAdmission(main); got != Narrow {
					t.Fatalf("expected narrow, got %s", got)
				}
			})
		})

		t.Run("when a human at a terminal asks", func(t *testing.T) {
			human := r
			human.Caller = Interactive

			t.Run("their run is left entirely alone", func(t *testing.T) {
				if got := DecideAdmission(human); got != Admit {
					t.Fatalf("a human is waiting on the result, not holding a cache; got %s", got)
				}
			})
		})

		t.Run("when the caller chose its own width", func(t *testing.T) {
			chosen := r
			chosen.HasCallerWorkerCount = true

			t.Run("that choice is respected rather than overridden", func(t *testing.T) {
				if got := DecideAdmission(chosen); got != Admit {
					t.Fatalf("expected admit, got %s", got)
				}
			})
		})
	})

	t.Run("given an unloaded machine with a slot free", func(t *testing.T) {
		r := base()
		r.IsSlotFree = true

		t.Run("nothing is narrowed, because there is nothing to react to", func(t *testing.T) {
			if got := DecideAdmission(r); got != Admit {
				t.Fatalf("expected admit, got %s", got)
			}
		})
	})
}

// @scenario "A run narrowed by pressure gives up half its width"
func TestPressureWidthHalvesRatherThanDividing(t *testing.T) {
	t.Run("given a full-width run of six workers", func(t *testing.T) {
		t.Run("when the machine is loaded but has room for it", func(t *testing.T) {
			t.Run("it gives up half its width", func(t *testing.T) {
				if got := PressureWidth(6); got != 3 {
					t.Fatalf("expected 3, got %d", got)
				}
			})
			t.Run("and never falls below one, because a run with no workers never finishes", func(t *testing.T) {
				if got := PressureWidth(1); got != 1 {
					t.Fatalf("expected 1, got %d", got)
				}
			})
		})
	})
}

// @scenario "A narrowed run still takes a slot"
func TestNarrowedWorkersDivideByRunsInFlight(t *testing.T) {
	t.Run("given a full-width run of five workers", func(t *testing.T) {
		t.Run("when one run is in flight", func(t *testing.T) {
			t.Run("it keeps its width", func(t *testing.T) {
				if got := NarrowedWorkers(5, 1); got != 5 {
					t.Fatalf("expected 5, got %d", got)
				}
			})
		})

		t.Run("when several runs are in flight", func(t *testing.T) {
			t.Run("the width divides by the runs actually running, not the configured limit", func(t *testing.T) {
				if got := NarrowedWorkers(5, 2); got != 2 {
					t.Fatalf("expected 2, got %d", got)
				}
			})
			t.Run("and never falls below one, because a run with no workers never finishes", func(t *testing.T) {
				if got := NarrowedWorkers(5, 50); got != 1 {
					t.Fatalf("expected 1, got %d", got)
				}
			})
		})
	})
}
