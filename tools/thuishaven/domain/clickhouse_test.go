package domain

import (
	"slices"
	"strings"
	"testing"
)

// @scenario "The managed ClickHouse keeps its own telemetry lightweight"
func TestRenderClickHouseConfig(t *testing.T) {
	t.Run("given the default limits", func(t *testing.T) {
		cfg := RenderClickHouseConfig(DefaultClickHouseLimits())

		t.Run("when rendering the config", func(t *testing.T) {
			t.Run("disables every noisy system log", func(t *testing.T) {
				for _, name := range NoisySystemLogs {
					if want := "<" + name + " remove=\"1\"/>"; !strings.Contains(cfg, want) {
						t.Errorf("missing %q in:\n%s", want, cfg)
					}
				}
			})

			t.Run("caps every kept system log at the default TTL", func(t *testing.T) {
				for _, name := range KeptSystemLogs {
					want := "<" + name + "><ttl>event_date + INTERVAL 7 DAY</ttl></" + name + ">"
					if !strings.Contains(cfg, want) {
						t.Errorf("missing %q in:\n%s", want, cfg)
					}
				}
			})

			t.Run("keeps the memory tuning", func(t *testing.T) {
				if !strings.Contains(cfg, "<max_server_memory_usage>") || !strings.Contains(cfg, "<mark_cache_size>") {
					t.Errorf("memory tuning lost:\n%s", cfg)
				}
			})

			t.Run("quiets the server log to warnings with a bounded rotation", func(t *testing.T) {
				for _, want := range []string{"<logger>", "<level>warning</level>", "<size>50M</size>", "<count>2</count>"} {
					if !strings.Contains(cfg, want) {
						t.Errorf("missing %q in:\n%s", want, cfg)
					}
				}
			})
		})
	})

	t.Run("given a log is both disabled and kept", func(t *testing.T) {
		// The two lists must stay disjoint: a table in both would be dropped and
		// then given a TTL, and which one wins depends on config.d ordering.
		kept := map[string]bool{}
		for _, name := range KeptSystemLogs {
			kept[name] = true
		}
		for _, name := range NoisySystemLogs {
			if kept[name] {
				t.Errorf("%q is in both NoisySystemLogs and KeptSystemLogs", name)
			}
		}
	})

	t.Run("given a custom TTL", func(t *testing.T) {
		l := DefaultClickHouseLimits()
		l.SystemLogTTLDays = 2

		t.Run("when rendering the config", func(t *testing.T) {
			t.Run("uses it for the kept logs", func(t *testing.T) {
				if !strings.Contains(RenderClickHouseConfig(l), "INTERVAL 2 DAY") {
					t.Error("custom TTL not applied")
				}
			})
		})
	})

	t.Run("given a non-positive TTL", func(t *testing.T) {
		l := DefaultClickHouseLimits()
		l.SystemLogTTLDays = 0

		t.Run("when rendering the config", func(t *testing.T) {
			t.Run("falls back to the default rather than emitting INTERVAL 0", func(t *testing.T) {
				cfg := RenderClickHouseConfig(l)
				if strings.Contains(cfg, "INTERVAL 0 DAY") {
					t.Errorf("INTERVAL 0 DAY would expire logs immediately:\n%s", cfg)
				}
				if !strings.Contains(cfg, "INTERVAL 7 DAY") {
					t.Error("expected the default TTL")
				}
			})
		})
	})

	t.Run("given full logs are requested", func(t *testing.T) {
		l := DefaultClickHouseLimits()
		l.LightweightLogsEnabled = false

		t.Run("when rendering the config", func(t *testing.T) {
			t.Run("leaves the stock system logs untouched", func(t *testing.T) {
				cfg := RenderClickHouseConfig(l)
				if strings.Contains(cfg, "remove=") || strings.Contains(cfg, "<ttl>") {
					t.Errorf("expected no system-log section:\n%s", cfg)
				}
			})

			t.Run("still applies the memory tuning", func(t *testing.T) {
				if !strings.Contains(RenderClickHouseConfig(l), "<max_server_memory_usage>") {
					t.Error("memory tuning lost")
				}
			})
		})
	})
}

// @scenario "The managed ClickHouse bounds its background work"
func TestRenderClickHouseConfigBoundsBackgroundWork(t *testing.T) {
	cfg := RenderClickHouseConfig(DefaultClickHouseLimits())

	t.Run("when rendering the config", func(t *testing.T) {
		t.Run("bounds background pools to the small VM it shares", func(t *testing.T) {
			for _, want := range []string{
				"<max_concurrent_queries>32</max_concurrent_queries>",
				"<background_pool_size>8</background_pool_size>",
				"<background_schedule_pool_size>64</background_schedule_pool_size>",
			} {
				if !strings.Contains(cfg, want) {
					t.Errorf("missing %q in:\n%s", want, cfg)
				}
			}
		})

		t.Run("shrinks the merge_tree free-entries thresholds with the pool", func(t *testing.T) {
			// Stock thresholds (8 to allow a large merge, 20 to run a mutation)
			// assume the stock 16-thread pool; kept as-is against a smaller pool
			// they would silently stop large merges and mutations ever scheduling.
			// All three must shrink together: the server refuses to boot when
			// number_of_free_entries_in_pool_to_execute_optimize_entire_partition
			// (stock 25) exceeds pool*ratio — a sanity check, not a warning.
			for _, want := range []string{
				"<number_of_free_entries_in_pool_to_lower_max_size_of_merge>4</number_of_free_entries_in_pool_to_lower_max_size_of_merge>",
				"<number_of_free_entries_in_pool_to_execute_mutation>4</number_of_free_entries_in_pool_to_execute_mutation>",
				"<number_of_free_entries_in_pool_to_execute_optimize_entire_partition>4</number_of_free_entries_in_pool_to_execute_optimize_entire_partition>",
			} {
				if !strings.Contains(cfg, want) {
					t.Errorf("missing %q in:\n%s", want, cfg)
				}
			}
		})
	})
}

