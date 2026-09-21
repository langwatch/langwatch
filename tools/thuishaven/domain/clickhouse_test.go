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
