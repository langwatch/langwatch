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
		wrapped := WrapCommand(havenPath, "pnpm test:unit && echo done")

		t.Run("the whole line is passed as one quoted argument", func(t *testing.T) {
			if !strings.Contains(wrapped, `--sh 'pnpm test:unit && echo done'`) {
				t.Fatalf("the operator must stay inside the quotes, got %q", wrapped)
			}
		})

		t.Run("so no part of it is parsed at the outer level", func(t *testing.T) {
			// Anything after the closing quote would run outside the slot.
			if strings.HasSuffix(wrapped, "&& echo done") {
				t.Fatalf("part of the line escaped the slot: %q", wrapped)
			}
		})

		t.Run("and haven is named by absolute path, because PATH is optional", func(t *testing.T) {
			if !strings.HasPrefix(wrapped, havenPath) {
				t.Fatalf("expected an absolute path, got %q", wrapped)
			}
		})
	})

	t.Run("given a command carrying a single quote", func(t *testing.T) {
		wrapped := WrapCommand(havenPath, `echo 'it works'`)

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
		wrapped := WrapCommand(havenPath, "pnpm test:unit")

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