// @scenario "The managed ClickHouse keeps its own telemetry lightweight"
func TestSystemLogRetrofitStatements(t *testing.T) {
	t.Run("given the default limits", func(t *testing.T) {
		stmts := SystemLogRetrofitStatements(DefaultClickHouseLimits())

		t.Run("when building the retrofit statements", func(t *testing.T) {
			t.Run("drops every noisy system log", func(t *testing.T) {
				for _, name := range NoisySystemLogs {
					want := "DROP TABLE IF EXISTS system." + name
					if !slices.Contains(stmts, want) {
						t.Errorf("missing %q in %v", want, stmts)
					}
				}
			})

			t.Run("gives every kept system log the same TTL as the rendered config", func(t *testing.T) {
				for _, name := range KeptSystemLogs {
					want := "ALTER TABLE system." + name + " MODIFY TTL event_date + INTERVAL 7 DAY"
					if !slices.Contains(stmts, want) {
						t.Errorf("missing %q in %v", want, stmts)
					}
				}
			})
		})
	})

	t.Run("given full logs are requested", func(t *testing.T) {
		l := DefaultClickHouseLimits()
		l.LightweightLogsEnabled = false

		t.Run("when building the retrofit statements", func(t *testing.T) {
			t.Run("emits nothing — the stock tables are left alone", func(t *testing.T) {
				if stmts := SystemLogRetrofitStatements(l); len(stmts) != 0 {
					t.Errorf("expected no statements, got %v", stmts)
				}
			})
		})
	})

	t.Run("given a non-positive TTL", func(t *testing.T) {
		l := DefaultClickHouseLimits()
		l.SystemLogTTLDays = 0

		t.Run("when resolving the effective TTL", func(t *testing.T) {
			t.Run("falls back to the default", func(t *testing.T) {
				if got := l.EffectiveSystemLogTTLDays(); got != DefaultSystemLogTTLDays {
					t.Errorf("got %d, want %d", got, DefaultSystemLogTTLDays)
				}
			})
		})
	})
}

// panickedLaptopRAM is the machine the 2026-09-09 watchdog panic happened on:
// an 18 GiB Mac15,6 whose brew ClickHouse carried no explicit ceiling. The
// number is here so the regression is the real one, not a rounded stand-in.
// A var, not a const: the ratio arithmetic below is only representable as an
// int64 once it is evaluated at runtime.
var panickedLaptopRAM = uint64(19327352832)

