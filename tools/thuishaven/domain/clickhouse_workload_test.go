package domain

import (
	"strings"
	"testing"
)

func TestClickHouseWorkloads(t *testing.T) {
	t.Run("given a stack database", func(t *testing.T) {
		const db = "lw_feat_x"

		t.Run("names its login and workload after the slug", func(t *testing.T) {
			if got := ClickHouseStackUserFor(db); got != "lw_feat_x_app" {
				t.Errorf("user = %q", got)
			}
			if got := ClickHouseStackWorkloadFor(db); got != "stack_feat_x" {
				t.Errorf("workload = %q", got)
			}
		})

		t.Run("when provisioning, the workload sits under stacks and the login carries it", func(t *testing.T) {
			got := strings.Join(ClickHouseStackAccessStatements(db, "secret", 512), "\n")
			for _, want := range []string{
				"CREATE WORKLOAD IF NOT EXISTS `stack_feat_x` IN `stacks` SETTINGS weight = 1",
				"CREATE USER IF NOT EXISTS `lw_feat_x_app` IDENTIFIED WITH sha256_password BY 'secret'",
				"SETTINGS PROFILE 'default', workload = 'stack_feat_x', max_memory_usage_for_user = 512",
				"GRANT ALL ON `lw_feat_x`.* TO `lw_feat_x_app` WITH GRANT OPTION",
				"GRANT SELECT ON system.* TO `lw_feat_x_app`",
				"GRANT ACCESS MANAGEMENT ON *.* TO `lw_feat_x_app` WITH GRANT OPTION",
				"GRANT CREATE FUNCTION, DROP FUNCTION ON *.* TO `lw_feat_x_app`",
			} {
				if !strings.Contains(got, want) {
					t.Errorf("missing %q in:\n%s", want, got)
				}
			}
		})

		t.Run("when the server has no memory ceiling, the login gets no cap", func(t *testing.T) {
			got := strings.Join(ClickHouseStackAccessStatements(db, "secret", 0), "\n")
			if strings.Contains(got, "max_memory_usage_for_user") {
				t.Errorf("want no memory cap, got:\n%s", got)
			}
		})

		t.Run("when a password holds a quote, it stays one literal", func(t *testing.T) {
			got := ClickHouseStackAccessStatements(db, `a'b\c`, 0)[1]
			if !strings.HasSuffix(got, `BY 'a\'b\\c'`) {
				t.Errorf("got %q", got)
			}
		})

		t.Run("when re-weighting, the workload is replaced in place", func(t *testing.T) {
			got := ClickHouseStackWeightStatement(db, FocusedStackWorkloadWeight)
			if got != "CREATE OR REPLACE WORKLOAD `stack_feat_x` IN `stacks` SETTINGS weight = 3" {
				t.Errorf("got %q", got)
			}
		})

		t.Run("when dropping, the login goes before the workload", func(t *testing.T) {
			got := ClickHouseDropStackAccessStatements(db)
			if len(got) != 2 || got[0] != "DROP USER IF EXISTS `lw_feat_x_app`" || got[1] != "DROP WORKLOAD IF EXISTS `stack_feat_x`" {
				t.Errorf("got %v", got)
			}
		})
	})

	t.Run("given the hierarchy", func(t *testing.T) {
		got := ClickHouseWorkloadHierarchyStatements(8)

		t.Run("declares the CPU resource before any workload", func(t *testing.T) {
			if got[0] != "CREATE RESOURCE IF NOT EXISTS cpu (MASTER THREAD, WORKER THREAD)" {
				t.Errorf("first = %q", got[0])
			}
		})
		t.Run("caps the root at the cores and merges at their own cap", func(t *testing.T) {
			joined := strings.Join(got, "\n")
			for _, want := range []string{
				"CREATE OR REPLACE WORKLOAD `all` SETTINGS max_concurrent_threads = 8",
				"CREATE OR REPLACE WORKLOAD `merges` IN `all` SETTINGS max_concurrent_threads = 2",
				"CREATE WORKLOAD IF NOT EXISTS `stacks` IN `all`",
				"CREATE WORKLOAD IF NOT EXISTS `default` IN `stacks`",
			} {
				if !strings.Contains(joined, want) {
					t.Errorf("missing %q in:\n%s", want, joined)
				}
			}
		})
		t.Run("never caps the root below one thread", func(t *testing.T) {
			if !strings.Contains(ClickHouseWorkloadHierarchyStatements(0)[1], "max_concurrent_threads = 1") {
				t.Error("want a floor of one thread")
			}
		})
	})

	t.Run("caps a stack at half the server's memory", func(t *testing.T) {
		if got := ClickHouseStackUserMemory(1000); got != 500 {
			t.Errorf("got %d", got)
		}
	})
}

func TestRenderClickHouseConfigSchedulesWorkloads(t *testing.T) {
	cfg := RenderClickHouseConfig(DefaultClickHouseLimits(0))
	for _, want := range []string{
		"<cpu_slot_preemption>true</cpu_slot_preemption>",
		"<merge_workload>merges</merge_workload>",
		"<mutation_workload>merges</mutation_workload>",
		"<throw_on_unknown_workload>false</throw_on_unknown_workload>",
	} {
		if !strings.Contains(cfg, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestOverlayClickHouseLogin(t *testing.T) {
	base := Stack{ClickHouseHTTPPort: 8123, ClickHouseDatabase: "lw_feat_x"}

	t.Run("given no stack login, the app uses the shared admin login", func(t *testing.T) {
		if got := EnvMap(base.OverlayEnv())["CLICKHOUSE_URL"]; got != "http://default:langwatch@127.0.0.1:8123/lw_feat_x" {
			t.Errorf("got %q", got)
		}
	})
	t.Run("given a stack login, the app connects as it", func(t *testing.T) {
		st := base
		st.ClickHouseUser, st.ClickHousePassword = "lw_feat_x_app", "pw"
		if got := EnvMap(st.OverlayEnv())["CLICKHOUSE_URL"]; got != "http://lw_feat_x_app:pw@127.0.0.1:8123/lw_feat_x" {
			t.Errorf("got %q", got)
		}
	})
}

func TestClickHouseStackPasswordIsGeneratedNotInjected(t *testing.T) {
	stored, added, err := FillStackCredentials(map[string]string{})
	if err != nil || !added || len(stored[ClickHouseStackPasswordKey]) != 64 {
		t.Fatalf("want a minted password, got added=%v err=%v", added, err)
	}
	if _, ok := EnvMap(StackCredentialsEnv(stored, map[string]string{}))[ClickHouseStackPasswordKey]; ok {
		t.Fatal("the password travels only inside CLICKHOUSE_URL")
	}
	again, _, _ := FillStackCredentials(stored)
	if again[ClickHouseStackPasswordKey] != stored[ClickHouseStackPasswordKey] {
		t.Fatal("a stored password must survive, or every up re-keys the login")
	}
}
