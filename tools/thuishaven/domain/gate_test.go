package domain

import (
	"strings"
	"testing"
	"time"
)

// @scenario "Only a named set of commands is treated as heavy"
// @scenario "A command that is not heavy is waved through"
func TestClassifyCommandGatesOnlyWhatIsHeavy(t *testing.T) {
	t.Run("given ordinary commands", func(t *testing.T) {
		t.Run("they are not heavy, because gating them would be its own outage", func(t *testing.T) {
			for _, cmd := range []string{"ls -la", "git status", "cat README.md", "echo hi"} {
				if _, heavy := ClassifyCommand(cmd); heavy {
					t.Fatalf("%q must not be gated", cmd)
				}
			}
		})
	})

	t.Run("given the commands that actually cost", func(t *testing.T) {
		t.Run("each is heavy", func(t *testing.T) {
			for _, cmd := range []string{
				"pnpm test:unit run src/foo",
				"pnpm typecheck",
				"npx vitest run",
				"pnpm lint",
				"go build ./...",
				"docker build .",
			} {
				if _, heavy := ClassifyCommand(cmd); !heavy {
					t.Fatalf("%q should be gated", cmd)
				}
			}
		})
	})
}

// @scenario "An integration run is never narrowed"
func TestClassifyCommandSeparatesIntegrationFromUnit(t *testing.T) {
	t.Run("given an integration command", func(t *testing.T) {
		kind, heavy := ClassifyCommand("pnpm test:integration run src/x")

		t.Run("it is heavy but not narrowable", func(t *testing.T) {
			if !heavy {
				t.Fatal("an integration run competes for the same machine")
			}
			if kind != IntegrationRun || kind.Narrowable() {
				t.Fatalf("integration files are serial by construction; got %v", kind)
			}
		})
	})

	t.Run("given a unit command", func(t *testing.T) {
		kind, _ := ClassifyCommand("pnpm test:unit run src/x")

		t.Run("it is the one kind with workers to divide", func(t *testing.T) {
			if kind != UnitRun || !kind.Narrowable() {
				t.Fatalf("expected a narrowable unit run, got %v", kind)
			}
		})
	})

	t.Run("given a typecheck", func(t *testing.T) {
		kind, _ := ClassifyCommand("pnpm typecheck")

		t.Run("it is one process with nothing to divide", func(t *testing.T) {
			if kind != SingleProcessRun || kind.Narrowable() {
				t.Fatalf("expected a single-process run, got %v", kind)
			}
		})
	})
}

// @scenario "A caller's own worker count is respected but still admitted"
func TestCallerSetWorkersIsDetected(t *testing.T) {
	t.Run("given a command that already chose its width", func(t *testing.T) {
		t.Run("the gate notices, and will not override it", func(t *testing.T) {
			for _, cmd := range []string{
				"pnpm test:unit --maxWorkers=2",
				"pnpm test:unit --max-workers 2",
				"VITEST_MAX_WORKERS=2 pnpm test:unit",
			} {
				if !CallerSetWorkers(cmd) {
					t.Fatalf("expected %q to count as caller-chosen", cmd)
				}
			}
		})
	})

	t.Run("given a command that did not", func(t *testing.T) {
		t.Run("the gate is free to narrow it", func(t *testing.T) {
			if CallerSetWorkers("pnpm test:unit run src/x") {
				t.Fatal("expected no caller-chosen width")
			}
		})
	})
}

