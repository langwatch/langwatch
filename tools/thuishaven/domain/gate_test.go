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

	// TypeScript 7 renamed the compiler binary to `tsc`, so the route around
	// the package scripts is spelled differently now and costs exactly as
	// much as it did.
	t.Run("given the compiler invoked directly under either name", func(t *testing.T) {
		t.Run("each is heavy", func(t *testing.T) {
			for _, cmd := range []string{
				"./node_modules/.bin/tsc --noEmit --project ./tsconfig.tsgo.json",
				"pnpm exec tsc --noEmit -p tsconfig.json",
				"pnpm exec tsgo --noEmit -p tsconfig.tsgo.json",
				"cd apps/api && tsc -p tsconfig.test.json",
			} {
				if _, heavy := ClassifyCommand(cmd); !heavy {
					t.Fatalf("%q should be gated", cmd)
				}
			}
		})

		// "tsc" is three letters and a substring of "tsconfig.json", so it is
		// matched as the binary a word invokes rather than as text anywhere in
		// the line. Reading a project file as a compiler run is the over-match
		// that has a developer wondering why `cat` was queued.
		t.Run("but naming the config file is not running the compiler", func(t *testing.T) {
			for _, cmd := range []string{
				"cat apps/api/tsconfig.json",
				"grep -n strict apps/api/tsconfig.json",
				"git diff tsconfig.json",
				"/x/bin/mytsc --noEmit",
				"node dev/scripts/check-queue.mjs ./node_modules/.bin/tsc.real --noEmit -p tsconfig.json",
			} {
				if _, heavy := ClassifyCommand(cmd); heavy {
					t.Fatalf("%q must not be gated", cmd)
				}
			}
		})
	})
}

