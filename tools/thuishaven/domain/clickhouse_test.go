package domain

import (
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
		l.LightweightLogs = false

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
