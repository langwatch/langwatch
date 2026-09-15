package apidiff

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// These cases bind "A fresh worktree is prepared before either stack boots"
// in specs/tooling/apidiff-on-haven.feature. Run 20260910-044221 is what they
// guard against: a fresh worktree with no install, no generated files and no
// built SDK, dying in haven's own prepare phase before it ever reached
// migrate, and a timeout that then said only "backend log unavailable".

// modularWorktree makes dir look like a modular-layout checkout to
// detectProfile, the same setup worktreeCreatingRunner uses for `git
// worktree add`.
func modularWorktree(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "apps", "api"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "apps", "api", "package.json"), []byte(`{"name":"@langwatch/platform-api"}`), 0o600); err != nil {
		t.Fatal(err)
	}
}

// @scenario "A fresh worktree is prepared before its stack boots"
func TestAFreshWorktreeIsPreparedBeforeItsStackBoots(t *testing.T) {
	t.Run("given a fresh worktree with none of a developer checkout's generated or built artifacts", func(t *testing.T) {
		invoking := t.TempDir()
		if err := os.WriteFile(filepath.Join(invoking, ".env"), []byte("CREDENTIALS_SECRET=do-not-log-me"), 0o600); err != nil {
			t.Fatal(err)
		}
		mainDir, branchDir := t.TempDir(), t.TempDir()
		modularWorktree(t, mainDir)
		modularWorktree(t, branchDir)

		fake := &fakeHaven{}
		var log bytes.Buffer
		state := &bootState{cfg: BootConfig{UseHaven: true, BranchDir: invoking}, stderr: &log, run: fake.run}
		booted := &Booted{A: Instance{Name: "branch", Dir: branchDir}, B: Instance{Name: "main", Dir: mainDir}}

		t.Run("when the worktree is prepared, before haven up runs", func(t *testing.T) {
			if err := state.prepareHavenInstances(context.Background(), booted); err != nil {
				t.Fatalf("prepareHavenInstances: %v", err)
			}

			t.Run("then the developer's own .env is copied into each worktree", func(t *testing.T) {
				for _, dir := range []string{mainDir, branchDir} {
					got, err := os.ReadFile(filepath.Join(dir, ".env"))
					if err != nil {
						t.Fatalf("read copied .env in %s: %v", dir, err)
					}
					if string(got) != "CREDENTIALS_SECRET=do-not-log-me" {
						t.Errorf(".env copied with the wrong content: %q", got)
					}
				}
			})

			t.Run("then pnpm install, the generated-files step and the modular build step all ran, per worktree", func(t *testing.T) {
				want := []string{
					"env -u CI pnpm install --frozen-lockfile",
					"pnpm run start:prepare:files",
					"node dev/scripts/ensure-built.mjs",
				}
				for _, dir := range []string{mainDir, branchDir} {
					var got []string
					for _, spec := range fake.commands {
						if spec.dir == dir {
							got = append(got, spec.name+" "+strings.Join(spec.args, " "))
						}
					}
					if strings.Join(got, "\n") != strings.Join(want, "\n") {
						t.Errorf("prepare commands for %s = %v, want %v", dir, got, want)
					}
				}
			})

			t.Run("then every step's name and exit status are written to the run log, never a byte of .env's contents", func(t *testing.T) {
				out := log.String()
				for _, want := range []string{
					"env -u CI pnpm install --frozen-lockfile",
					"pnpm run start:prepare:files",
					"node dev/scripts/ensure-built.mjs",
					"copy .env files exit=ok (copied 1)",
				} {
					if !strings.Contains(out, want) {
						t.Errorf("run log missing %q:\n%s", want, out)
					}
				}
				if strings.Contains(out, "do-not-log-me") {
					t.Errorf("run log leaked .env's contents:\n%s", out)
				}
			})
		})
	})
}

// @scenario "A boot that never becomes ready reports progress and a real log tail"
func TestABootThatNeverBecomesReadyReportsProgressAndARealLogTail(t *testing.T) {
	t.Run("given an instance's stack has not become ready", func(t *testing.T) {
		var log bytes.Buffer
		state := &bootState{stderr: &log}
		progress := newHavenProgress(time.Now().Add(time.Minute))
		progress.nextAt = time.Now().Add(-time.Second) // already due

		t.Run("when the run waits past its progress interval", func(t *testing.T) {
			progress.reportIfDue(state, "branch", "apidiff-run-branch")

			t.Run("then it logs that it is still waiting, with the time elapsed and the time left", func(t *testing.T) {
				out := log.String()
				for _, want := range []string{"branch", "apidiff-run-branch", "elapsed", "left"} {
					if !strings.Contains(out, want) {
						t.Errorf("progress log %q missing %q", out, want)
					}
				}
			})

			t.Run("and it does not report again before the next interval is due", func(t *testing.T) {
				before := log.Len()
				progress.reportIfDue(state, "branch", "apidiff-run-branch")
				if log.Len() != before {
					t.Error("reportIfDue logged twice inside one interval")
				}
			})
		})
	})

	t.Run("given the stack's own haven log exists on disk", func(t *testing.T) {
		home := t.TempDir()
		t.Setenv("LANGWATCH_PORTLESS_HOME", home)
		const slug = "apidiff-run-main"
		if err := os.MkdirAll(filepath.Join(home, "logs"), 0o750); err != nil {
			t.Fatal(err)
		}
		content := "line one\nEACCES: permission denied, open '/repos/.../server.mts'\n"
		if err := os.WriteFile(havenrun.StackLogFile(slug), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		fake := &fakeHaven{backendLog: "this is the haven-logs command output, not the file"}
		state := havenState(fake, time.Minute)
		plan := havenPlan{instance: "main", slug: slug, dir: "/repos/langwatch/.apidiff/run/main"}
		instance := Instance{Name: "main", Dir: plan.dir, Profile: bootProfile{name: profileModular}}

		t.Run("when the run gives up, the tail is read directly from that file", func(t *testing.T) {
			got := state.havenBackendLog(context.Background(), plan, instance)
			if !strings.Contains(got, "EACCES: permission denied") {
				t.Errorf("log tail = %q, want the file's own content", got)
			}
			if strings.Contains(got, "haven-logs command output") {
				t.Error("the file on disk must win over the haven logs command")
			}
			for _, spec := range fake.commands {
				if len(spec.args) > 0 && spec.args[0] == "logs" {
					t.Errorf("haven logs ran even though the stack's own log file was readable: %v", spec)
				}
			}
		})
	})

	t.Run("given the stack's own haven log is not on disk", func(t *testing.T) {
		t.Setenv("LANGWATCH_PORTLESS_HOME", t.TempDir())
		fake := &fakeHaven{backendLog: "line one\nEACCES: permission denied, open '/repos/.../server.mts'\n"}
		state := havenState(fake, time.Minute)
		plan := havenPlan{instance: "branch", slug: "apidiff-run-branch-missing", dir: "/repos/langwatch"}
		instance := Instance{Name: "branch", Dir: plan.dir, Profile: bootProfile{name: profileModular}}

		t.Run("when the run gives up, it falls back to haven logs for the backend lane", func(t *testing.T) {
			got := state.havenBackendLog(context.Background(), plan, instance)
			if !strings.Contains(got, "EACCES: permission denied") {
				t.Errorf("log tail = %q, want the fake haven logs output", got)
			}
		})
	})
}
