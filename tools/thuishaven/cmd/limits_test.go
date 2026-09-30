package cmd

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// isolateLimits gives a test its own haven home and an empty .env, and takes
// every limit knob out of the process environment.
func isolateLimits(t *testing.T) {
	t.Helper()
	t.Setenv("LANGWATCH_PORTLESS_HOME", t.TempDir())
	dotenvOnce.Do(func() {})
	previous := dotenvVars
	dotenvVars = map[string]string{}
	t.Cleanup(func() { dotenvVars = previous })
	for _, l := range domain.Limits {
		t.Setenv(l.Env, "")
		_ = os.Unsetenv(l.Env)
	}
}

func runLimitsArgs(t *testing.T, args ...string) (string, error) {
	t.Helper()
	var err error
	out := captureStdout(t, func() {
		err = runLimits(context.Background(), deps{}, invocation{args: args, flags: map[string]string{}})
	})
	return out, err
}

func limitsJSON(t *testing.T) domain.LimitsReport {
	t.Helper()
	var report domain.LimitsReport
	out := captureStdout(t, func() {
		if err := runLimits(context.Background(), deps{}, invocation{flags: map[string]string{"--json": ""}}); err != nil {
			t.Fatal(err)
		}
	})
	if err := json.Unmarshal([]byte(out), &report); err != nil {
		t.Fatalf("haven limits --json is not JSON: %v\n%s", err, out)
	}
	return report
}

// @scenario "A limit resolves from the environment, then .env, then the settings file, then its default"
func TestLimitPrecedence(t *testing.T) {
	const key = "HAVEN_REDIS_MAXMEMORY_MB"
	env := func(v string) func(string) (string, bool) {
		return func(string) (string, bool) { return v, v != "" }
	}
	dotenv := func(v string) func() map[string]string {
		return func() map[string]string {
			if v == "" {
				return nil
			}
			return map[string]string{key: v}
		}
	}
	settings := func() map[string]string { return map[string]string{key: "100"} }

	t.Run("given the same limit in every layer", func(t *testing.T) {
		cases := []struct{ name, env, dotenv, want, source string }{
			{"the process environment wins", "300", "200", "300", "env"},
			{".env wins over the settings file", "", "200", "200", ".env"},
			{"the settings file is used when nothing above sets it", "", "", "100", "settings"},
		}
		for _, c := range cases {
			t.Run("when "+c.name, func(t *testing.T) {
				got, source, ok := resolveKnobSource(key, knobLayers{lookup: env(c.env), dotenv: dotenv(c.dotenv), settings: settings})
				if !ok || got != c.want || source != c.source {
					t.Errorf("got (%q, %q, %v), want (%q, %q, true)", got, source, ok, c.want, c.source)
				}
			})
		}
	})

	t.Run("given a knob that is not a limit", func(t *testing.T) {
		t.Run("the settings file is never read", func(t *testing.T) {
			read := func() map[string]string { t.Fatal("settings read for a non-limit knob"); return nil }
			if _, _, ok := resolveKnobSource("LANGWATCH_PORTLESS_HOME", knobLayers{lookup: env(""), dotenv: dotenv(""), settings: read}); ok {
				t.Error("a non-limit knob must not resolve from the settings file")
			}
		})
	})

	t.Run("given a limit set in no layer", func(t *testing.T) {
		t.Run("the report names the computed default as its source", func(t *testing.T) {
			none := func(string) (string, string, bool) { return "", "", false }
			report := domain.ResolveLimits(domain.LimitMachine{TotalRAMBytes: 64 << 30, NumCPU: 16}, "default", none)
			for _, v := range report.Limits {
				if v.Source != "default" || v.Value != v.Default {
					t.Errorf("%s: got %d from %s, want the default %d", v.Name, v.Value, v.Source, v.Default)
				}
			}
		})
	})
}

// @scenario "haven limits set and unset round-trip through the settings file"
func TestLimitsSetUnsetRoundTrip(t *testing.T) {
	t.Run("given no settings file", func(t *testing.T) {
		isolateLimits(t)
		before := limitValue(limitsJSON(t), domain.LimitRedisMaxMemory)

		t.Run("when a limit is set", func(t *testing.T) {
			out, err := runLimitsArgs(t, "set", "redis-maxmemory-mb", "256")
			if err != nil {
				t.Fatal(err)
			}

			t.Run("it is saved, read by every knob reader, and reported with its source", func(t *testing.T) {
				if got := devEnv("HAVEN_REDIS_MAXMEMORY_MB"); got != "256" {
					t.Errorf("devEnv = %q, want 256", got)
				}
				v := limitValue(limitsJSON(t), domain.LimitRedisMaxMemory)
				if v.Value != 256 || v.Source != "settings" {
					t.Errorf("got %d from %s, want 256 from settings", v.Value, v.Source)
				}
				if !strings.Contains(out, "applies next `haven up`") {
					t.Errorf("the answer should say when it applies, got %q", out)
				}
			})

			t.Run("and the environment still wins over it", func(t *testing.T) {
				t.Setenv("HAVEN_REDIS_MAXMEMORY_MB", "64")
				if v := limitValue(limitsJSON(t), domain.LimitRedisMaxMemory); v.Value != 64 || v.Source != "env" {
					t.Errorf("got %d from %s, want 64 from env", v.Value, v.Source)
				}
			})
		})

		t.Run("when it is unset again", func(t *testing.T) {
			if _, err := runLimitsArgs(t, "unset", "redis-maxmemory-mb"); err != nil {
				t.Fatal(err)
			}

			t.Run("nothing is left on disk and the default applies", func(t *testing.T) {
				if _, err := os.Stat(limitsPath()); !os.IsNotExist(err) {
					t.Errorf("settings file should be gone, stat err = %v", err)
				}
				if v := limitValue(limitsJSON(t), domain.LimitRedisMaxMemory); v.Value != before.Default || v.Source != "default" {
					t.Errorf("got %d from %s, want the default %d", v.Value, v.Source, before.Default)
				}
			})
		})
	})

	t.Run("given values that make no sense", func(t *testing.T) {
		isolateLimits(t)
		if _, err := runLimitsArgs(t, "set", "clickhouse-memory-mb", "4096"); err != nil {
			t.Fatal(err)
		}

		refused := []struct{ name, limit, value string }{
			{"a value under the floor", "clickhouse-memory-mb", "16"},
			{"a value over what the machine has", "test-workers", "100000"},
			{"a ClickHouse cap the colima VM cannot hold", "colima-memory-gib", "2"},
			{"a name nobody knows", "clickhouse-ram", "2048"},
		}
		for _, c := range refused {
			t.Run("when "+c.name+" is set", func(t *testing.T) {
				if _, err := runLimitsArgs(t, "set", c.limit, c.value); err == nil {
					t.Error("expected a refusal")
				}
			})
		}

		t.Run("the settings file holds only what was accepted", func(t *testing.T) {
			if got := readLimitSettings(); len(got) != 1 || got[domain.LimitClickHouseMemory] != 4096 {
				t.Errorf("settings = %v, want only clickhouse-memory-mb 4096", got)
			}
		})
	})

	t.Run("given a colima limit", func(t *testing.T) {
		isolateLimits(t)
		t.Run("the report prints the exact restart command", func(t *testing.T) {
			v := limitValue(limitsJSON(t), domain.LimitColimaCPUs)
			if !strings.Contains(v.Applies, "colima stop && colima start --cpu ") {
				t.Errorf("applies = %q", v.Applies)
			}
		})
	})
}