// @scenario "A ClickHouse that may grow into the whole machine is called out"
// @scenario "A ClickHouse kept to a modest share of the machine passes"
func TestAssessClickHouseCeiling(t *testing.T) {
	t.Run("given a server that sets no ceiling of its own", func(t *testing.T) {
		ceiling := ClickHouseCeiling{}

		t.Run("when checked against the laptop that panicked", func(t *testing.T) {
			v := AssessClickHouseCeiling(ceiling, panickedLaptopRAM)

			t.Run("fails the check", func(t *testing.T) {
				if v.Safe {
					t.Errorf("an uncapped server passed: %+v", v)
				}
			})

			t.Run("reports the ceiling as implicit", func(t *testing.T) {
				if !v.Implicit {
					t.Error("an absent max_server_memory_usage did not read as implicit")
				}
			})

			t.Run("resolves the ratio fallback to most of the machine", func(t *testing.T) {
				want := int64(float64(panickedLaptopRAM) * DefaultClickHouseRAMRatio)
				if v.EffectiveBytes != want {
					t.Errorf("got %d, want %d", v.EffectiveBytes, want)
				}
			})

			t.Run("names a safe ceiling far under the effective one", func(t *testing.T) {
				if v.SafeBytes >= v.EffectiveBytes {
					t.Errorf("safe %d is not under effective %d", v.SafeBytes, v.EffectiveBytes)
				}
			})
		})
	})

	t.Run("given a server capped at a small share of the machine", func(t *testing.T) {
		ceiling := ClickHouseCeiling{MaxServerMemoryUsage: 1 << 30}

		t.Run("when checked against the same machine", func(t *testing.T) {
			v := AssessClickHouseCeiling(ceiling, panickedLaptopRAM)

			t.Run("passes the check", func(t *testing.T) {
				if !v.Safe {
					t.Errorf("a 1 GiB ceiling failed on an 18 GiB machine: %+v", v)
				}
			})

			t.Run("reports the ceiling as explicit", func(t *testing.T) {
				if v.Implicit {
					t.Error("an explicit max_server_memory_usage read as implicit")
				}
			})
		})
	})

	t.Run("given the limits haven applies to the container it manages", func(t *testing.T) {
		ceiling := ClickHouseCeiling{MaxServerMemoryUsage: DefaultClickHouseLimits().MaxServerMemory}

		t.Run("when checked against the same machine", func(t *testing.T) {
			t.Run("passes, so the check never fires on haven's own tuning", func(t *testing.T) {
				if v := AssessClickHouseCeiling(ceiling, panickedLaptopRAM); !v.Safe {
					t.Errorf("haven's own managed limits failed the check: %+v", v)
				}
			})
		})
	})

	t.Run("given a machine whose memory could not be read", func(t *testing.T) {
		t.Run("when checked", func(t *testing.T) {
			v := AssessClickHouseCeiling(ClickHouseCeiling{}, 0)

			t.Run("withholds judgment rather than crying wolf", func(t *testing.T) {
				if !v.Safe || !v.Unknown {
					t.Errorf("got %+v, want a safe unknown verdict", v)
				}
			})
		})
	})

	t.Run("given an explicit ceiling that exceeds the safe share", func(t *testing.T) {
		ceiling := ClickHouseCeiling{MaxServerMemoryUsage: int64(panickedLaptopRAM)}

		t.Run("when checked", func(t *testing.T) {
			v := AssessClickHouseCeiling(ceiling, panickedLaptopRAM)

			t.Run("fails without blaming an absent setting", func(t *testing.T) {
				if v.Safe || v.Implicit {
					t.Errorf("got %+v, want an unsafe explicit verdict", v)
				}
			})
		})
	})
}

// @scenario "The ceiling check does not depend on who manages the server"
func TestAssessClickHouseCeilingIgnoresTier(t *testing.T) {
	t.Run("given the same ceiling on the same machine", func(t *testing.T) {
		ceiling := ClickHouseCeiling{RAMRatio: DefaultClickHouseRAMRatio}

		t.Run("when one is reached as a managed container and one as a URL", func(t *testing.T) {
			managed := AssessClickHouseCeiling(ceiling, panickedLaptopRAM)
			unmanaged := AssessClickHouseCeiling(ceiling, panickedLaptopRAM)

			t.Run("reaches the same verdict", func(t *testing.T) {
				if managed != unmanaged {
					t.Errorf("managed %+v, unmanaged %+v", managed, unmanaged)
				}
			})

			t.Run("differs only in the name the warning carries", func(t *testing.T) {
				a := managed.Warning("the managed ClickHouse")
				b := unmanaged.Warning("http://127.0.0.1:8123")
				if a == "" || b == "" || a == b {
					t.Errorf("warnings did not track the name: %q vs %q", a, b)
				}
			})
		})
	})
}

// @scenario "A ClickHouse that may grow into the whole machine is called out"
func TestClickHouseCeilingWarning(t *testing.T) {
	t.Run("given an unsafe implicit ceiling", func(t *testing.T) {
		v := AssessClickHouseCeiling(ClickHouseCeiling{}, panickedLaptopRAM)

		t.Run("when rendering the warning", func(t *testing.T) {
			msg := v.Warning("the ClickHouse at http://127.0.0.1:8123")

			t.Run("names the server", func(t *testing.T) {
				if !strings.Contains(msg, "http://127.0.0.1:8123") {
					t.Errorf("server not named in: %s", msg)
				}
			})

			t.Run("names what it may take, the machine, and what is safe", func(t *testing.T) {
				for _, want := range []string{
					HumanBytes(v.EffectiveBytes),
					HumanBytes(v.HostRAMBytes),
					HumanBytes(v.SafeBytes),
				} {
					if !strings.Contains(msg, want) {
						t.Errorf("missing %q in: %s", want, msg)
					}
				}
			})

			t.Run("says no ceiling is set, so a default applies", func(t *testing.T) {
				for _, want := range []string{"no max_server_memory_usage of its own", "90%"} {
					if !strings.Contains(msg, want) {
						t.Errorf("missing %q in: %s", want, msg)
					}
				}
			})

			t.Run("names both ways out", func(t *testing.T) {
				for _, want := range []string{"config.d", "LANGWATCH_HAVEN_CH=0"} {
					if !strings.Contains(msg, want) {
						t.Errorf("missing %q in: %s", want, msg)
					}
				}
			})
		})
	})

	t.Run("given a safe ceiling", func(t *testing.T) {
		v := AssessClickHouseCeiling(ClickHouseCeiling{MaxServerMemoryUsage: 1 << 30}, panickedLaptopRAM)

		t.Run("when rendering the warning", func(t *testing.T) {
			t.Run("stays silent so callers can log it unconditionally", func(t *testing.T) {
				if msg := v.Warning("the managed ClickHouse"); msg != "" {
					t.Errorf("got %q, want silence", msg)
				}
			})
		})
	})
}
