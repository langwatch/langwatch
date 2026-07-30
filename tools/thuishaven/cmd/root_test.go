package cmd

import (
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

func TestStripFlag(t *testing.T) {
	t.Run("when the flag is present", func(t *testing.T) {
		out, found := stripFlag([]string{"a", "--force", "b"}, "--force")
		if !found {
			t.Fatal("stripFlag did not report the flag as found")
		}
		if got, want := len(out), 2; got != want {
			t.Fatalf("remaining args = %q, want length %d", out, want)
		}
		if out[0] != "a" || out[1] != "b" {
			t.Errorf("stripFlag left %q, want [a b]", out)
		}
	})
	t.Run("when the flag is absent", func(t *testing.T) {
		out, found := stripFlag([]string{"a", "b"}, "--force")
		if found {
			t.Error("stripFlag reported an absent flag as found")
		}
		if len(out) != 2 {
			t.Errorf("stripFlag changed args to %q", out)
		}
	})
}

func TestPRWorktreeBaseHonoursEnvOverride(t *testing.T) {
	t.Setenv("HAVEN_WORKTREE_DIR", "/tmp/custom-worktrees")
	if got, want := prWorktreeBase("/anywhere"), "/tmp/custom-worktrees"; got != want {
		t.Errorf("prWorktreeBase = %q, want the HAVEN_WORKTREE_DIR override %q", got, want)
	}
}

func TestPRWorktreeBaseDefaultsToSiblingWorktreesDir(t *testing.T) {
	t.Setenv("HAVEN_WORKTREE_DIR", "")
	repo := gitInitTemp(t)
	// Default base is the sibling worktrees/ dir next to the main checkout. git
	// reports the symlink-resolved checkout path (e.g. /private/var on macOS), so
	// resolve the expected side too rather than comparing raw temp paths.
	resolved, err := filepath.EvalSymlinks(repo)
	if err != nil {
		t.Fatalf("EvalSymlinks(repo) = %v", err)
	}
	if got, want := prWorktreeBase(repo), filepath.Join(filepath.Dir(resolved), "worktrees"); got != want {
		t.Errorf("prWorktreeBase(%q) = %q, want %q", repo, got, want)
	}
}

func TestGitMainWorktreeReturnsPrimaryCheckout(t *testing.T) {
	repo := gitInitTemp(t)
	got, err := filepath.EvalSymlinks(gitMainWorktree(repo))
	if err != nil {
		t.Fatalf("EvalSymlinks(gitMainWorktree) = %v", err)
	}
	want, err := filepath.EvalSymlinks(repo)
	if err != nil {
		t.Fatalf("EvalSymlinks(repo) = %v", err)
	}
	if got != want {
		t.Errorf("gitMainWorktree = %q, want the primary checkout %q", got, want)
	}
}

// gitInitTemp makes a throwaway git repo with one commit, isolated from the
// developer's global/system git config, and returns its path.
func gitInitTemp(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not available")
	}
	dir := t.TempDir()
	run := func(args ...string) {
		cmd := exec.Command("git", args...)
		cmd.Dir = dir
		cmd.Env = append(os.Environ(),
			"GIT_CONFIG_GLOBAL=/dev/null",
			"GIT_CONFIG_SYSTEM=/dev/null",
			"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
			"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t",
		)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	run("init")
	run("commit", "--allow-empty", "-m", "init")
	return dir
}

// @scenario "The managed ClickHouse keeps its own telemetry lightweight"
func TestClickHouseLimitsEnvWiring(t *testing.T) {
	t.Run("given no ClickHouse log env vars", func(t *testing.T) {
		t.Setenv("HAVEN_CLICKHOUSE_FULL_LOGS", "")
		t.Setenv("HAVEN_CLICKHOUSE_LOG_TTL_DAYS", "")

		t.Run("when resolving the limits", func(t *testing.T) {
			l := clickHouseLimits()

			t.Run("keeps lightweight logs on by default", func(t *testing.T) {
				if !l.LightweightLogsEnabled {
					t.Error("lightweight logs off without any env opt-out")
				}
			})
		})
	})

	t.Run("given HAVEN_CLICKHOUSE_FULL_LOGS=1", func(t *testing.T) {
		t.Setenv("HAVEN_CLICKHOUSE_FULL_LOGS", "1")

		t.Run("when resolving the limits", func(t *testing.T) {
			t.Run("restores full stock logging", func(t *testing.T) {
				if clickHouseLimits().LightweightLogsEnabled {
					t.Error("FULL_LOGS=1 did not disable lightweight logs")
				}
			})
		})
	})

	t.Run("given HAVEN_CLICKHOUSE_FULL_LOGS=0", func(t *testing.T) {
		t.Setenv("HAVEN_CLICKHOUSE_FULL_LOGS", "0")

		t.Run("when resolving the limits", func(t *testing.T) {
			t.Run("keeps lightweight logs on — only a truthy value opts out", func(t *testing.T) {
				if !clickHouseLimits().LightweightLogsEnabled {
					t.Error("FULL_LOGS=0 disabled lightweight logs; the flag is documented as =1")
				}
			})
		})
	})

	t.Run("given HAVEN_CLICKHOUSE_LOG_TTL_DAYS=3", func(t *testing.T) {
		t.Setenv("HAVEN_CLICKHOUSE_LOG_TTL_DAYS", "3")

		t.Run("when resolving the limits", func(t *testing.T) {
			t.Run("carries the override into the TTL", func(t *testing.T) {
				if got := clickHouseLimits().SystemLogTTLDays; got != 3 {
					t.Errorf("got TTL %d, want 3", got)
				}
			})
		})
	})
}

// haven's own knobs (LANGWATCH_HAVEN_CH, LANGY_UNSAFE_HOST_ACCESS, …) resolve
// from langwatch/.env as well as the shell, so a machine-level preference like
// "this laptop runs native ClickHouse, never provision one" is pinned next to
// the CLICKHOUSE_URL it belongs with and travels into every new worktree.
func TestResolveKnob(t *testing.T) {
	dotenv := func() map[string]string {
		return map[string]string{"LANGWATCH_HAVEN_CH": "0"}
	}
	unset := func(string) (string, bool) { return "", false }

	t.Run("given a knob set only in the dotenv layers", func(t *testing.T) {
		t.Run("when resolving it", func(t *testing.T) {
			t.Run("falls back to the dotenv value", func(t *testing.T) {
				got, ok := resolveKnob("LANGWATCH_HAVEN_CH", unset, dotenv)
				if !ok || got != "0" {
					t.Errorf(`got (%q, %v), want ("0", true)`, got, ok)
				}
			})
		})
	})

	t.Run("given the same knob exported in the process environment", func(t *testing.T) {
		exported := func(string) (string, bool) { return "1", true }

		t.Run("when resolving it", func(t *testing.T) {
			t.Run("the process environment wins over the dotenv layers", func(t *testing.T) {
				got, _ := resolveKnob("LANGWATCH_HAVEN_CH", exported, dotenv)
				if got != "1" {
					t.Errorf("got %q, want %q; an export must override .env for a one-off run", got, "1")
				}
			})
		})
	})

	t.Run("given a knob exported as the empty string", func(t *testing.T) {
		emptyExport := func(string) (string, bool) { return "", true }

		t.Run("when resolving it", func(t *testing.T) {
			t.Run("reports it as set, so an explicit opt-out is not re-read from .env", func(t *testing.T) {
				got, ok := resolveKnob("LANGWATCH_HAVEN_CH", emptyExport, dotenv)
				if got != "" || !ok {
					t.Errorf(`got (%q, %v), want ("", true)`, got, ok)
				}
			})
		})
	})

	t.Run("given a knob absent from both sources", func(t *testing.T) {
		t.Run("when resolving it", func(t *testing.T) {
			t.Run("reports it unset so the caller's default applies", func(t *testing.T) {
				if _, ok := resolveKnob("LANGWATCH_HAVEN_NOPE", unset, dotenv); ok {
					t.Error("an absent knob must not report as set")
				}
			})
		})
	})

	t.Run("given a knob answered by the process environment", func(t *testing.T) {
		t.Run("when resolving it", func(t *testing.T) {
			t.Run("never reads the dotenv layers", func(t *testing.T) {
				read := false
				counting := func() map[string]string {
					read = true
					return nil
				}
				resolveKnob("LANGWATCH_HAVEN_CH", func(string) (string, bool) { return "1", true }, counting)
				if read {
					t.Error("dotenv was loaded even though the environment answered")
				}
			})
		})
	})
}

// The ENVIRONMENT help text promises that haven's knobs resolve from
// langwatch/.env, and names the ones that do not. That promise is only as good
// as its exclusion list: a knob added on plain os.Getenv without being listed
// reads, to anyone following the docs, as configurable from .env when it
// silently is not. Derive the real list from the source so the two cannot part.
func TestProcessOnlyKnobsAreDocumented(t *testing.T) {
	source, err := os.ReadFile("root.go")
	if err != nil {
		t.Fatalf("read root.go: %v", err)
	}
	help, err := os.ReadFile("help.go")
	if err != nil {
		t.Fatalf("read help.go: %v", err)
	}

	found := regexp.MustCompile(`os\.(?:Getenv|LookupEnv)\("([A-Z_]+)"\)`).
		FindAllStringSubmatch(string(source), -1)
	if len(found) == 0 {
		t.Fatal("no os.Getenv knobs found: the pattern stopped matching, not a clean bill of health")
	}

	for _, match := range found {
		key := match[1]
		if !strings.Contains(string(help), key) {
			t.Errorf(
				"%s is read straight from the process environment but never named in help.go: "+
					"either route it through devEnv or add it to the ENVIRONMENT exclusion list",
				key,
			)
		}
	}
}

// onlyRemovedKnobSet clears every removed selection variable, then sets one.
// rejectRemovedSelectionEnv reports the FIRST variable that applies, and it
// resolves through langwatch/.env as well as the environment — so without this
// a developer whose own .env still carries one of these would see these tests
// assert against the wrong variable's error.
func onlyRemovedKnobSet(t *testing.T, name, value string) {
	t.Helper()
	for _, knob := range removedSelectionEnv {
		t.Setenv(knob.name, "")
	}
	t.Setenv(name, value)
}

// The selection env vars are gone, not quietly ignored: a stale export would
// otherwise start services the developer believes they turned off, and `haven
// status` would report a selection the env had overridden behind its back.
//
// @scenario "Removed selection env vars name their replacement"
func TestRejectRemovedSelectionEnv(t *testing.T) {
	t.Run("given a removed selection variable set to the value that used to apply", func(t *testing.T) {
		for _, tc := range []struct{ name, value, wantReplacement string }{
			{"LANGWATCH_SKIP_NLP", "1", "haven up -nlp"},
			{"LANGWATCH_SKIP_AIGATEWAY", "1", "haven up -gateway"},
			{"LANGWATCH_SKIP_LANGYAGENT", "1", "haven up -langy"},
			{"WORKERS_IN_PROCESS", "0", "haven up +workers"},
		} {
			t.Run("when up runs with "+tc.name, func(t *testing.T) {
				t.Run("fails naming the sticky command that replaces it", func(t *testing.T) {
					onlyRemovedKnobSet(t, tc.name, tc.value)
					err := rejectRemovedSelectionEnv()
					if err == nil {
						t.Fatalf("%s=%s was accepted; it no longer selects services", tc.name, tc.value)
					}
					if !strings.Contains(err.Error(), tc.wantReplacement) {
						t.Errorf("error %q does not point at %q", err, tc.wantReplacement)
					}
				})
			})
		}
	})

	// START_WORKERS is the one with nothing to point at: it turned the worker
	// stack off entirely, and there is no way to do that any more. Offering
	// `+workers` here would be wrong in the opposite direction — that STARTS a
	// standalone lane, so a developer following it would get more than before,
	// not less.
	t.Run("given START_WORKERS=false, which nothing replaces", func(t *testing.T) {
		t.Run("when up runs", func(t *testing.T) {
			onlyRemovedKnobSet(t, "START_WORKERS", "false")
			err := rejectRemovedSelectionEnv()
			if err == nil {
				t.Fatal("START_WORKERS=false was accepted; it no longer turns the workers off")
			}

			t.Run("says it does nothing rather than naming a replacement", func(t *testing.T) {
				if !strings.Contains(err.Error(), "no longer does anything") {
					t.Errorf("error %q should say the variable does nothing", err)
				}
				if strings.Contains(err.Error(), "run `") {
					t.Errorf("error %q offers a replacement command; there is none", err)
				}
			})

			t.Run("explains where the worker stack lives now", func(t *testing.T) {
				if !strings.Contains(err.Error(), "part of the app") {
					t.Errorf("error %q does not say the workers are part of the app now", err)
				}
			})
		})
	})
}

// The refusal has to read intent, not one literal. start.sh tests
// LANGWATCH_SKIP_* against "1" and START_WORKERS against "true" or "1";
// start.ts tests WORKERS_IN_PROCESS against "1" or "true". Matching any single
// one of those exactly lets a developer's "off" or "yes" through, and through
// means haven runs a service they believe they turned off — silently, which is
// the one outcome this mechanism exists to prevent.
//
// @scenario "A removed selection variable is read for intent, not one spelling"
func TestRemovedSelectionEnvIsReadForIntentNotOneSpelling(t *testing.T) {
	t.Run("given a value that means off in every spelling but the one that was matched", func(t *testing.T) {
		for _, value := range []string{"0", "false", "FALSE", "False", "off", "no", "  0  "} {
			t.Run("when up runs with WORKERS_IN_PROCESS="+value, func(t *testing.T) {
				onlyRemovedKnobSet(t, "WORKERS_IN_PROCESS", value)
				err := rejectRemovedSelectionEnv()
				if err == nil {
					t.Fatalf("WORKERS_IN_PROCESS=%q was accepted; the app reads it as a standalone workers lane", value)
				}
				if !strings.Contains(err.Error(), "haven up +workers") {
					t.Errorf("error %q does not point at the sticky replacement", err)
				}
			})
		}
	})

	t.Run("given a value that means on in every spelling", func(t *testing.T) {
		for _, value := range []string{"yes", "on", "TRUE", "True"} {
			t.Run("when up runs with LANGWATCH_SKIP_NLP="+value, func(t *testing.T) {
				onlyRemovedKnobSet(t, "LANGWATCH_SKIP_NLP", value)
				err := rejectRemovedSelectionEnv()
				if err == nil {
					t.Fatalf("LANGWATCH_SKIP_NLP=%q was accepted; haven would run nlp for someone who believes it is off", value)
				}
				if !strings.Contains(err.Error(), "haven up -nlp") {
					t.Errorf("error %q does not point at the sticky replacement", err)
				}
			})
		}
	})

	// Blanking a line is how a .env unsets a knob. There is no intent left in it
	// to refuse, and refusing would leave the developer deleting an empty line to
	// start a stack.
	t.Run("given a variable blanked out to nothing", func(t *testing.T) {
		for _, name := range []string{"WORKERS_IN_PROCESS", "START_WORKERS", "LANGWATCH_SKIP_NLP"} {
			t.Run("when up runs with "+name+" empty", func(t *testing.T) {
				onlyRemovedKnobSet(t, name, "")
				if err := rejectRemovedSelectionEnv(); err != nil {
					t.Errorf("%s= blocked a stack: %v", name, err)
				}
			})
		}
	})

	// START_WORKERS=true is what `pnpm dev` itself exports, so a checkout that
	// carries it must still be able to start a stack.
	t.Run("given START_WORKERS set to what pnpm dev exports", func(t *testing.T) {
		t.Run("when up runs", func(t *testing.T) {
			onlyRemovedKnobSet(t, "START_WORKERS", "true")
			if err := rejectRemovedSelectionEnv(); err != nil {
				t.Errorf("START_WORKERS=true blocked a stack: %v", err)
			}
		})
	})
}

// WORKERS_IN_PROCESS=1 is still how plain `pnpm dev` asks for a single process
// outside haven, and it is what haven itself passes to the app child. Only the
// values that used to steer haven's own selection are refused, so a checkout
// carrying it can still start a stack.
//
// @scenario "A variable haven never read as a selection does not block a stack"
func TestWorkersInProcessOneDoesNotBlockUp(t *testing.T) {
	t.Run("given WORKERS_IN_PROCESS=1", func(t *testing.T) {
		t.Run("when up runs", func(t *testing.T) {
			t.Run("starts normally", func(t *testing.T) {
				onlyRemovedKnobSet(t, "WORKERS_IN_PROCESS", "1")
				if err := rejectRemovedSelectionEnv(); err != nil {
					t.Errorf("WORKERS_IN_PROCESS=1 must not block up: %v", err)
				}
			})
		})
	})
}
