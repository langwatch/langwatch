package clickhousedocker

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "The managed ClickHouse keeps its own telemetry lightweight"
func TestWriteConfig(t *testing.T) {
	newServer := func(t *testing.T) *Server {
		t.Helper()
		return &Server{home: t.TempDir(), limits: domain.DefaultClickHouseLimits()}
	}

	t.Run("given no config on disk", func(t *testing.T) {
		s := newServer(t)

		t.Run("when writing the config", func(t *testing.T) {
			changed, err := s.writeConfig()
			if err != nil {
				t.Fatal(err)
			}

			t.Run("reports a change — the container must pick it up", func(t *testing.T) {
				if !changed {
					t.Error("first write reported unchanged")
				}
			})

			t.Run("persists the rendered config", func(t *testing.T) {
				b, err := os.ReadFile(s.configPath())
				if err != nil {
					t.Fatal(err)
				}
				if string(b) != domain.RenderClickHouseConfig(s.limits) {
					t.Error("on-disk config differs from the rendered one")
				}
			})
		})
	})

	t.Run("given the current config is already on disk", func(t *testing.T) {
		s := newServer(t)
		if _, err := s.writeConfig(); err != nil {
			t.Fatal(err)
		}

		t.Run("when writing again with the same limits", func(t *testing.T) {
			changed, err := s.writeConfig()
			if err != nil {
				t.Fatal(err)
			}

			t.Run("reports no change — the running container is left alone", func(t *testing.T) {
				if changed {
					t.Error("identical re-render reported as changed")
				}
			})
		})

		t.Run("when the limits change", func(t *testing.T) {
			s.limits.SystemLogTTLDays = 2
			changed, err := s.writeConfig()
			if err != nil {
				t.Fatal(err)
			}

			t.Run("reports a change — the tuning must reach the container", func(t *testing.T) {
				if !changed {
					t.Error("changed limits reported unchanged")
				}
			})
		})
	})

	t.Run("given a legacy config filename is on disk", func(t *testing.T) {
		s := newServer(t)
		if err := os.MkdirAll(s.home, 0o755); err != nil {
			t.Fatal(err)
		}
		legacy := filepath.Join(s.home, domain.LegacyClickHouseConfigFiles[0])
		if err := os.WriteFile(legacy, []byte("<clickhouse/>"), 0o644); err != nil {
			t.Fatal(err)
		}

		t.Run("when writing the config", func(t *testing.T) {
			if _, err := s.writeConfig(); err != nil {
				t.Fatal(err)
			}

			t.Run("removes the legacy file so it can't be edited by mistake", func(t *testing.T) {
				if _, err := os.Stat(legacy); !os.IsNotExist(err) {
					t.Errorf("legacy config %s still present", legacy)
				}
			})
		})
	})
}