// @scenario "A heavy command is passed to haven as one escaped argument"
// @scenario "A command containing shell operators is gated as a whole"
// @scenario "The rewrap names haven by absolute path"
// @scenario "A command already under haven's heavy class is not rewrapped again"
func TestWrapCommandKeepsTheWholeShellLineInsideTheSlot(t *testing.T) {
	const havenPath = "/opt/homebrew/bin/haven"

	t.Run("given a command joined to another by a shell operator", func(t *testing.T) {
		wrapped := WrapCommand(havenPath, "pnpm test:unit && echo done", WrapOptions{})

		t.Run("the whole line is passed as one quoted argument", func(t *testing.T) {
			if !strings.Contains(wrapped, `--sh 'pnpm test:unit && echo done'`) {
				t.Fatalf("the operator must stay inside the quotes, got %q", wrapped)
			}
		})

		t.Run("so no part of it is parsed at the outer level", func(t *testing.T) {
			// The line has to end at the closing quote. Anything the wrapper let
			// past it would be parsed by the outer shell and run outside the slot.
			if !strings.HasSuffix(wrapped, "'") {
				t.Fatalf("part of the line escaped the slot: %q", wrapped)
			}
			if words := ShellWords(wrapped); words[len(words)-1] != "pnpm test:unit && echo done" {
				t.Fatalf("the operator must arrive as one argument, got %q", words)
			}
		})

		t.Run("and haven is named by absolute path, because PATH is optional", func(t *testing.T) {
			if !strings.HasPrefix(wrapped, ShellQuote(havenPath)) {
				t.Fatalf("expected an absolute path, got %q", wrapped)
			}
		})
	})

	t.Run("given a command carrying a single quote", func(t *testing.T) {
		wrapped := WrapCommand(havenPath, `echo 'it works'`, WrapOptions{})

		t.Run("the quote is escaped rather than closing the argument early", func(t *testing.T) {
			if strings.Count(wrapped, "--sh") != 1 {
				t.Fatalf("expected one wrapped argument, got %q", wrapped)
			}
			if !strings.Contains(wrapped, `'"'"'`) {
				t.Fatalf("expected the embedded quote escaped, got %q", wrapped)
			}
		})
	})

	t.Run("given a command already under haven's heavy class", func(t *testing.T) {
		wrapped := WrapCommand(havenPath, "pnpm test:unit", WrapOptions{})

		t.Run("it is recognised as wrapped, so it is not wrapped again", func(t *testing.T) {
			if !AlreadyWrapped(wrapped) {
				t.Fatal("a nested wrap makes the outer hold the slot the inner waits for")
			}
			if AlreadyWrapped("pnpm test:unit") {
				t.Fatal("an unwrapped command must not look wrapped")
			}
		})
	})
}

func TestShellWordsReadsBackWhatShellQuoteWrote(t *testing.T) {
	t.Run("given the values haven quotes into commands it writes", func(t *testing.T) {
		for _, value := range []string{
			"/opt/homebrew/bin/haven",
			"/src/my worktree/haven",
			`/src/it's mine/haven`,
			"pnpm test:unit && echo done",
			"",
		} {
			t.Run("when "+value+" is quoted and read back", func(t *testing.T) {
				words := ShellWords(ShellQuote(value))

				t.Run("it comes back as exactly one word, unchanged", func(t *testing.T) {
					if len(words) != 1 || words[0] != value {
						t.Fatalf("quoting is only safe if it survives the round trip: %q -> %q", value, words)
					}
				})
			})
		}
	})

	t.Run("given a command mixing quoted and bare words", func(t *testing.T) {
		words := ShellWords(`'/src/my worktree/haven' gate --sh "echo hi"`)

		t.Run("each word is one word, whatever quoted it", func(t *testing.T) {
			want := []string{"/src/my worktree/haven", "gate", "--sh", "echo hi"}
			if len(words) != len(want) {
				t.Fatalf("expected %d words, got %q", len(want), words)
			}
			for i, w := range want {
				if words[i] != w {
					t.Fatalf("word %d: expected %q, got %q", i, w, words[i])
				}
			}
		})
	})
}

// @scenario "The rewrap carries the decision it was given"
func TestWrapCommandCarriesTheDecision(t *testing.T) {
	t.Run("given a sub-agent's narrowed run", func(t *testing.T) {
		wrapped := WrapCommand("/opt/haven", "pnpm test:unit",
			WrapOptions{AgentID: "agent_123", Workers: 2})

		t.Run("the agent id travels with it, because it picks the wait ceiling", func(t *testing.T) {
			if !strings.Contains(wrapped, "--agent-id 'agent_123'") {
				t.Fatalf("without the id the run re-resolves as a main session: %q", wrapped)
			}
		})

		t.Run("and so does the width it was admitted at", func(t *testing.T) {
			if !strings.Contains(wrapped, "--workers 2") {
				t.Fatalf("a narrowing nobody applies is not a narrowing: %q", wrapped)
			}
		})

		t.Run("and it is still recognised as wrapped", func(t *testing.T) {
			if !AlreadyWrapped(wrapped) {
				t.Fatalf("the flags must not break the idempotence check: %q", wrapped)
			}
		})
	})

	t.Run("given a run that was neither narrowed nor named", func(t *testing.T) {
		wrapped := WrapCommand("/opt/haven", "pnpm test:unit", WrapOptions{})

		t.Run("neither flag is emitted at all", func(t *testing.T) {
			if strings.Contains(wrapped, "--workers") || strings.Contains(wrapped, "--agent-id") {
				t.Fatalf("an absent decision must not become a stated one: %q", wrapped)
			}
		})
	})

	t.Run("given haven installed under a path with a space", func(t *testing.T) {
		wrapped := WrapCommand("/Users/x/My Tools/haven", "pnpm test:unit", WrapOptions{})

		t.Run("the path survives as one argument", func(t *testing.T) {
			if !strings.HasPrefix(wrapped, `'/Users/x/My Tools/haven' `) {
				t.Fatalf("the path split into two words: %q", wrapped)
			}
		})
	})
}

