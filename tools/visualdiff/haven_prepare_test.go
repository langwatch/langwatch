package visualdiff

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// These cases bind the "A fresh worktree is prepared before its stack boots"
// rule in specs/tooling/visualdiff-on-haven.feature. Run 20260910-013825 is
// what they guard against: a fresh worktree with no install, no generated
// files and no built SDK, both refs dying in haven's own prepare phase
// before either ever reached migrate.

// @scenario "A fresh worktree is prepared before its stack boots"
func TestAFreshWorktreeIsPreparedBeforeItsStackBoots(t *testing.T) {
	t.Run("given a fresh worktree with none of a developer checkout's generated or built artifacts", func(t *testing.T) {
		t.Run("when the worktree is prepared, before haven up runs", func(t *testing.T) {
			fake := &fakeHavenRunner{readyStacks: map[string]string{
				HavenSlug(testRunID, "base"):      "https://app.visualdiff-" + testRunID + "-base.langwatch.localhost",
				HavenSlug(testRunID, "candidate"): "https://app.visualdiff-" + testRunID + "-candidate.langwatch.localhost",
			}}
			run := havenTestSession(fake, time.Minute)
			run.request.Deps.Layout = func(string) (Layout, error) { return LayoutModular, nil }
			copyEnvCalls := 0
			run.request.Deps.CopyEnv = func(context.Context, string, string) (int, error) {
				copyEnvCalls++
				return 3, nil
			}
			var log bytes.Buffer
			run.streams.Err = &log

			if err := run.bringUpHaven(context.Background()); err != nil {
				t.Fatalf("bringUpHaven: %v", err)
			}

			base := firstStackCommands(t, fake.commands, "/repos/langwatch/.visualdiff/run/base")
			want := []string{
				"git worktree add --detach /repos/langwatch/.visualdiff/run/base origin/main",
				"env -u CI pnpm install --frozen-lockfile",
				"pnpm run start:prepare:files",
				"node dev/scripts/ensure-built.mjs",
			}
			if got := argvList(base); !equalStrings(got, want) {
				t.Fatalf("base prepare commands = %v, want %v", got, want)
			}

			t.Run("then the developer's own .env is copied into the worktree", func(t *testing.T) {
				if copyEnvCalls != 2 {
					t.Errorf("CopyEnv called %d times, want 2 (once per stack)", copyEnvCalls)
				}
			})

			t.Run("and every step's name and exit status are written to the run log, never a byte of .env's contents", func(t *testing.T) {
				out := log.String()
				for _, want := range []string{
					"env -u CI pnpm install --frozen-lockfile",
					"pnpm run start:prepare:files",
					"node dev/scripts/ensure-built.mjs",
					"copy .env files exit=ok (copied 3)",
				} {
					if !strings.Contains(out, want) {
						t.Errorf("run log missing %q:\n%s", want, out)
					}
				}
				if strings.Contains(out, "SECRET") || strings.Contains(out, "sk-user") {
					t.Errorf("run log leaked something that looks like a credential:\n%s", out)
				}
			})
		})
	})
}

// @scenario "A monolith worktree's own generated-files step already builds the SDK"
func TestAMonolithWorktreesOwnGeneratedFilesStepAlreadyBuildsTheSDK(t *testing.T) {
	t.Run("given a checkout on the monolith layout", func(t *testing.T) {
		t.Run("when the worktree is prepared", func(t *testing.T) {
			modular := HavenPrepareCommands(LayoutModular)
			monolith := HavenPrepareCommands(LayoutMonolith)

			t.Run("then it runs the same generated-files command as the modular layout", func(t *testing.T) {
				modularGenerate := findCommand(t, modular, "pnpm", "run", "start:prepare:files")
				monolithGenerate := findCommand(t, monolith, "pnpm", "run", "start:prepare:files")
				if argv(modularGenerate) != argv(monolithGenerate) {
					t.Errorf("generated-files command differs: modular %q, monolith %q", argv(modularGenerate), argv(monolithGenerate))
				}
			})

			t.Run("and it runs no separate build step for the langwatch SDK or the MCP server", func(t *testing.T) {
				for _, spec := range monolith {
					if spec.name == "node" {
						t.Errorf("monolith prepare must not run ensure-built.mjs (its own start:prepare:files already builds the SDK): %q", argv(spec))
					}
				}
				found := false
				for _, spec := range modular {
					if spec.name == "node" && len(spec.args) > 0 && spec.args[0] == "dev/scripts/ensure-built.mjs" {
						found = true
					}
				}
				if !found {
					t.Error("modular prepare must run dev/scripts/ensure-built.mjs")
				}
			})
		})
	})
}