// @scenario "A command that only mentions a heavy tool is not gated"
func TestClassifyCommandGatesOnInvocationNotSubstring(t *testing.T) {
	t.Run("given a command that only reads, searches or prints text naming a heavy tool", func(t *testing.T) {
		// The 2026-09-10 incident: a status read piped through head and awk, and
		// a grep for the classifier's own source, were both queued behind the
		// machine-wide slot for tens of minutes because they mentioned "vitest",
		// "tsc" and "golangci" as plain text, never as a program they ran.
		for _, cmd := range []string{
			`HAVEN_AGENT=1 haven machine slot explain 2>&1 | head -20; echo ---; ps -eo rss,comm | awk '$2 ~ /node|tsgo|tsc|golangci|vitest/ {n[$2]++} END {for (k in n) print k, n[k]}'`,
			`grep -rn 'func.*[Cc]lassif\|"vitest"\|"tsc"\|"golangci' --include='*.go' domain app | grep -v _test`,
			"grep -rn vitest.config .",
			"cat vitest.config.ts",
			"echo typecheck",
		} {
			t.Run(cmd, func(t *testing.T) {
				if _, heavy := ClassifyCommand(cmd); heavy {
					t.Fatalf("mentioning a heavy tool must not gate: %q", cmd)
				}
			})
		}
	})

	t.Run("given a command that genuinely invokes a heavy tool, however it is wrapped", func(t *testing.T) {
		for _, cmd := range []string{
			"pnpm typecheck:one apps/api",
			"cd tools && pnpm --filter @langwatch/ui test:unit src/x.test.ts",
			"HAVEN_AGENT=1 pnpm exec vitest run src/x.test.ts",
			"./node_modules/.bin/tsc --noEmit -p tsconfig.json",
			"golangci-lint run ./tools/...",
			"make typecheck",
		} {
			t.Run(cmd, func(t *testing.T) {
				if _, heavy := ClassifyCommand(cmd); !heavy {
					t.Fatalf("an actual invocation must still gate: %q", cmd)
				}
			})
		}
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
// One compiler is one population: a `tsc` run has to file its duration where
// its `tsgo` predecessor filed, or the estimate that decides whether a run is
// narrowed has no prior observation and treats it as long.
func TestDurationKeyBucketsBothCompilerNamesTogether(t *testing.T) {
	t.Run("given the compiler invoked under each of its names", func(t *testing.T) {
		tsc := DurationKey("./node_modules/.bin/tsc --noEmit -p tsconfig.json")
		tsgo := DurationKey("./node_modules/.bin/tsgo --noEmit -p tsconfig.json")

		t.Run("both land in one bucket", func(t *testing.T) {
			if tsc != TypeScriptCompilerClass || tsgo != TypeScriptCompilerClass {
				t.Fatalf("tsc = %q, tsgo = %q, want both %q", tsc, tsgo, TypeScriptCompilerClass)
			}
		})
	})
}

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

// @scenario "The gate leaves compile and test runs to their launchers"
// @scenario "The gate leaves oxlint runs to their launcher"
// @scenario "Lint and builds keep the gate until they have launchers"
func TestLauncherOwnedCoversOnlyLauncherRuns(t *testing.T) {
	owned := []string{
		"tsc --noEmit --ignoreConfig f.ts",
		"pnpm exec tsc -b",
		"npx vitest run src/x",
		"vitest run",
		"pnpm typecheck",
		"pnpm --filter @langwatch/time typecheck",
		"pnpm --filter @langwatch/time test src/x.unit.test.ts",
		"VITEST_MAX_WORKERS=2 pnpm --filter @langwatch/time test",
		"pnpm test:unit run src/x",
		"cd modules/x && pnpm typecheck",
		"oxlint --quiet src",
		"pnpm exec oxlint --quiet --type-aware --config .oxlintrc.jsonc f.ts",
		"./node_modules/.bin/oxlint -c .oxlintrc.native.jsonc .",
		"pnpm lint:fix",
		"pnpm exec tsc -b && pnpm exec oxlint src",
	}
	for _, command := range owned {
		if !LauncherOwned(command) {
			t.Errorf("LauncherOwned(%q) = false, want true: the launcher takes its slot", command)
		}
	}
	gated := []string{
		"pnpm lint",
		"pnpm --filter @langwatch/architecture-enforcer lint",
		"pnpm exec oxlint src && pnpm exec oxfmt --check src",
		"pnpm exec oxfmt --write f.ts",
		"eslint .",
		"next build",
		"golangci-lint run",
		"go build ./...",
		"docker build .",
		"pnpm typecheck && pnpm lint",
		"git status",
		"pnpm typecheck:src",
		"pnpm test:affected",
		"nx run-many -t typecheck -p @langwatch/time",
	}
	for _, command := range gated {
		if LauncherOwned(command) {
			t.Errorf("LauncherOwned(%q) = true, want false", command)
		}
	}
	for _, command := range []string{"pnpm typecheck:src", "pnpm test:affected", "nx run-many -t test -p @langwatch/time"} {
		if _, heavy := ClassifyCommand(command); heavy {
			t.Errorf("ClassifyCommand(%q) is heavy; an Nx entry point is not the gate's to hold", command)
		}
	}
}

// @scenario "Haven steps aside for programs rush's gate owns"
// @scenario "Haven keeps its gate for programs rush's gate does not own"
func TestRushOwnedNeedsEveryHeavySegmentOwned(t *testing.T) {
	owns := func(program string) bool { return program == "tsc" || program == "vitest" || program == "oxlint" }
	for _, command := range []string{
		"tsc --noEmit --ignoreConfig f.ts", "pnpm typecheck", "pnpm --filter x test", "npx vitest run",
		"pnpm exec oxlint src", "pnpm lint:fix", "pnpm exec tsc -b && vitest run",
	} {
		if !RushOwned(command, owns) {
			t.Errorf("RushOwned(%q) = false, want true", command)
		}
	}
	for _, command := range []string{
		"pnpm lint", "oxfmt --write f.ts", "tsc -b && oxfmt --check f.ts", "eslint .", "go build ./...", "ls -la",
	} {
		if RushOwned(command, owns) {
			t.Errorf("RushOwned(%q) = true, want false", command)
		}
	}
	if RushOwned("tsc -b", func(string) bool { return false }) {
		t.Error("RushOwned with rush's gate off = true, want false")
	}
}