// @scenario "Timings are filed under what the command actually is"
func TestDurationKeyFollowsTheClassifiedKind(t *testing.T) {
	t.Run("given an integration run spelled as a bare vitest invocation", func(t *testing.T) {
		command := "npx vitest run --config vitest.integration.config.ts"

		t.Run("it is filed as an integration run, not under vitest", func(t *testing.T) {
			// "vitest" precedes "test:integration" in the heavy list, so a key
			// taken from list order filed a ten-minute suite in the unit bucket.
			if got := DurationKey(command); got != "integration" {
				t.Fatalf("expected the integration bucket, got %q", got)
			}
		})

		t.Run("so a unit run cannot inherit its timing", func(t *testing.T) {
			if DurationKey("pnpm test:unit run src/x") == DurationKey(command) {
				t.Fatal("the two populations must not share a bucket")
			}
		})
	})

	t.Run("given single-process runs", func(t *testing.T) {
		t.Run("each keeps its own bucket, because they differ by orders of magnitude", func(t *testing.T) {
			if DurationKey("pnpm typecheck") == DurationKey("docker build .") {
				t.Fatal("a typecheck and a docker build are not one population")
			}
		})
	})

	t.Run("given a command that is not heavy at all", func(t *testing.T) {
		t.Run("there is nothing to time", func(t *testing.T) {
			if got := DurationKey("git status"); got != "" {
				t.Fatalf("expected no key, got %q", got)
			}
		})
	})
}

// @scenario "A refusal never invites the caller to sleep or poll"
// @scenario "A refusal explains the state in terms the caller can act on"
// @scenario "A refusal says where the caller is in the queue and when to come back"
func TestRefusalReasonTellsTheCallerNotToSleep(t *testing.T) {
	hint, ok := NewRetryHint(3, 20*time.Second, SubAgent)
	if !ok {
		t.Fatal("expected a quotable hint for the fixture")
	}
	reason := RefusalReason(Red, 4, &hint)

	t.Run("given a refusal bound for the model", func(t *testing.T) {
		t.Run("it names the pressure and the queue depth", func(t *testing.T) {
			if !strings.Contains(reason, "red") || !strings.Contains(reason, "4 heavy runs queued") {
				t.Fatalf("expected the state named, got %q", reason)
			}
		})

		t.Run("it says when to come back and where in the queue", func(t *testing.T) {
			if !strings.Contains(reason, "try again in about") || !strings.Contains(reason, "position 3") {
				t.Fatalf("expected the retry hint, got %q", reason)
			}
		})

		t.Run("it explicitly forbids sleeping, which is the failure mode it exists to prevent", func(t *testing.T) {
			if !strings.Contains(reason, "Do NOT sleep") {
				t.Fatalf("expected an explicit no-sleep instruction, got %q", reason)
			}
		})

		t.Run("and it names work that is safe to do instead", func(t *testing.T) {
			if !strings.Contains(reason, "reading, editing, writing, planning") {
				t.Fatalf("expected an alternative, got %q", reason)
			}
		})
	})

	t.Run("given a queue that cannot be quoted honestly", func(t *testing.T) {
		t.Run("no retry time is offered rather than a guess", func(t *testing.T) {
			bare := RefusalReason(Red, 0, nil)
			if strings.Contains(bare, "try again in about") {
				t.Fatalf("expected no invented estimate, got %q", bare)
			}
			if !strings.Contains(bare, "Do NOT sleep") {
				t.Fatal("the no-sleep instruction is not optional")
			}
		})
	})
}

// @scenario "A backgrounded run explains itself in the same breath"
func TestBackgroundDescriptionSaysItIsNotAResult(t *testing.T) {
	t.Run("given a command the gate backgrounded", func(t *testing.T) {
		got := BackgroundDescription(3)

		t.Run("it says haven queued it and that it is running in the background", func(t *testing.T) {
			if !strings.Contains(got, "queued") || !strings.Contains(got, "background") {
				t.Fatalf("expected both, got %q", got)
			}
		})

		t.Run("and that the result is not this return, so an immediate return is not read as success", func(t *testing.T) {
			if !strings.Contains(got, "not now") {
				t.Fatalf("expected the result to be disclaimed, got %q", got)
			}
		})
	})
}
