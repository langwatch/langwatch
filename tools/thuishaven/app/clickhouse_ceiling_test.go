package app

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// fakeCeilingProbe records what it was asked so a test can prove the check was
// skipped, not merely quiet.
type fakeCeilingProbe struct {
	asked   []string
	ceiling domain.ClickHouseCeiling
	err     error
}

func (f *fakeCeilingProbe) Ceiling(_ context.Context, rawURL string) (domain.ClickHouseCeiling, error) {
	f.asked = append(f.asked, rawURL)
	return f.ceiling, f.err
}

// dotenvDir writes an lwDir holding a .env with the given CLICKHOUSE_URL.
func dotenvDir(t *testing.T, clickHouseURL string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, ".env"), []byte("CLICKHOUSE_URL="+clickHouseURL+"\n"), 0o600); err != nil {
		t.Fatalf("writing .env: %v", err)
	}
	return dir
}

// ceilingOrchestrator builds the smallest orchestrator the check needs, plus
// the observed log it writes to.
func ceilingOrchestrator(manage bool, probe ClickHouseCeilingProbe, totalMemory uint64) (*Orchestrator, *observer.ObservedLogs) {
	core, logs := observer.New(zap.WarnLevel)
	return &Orchestrator{
		cfg:     Config{ShouldManageClickHouse: manage},
		sys:     &fakeSystem{totalMemory: totalMemory},
		chProbe: probe,
		log:     zap.New(core),
	}, logs
}

// panickedLaptopRAM is the 18 GiB machine the 2026-09-09 watchdog panic
// happened on.
const panickedLaptopRAM = uint64(19327352832)

// @scenario "A ClickHouse that may grow into the whole machine is called out"
func TestWarnUnmanagedClickHouseCeiling(t *testing.T) {
	t.Run("given an unmanaged local ClickHouse with no ceiling of its own", func(t *testing.T) {
		probe := &fakeCeilingProbe{ceiling: domain.ClickHouseCeiling{RAMRatio: domain.DefaultClickHouseRAMRatio}}
		o, logs := ceilingOrchestrator(false, probe, panickedLaptopRAM)
		lwDir := dotenvDir(t, "http://default:langwatch@127.0.0.1:8123/lw_main")

		t.Run("when a stack comes up", func(t *testing.T) {
			o.warnUnmanagedClickHouseCeiling(context.Background(), lwDir)

			t.Run("reads the server named in the environment", func(t *testing.T) {
				if len(probe.asked) != 1 {
					t.Fatalf("probe asked %d times, want 1", len(probe.asked))
				}
			})

			t.Run("warns", func(t *testing.T) {
				if logs.Len() != 1 {
					t.Fatalf("got %d warnings, want 1: %v", logs.Len(), logs.All())
				}
			})

			t.Run("keeps the password out of the warning", func(t *testing.T) {
				if msg := logs.All()[0].Message; strings.Contains(msg, "langwatch@") {
					t.Errorf("warning leaked credentials: %s", msg)
				}
			})

			t.Run("names the server and the way out", func(t *testing.T) {
				msg := logs.All()[0].Message
				for _, want := range []string{"127.0.0.1:8123", "max_server_memory_usage"} {
					if !strings.Contains(msg, want) {
						t.Errorf("missing %q in: %s", want, msg)
					}
				}
			})
		})
	})

	t.Run("given haven manages ClickHouse itself", func(t *testing.T) {
		probe := &fakeCeilingProbe{}
		o, logs := ceilingOrchestrator(true, probe, panickedLaptopRAM)
		lwDir := dotenvDir(t, "http://127.0.0.1:8123")

		t.Run("when a stack comes up", func(t *testing.T) {
			o.warnUnmanagedClickHouseCeiling(context.Background(), lwDir)

			t.Run("does not probe the server it already caps", func(t *testing.T) {
				if len(probe.asked) != 0 || logs.Len() != 0 {
					t.Errorf("probed %v and logged %d times, want neither", probe.asked, logs.Len())
				}
			})
		})
	})

	t.Run("given the configured ClickHouse is not on this machine", func(t *testing.T) {
		probe := &fakeCeilingProbe{}
		o, logs := ceilingOrchestrator(false, probe, panickedLaptopRAM)
		lwDir := dotenvDir(t, "https://clickhouse.internal.example:8443/lw_main")

		t.Run("when a stack comes up", func(t *testing.T) {
			o.warnUnmanagedClickHouseCeiling(context.Background(), lwDir)

			t.Run("judges nothing, because the machine is not ours", func(t *testing.T) {
				if len(probe.asked) != 0 || logs.Len() != 0 {
					t.Errorf("probed %v and logged %d times, want neither", probe.asked, logs.Len())
				}
			})
		})
	})

	t.Run("given the server will not answer", func(t *testing.T) {
		probe := &fakeCeilingProbe{err: context.DeadlineExceeded}
		o, logs := ceilingOrchestrator(false, probe, panickedLaptopRAM)
		lwDir := dotenvDir(t, "http://127.0.0.1:8123")

		t.Run("when a stack comes up", func(t *testing.T) {
			o.warnUnmanagedClickHouseCeiling(context.Background(), lwDir)

			t.Run("stays quiet rather than guessing", func(t *testing.T) {
				if logs.Len() != 0 {
					t.Errorf("got %d warnings, want silence: %v", logs.Len(), logs.All())
				}
			})
		})
	})

	t.Run("given a server already kept to a small share of the machine", func(t *testing.T) {
		probe := &fakeCeilingProbe{ceiling: domain.ClickHouseCeiling{MaxServerMemoryUsage: 1 << 30}}
		o, logs := ceilingOrchestrator(false, probe, panickedLaptopRAM)
		lwDir := dotenvDir(t, "http://127.0.0.1:8123")

		t.Run("when a stack comes up", func(t *testing.T) {
			o.warnUnmanagedClickHouseCeiling(context.Background(), lwDir)

			t.Run("reads it and says nothing", func(t *testing.T) {
				if len(probe.asked) != 1 || logs.Len() != 0 {
					t.Errorf("probed %d times and logged %d, want 1 and 0", len(probe.asked), logs.Len())
				}
			})
		})
	})

	t.Run("given nothing wired a probe", func(t *testing.T) {
		o, logs := ceilingOrchestrator(false, nil, panickedLaptopRAM)
		lwDir := dotenvDir(t, "http://127.0.0.1:8123")

		t.Run("when a stack comes up", func(t *testing.T) {
			t.Run("skips the check instead of panicking", func(t *testing.T) {
				o.warnUnmanagedClickHouseCeiling(context.Background(), lwDir)
				if logs.Len() != 0 {
					t.Errorf("got %d warnings, want silence", logs.Len())
				}
			})
		})
	})
}