// @scenario "A tracked dotenv file is never overwritten"
func TestATrackedDotenvFileIsNeverOverwritten(t *testing.T) {
	t.Run("given the workspace root holds both an untracked .env and the tracked .env.example", func(t *testing.T) {
		root := t.TempDir()
		writeFile(t, filepath.Join(root, ".env"), "CREDENTIALS_SECRET=do-not-log-me")
		writeFile(t, filepath.Join(root, ".env.example"), "CREDENTIALS_SECRET=")

		dir := t.TempDir()
		runGit(t, dir, "init")
		writeFile(t, filepath.Join(dir, ".env.example"), "CREDENTIALS_SECRET=# already here, tracked")
		runGit(t, dir, "add", ".env.example")

		t.Run("when the developer's own .env is copied into the worktree", func(t *testing.T) {
			copied, err := CopyEnvFiles(context.Background(), root, dir)
			if err != nil {
				t.Fatalf("CopyEnvFiles: %v", err)
			}

			t.Run("then .env is copied into the worktree", func(t *testing.T) {
				if copied != 1 {
					t.Errorf("copied = %d, want 1", copied)
				}
				got, err := os.ReadFile(filepath.Join(dir, ".env"))
				if err != nil {
					t.Fatalf("read copied .env: %v", err)
				}
				if string(got) != "CREDENTIALS_SECRET=do-not-log-me" {
					t.Errorf(".env copied with the wrong content: %q", got)
				}
			})

			t.Run("and .env.example is left alone", func(t *testing.T) {
				got, err := os.ReadFile(filepath.Join(dir, ".env.example"))
				if err != nil {
					t.Fatalf("read .env.example: %v", err)
				}
				if string(got) != "CREDENTIALS_SECRET=# already here, tracked" {
					t.Errorf(".env.example was overwritten: %q", got)
				}
			})
		})
	})
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %s: %v\n%s", strings.Join(args, " "), err, out)
	}
}

// argv renders one commandSpec's argv, for equality checks against a want
// string built the same way.
func argv(spec commandSpec) string {
	return strings.TrimSpace(spec.name + " " + strings.Join(spec.args, " "))
}

// argvList renders a slice of commandSpecs.
func argvList(specs []commandSpec) []string {
	rendered := make([]string, 0, len(specs))
	for _, spec := range specs {
		rendered = append(rendered, argv(spec))
	}
	return rendered
}

// firstStackCommands returns the leading run of recorded commands whose dir
// is stackDir (or, for the worktree-add step, whose second arg is stackDir) -
// i.e. everything checkoutForHaven ran for one stack before this run moved
// on to the next one.
func firstStackCommands(t *testing.T, commands []commandSpec, stackDir string) []commandSpec {
	t.Helper()
	var out []commandSpec
	for _, spec := range commands {
		belongs := spec.dir == stackDir
		if !belongs && len(spec.args) > 1 && spec.args[0] == "worktree" && spec.args[1] == "add" {
			for _, arg := range spec.args {
				if arg == stackDir {
					belongs = true
				}
			}
		}
		if !belongs {
			if len(out) == 0 {
				continue
			}
			break
		}
		out = append(out, spec)
	}
	if len(out) == 0 {
		t.Fatalf("no commands recorded for %s among %d commands", stackDir, len(commands))
	}
	return out
}

func findCommand(t *testing.T, specs []commandSpec, name string, args ...string) commandSpec {
	t.Helper()
	for _, spec := range specs {
		if spec.name != name || len(spec.args) != len(args) {
			continue
		}
		match := true
		for i, arg := range args {
			if spec.args[i] != arg {
				match = false
				break
			}
		}
		if match {
			return spec
		}
	}
	t.Fatalf("no command %s %v among %v", name, args, argvList(specs))
	return commandSpec{}
}

func equalStrings(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
