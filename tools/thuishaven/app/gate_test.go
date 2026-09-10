package app

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// gateOrch builds an orchestrator whose only job is answering a hook.
func gateOrch(store *fakeStore, sys *fakeSystem) *Orchestrator {
	return &Orchestrator{store: store, sys: sys, log: zap.NewNop()}
}

// ask runs one hook payload through the gate and decodes the reply.
func ask(t *testing.T, o *Orchestrator, payload map[string]any) hookReply {
	t.Helper()
	in, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	o.Gate(bytes.NewReader(in), &out)

	var reply hookReply
	if err := json.Unmarshal(out.Bytes(), &reply); err != nil {
		t.Fatalf("the gate wrote something undecodable: %q", out.String())
	}
	return reply
}

// bashPayload is a sub-agent asking to run a unit suite in a session that
// already approves its own tool calls - the mode that used to be the only one
// the gate rewrote a command in, back when it rewrote at all.
func bashPayload(command string) map[string]any {
	return map[string]any{
		"tool_name":       "Bash",
		"agent_id":        "agent_7",
		"permission_mode": "bypassPermissions",
		"tool_input":      map[string]any{"command": command},
	}
}

// askCodex runs one hook payload through Codex's own gate and decodes the
// reply - GateCodex projects Codex's own wire shape, but shares every
// admission decision with Gate and, like Gate, never rewrites the command.
func askCodex(t *testing.T, o *Orchestrator, payload map[string]any) hookReply {
	t.Helper()
	in, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	o.GateCodex(bytes.NewReader(in), &out)

	var reply hookReply
	if err := json.Unmarshal(out.Bytes(), &reply); err != nil {
		t.Fatalf("the gate wrote something undecodable: %q", out.String())
	}
	return reply
}

// @scenario "The gate never changes the command it admits"
func TestClaudeGateNeverRewritesTheCommand(t *testing.T) {
	// A rewrite used to mask the real command from Claude Code's own
	// permission rules (a prefix rule matching "haven run" over-admits an
	// allow and a deny never gets to fire on the command it was written for)
	// and from every log line and prompt. The fix is architectural: Gate must
	// never produce updatedInput, for a command it admits unchanged, narrows,
	// queues or refuses alike.
	t.Run("given a heavy command with no free slot", func(t *testing.T) {
		store := &fakeStore{heavyRuns: 1, observed: map[string]time.Duration{"unit": 20 * time.Second}}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}
		reply := ask(t, gateOrch(store, sys), bashPayload("pnpm test:unit run src/x"))

		t.Run("the command is not rewritten", func(t *testing.T) {
			if reply.Specific.UpdatedInput != nil {
				t.Fatalf("expected no updatedInput at all, got %+v", reply.Specific)
			}
		})

		t.Run("and no allow is handed out on its strength", func(t *testing.T) {
			if reply.Specific.PermissionDecision == "allow" {
				t.Fatalf("an allow with nothing rewritten approves whatever the model already asked for: %+v", reply.Specific)
			}
		})

		t.Run("but the caller still hears something, since the machine is full", func(t *testing.T) {
			if reply.SystemMessage == "" {
				t.Fatal("a decision that changes nothing about the run must still be described")
			}
		})
	})

	t.Run("given red memory pressure with no slot free", func(t *testing.T) {
		now := time.Now()
		store := &fakeStore{
			heavyRuns: 999, // far past any derived limit: no slot free, whatever the machine
			pressure: domain.PressureRecord{
				Version: domain.PressureRecordVersion, Level: "red", WrittenAt: now,
			},
			hasWrittenPressure: true,
		}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: now}
		reply := ask(t, gateOrch(store, sys), bashPayload("pnpm test:unit run src/x"))

		t.Run("this is the one case that still denies", func(t *testing.T) {
			if reply.Specific.PermissionDecision != "deny" {
				t.Fatalf("expected an explicit deny under red pressure, got %+v", reply.Specific)
			}
		})

		t.Run("and it still carries no updatedInput", func(t *testing.T) {
			if reply.Specific.UpdatedInput != nil {
				t.Fatalf("a refusal is not a rewrite: %+v", reply.Specific)
			}
		})
	})

	t.Run("given a command that is not heavy", func(t *testing.T) {
		store := &fakeStore{}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}
		reply := ask(t, gateOrch(store, sys), bashPayload("git status"))

		t.Run("it is waved through untouched", func(t *testing.T) {
			if reply.Specific.PermissionDecision != "" || reply.Specific.UpdatedInput != nil {
				t.Fatalf("gating `git status` is its own outage; got %+v", reply.Specific)
			}
		})
	})
}

// @scenario "Codex heavy commands use the existing Haven gate"
// @scenario "The gate never changes the command it admits"
func TestCodexGateNeverRewritesTheCommandEither(t *testing.T) {
	t.Run("given a sub-agent whose short unit run finds no free slot", func(t *testing.T) {
		// One slot, one run already in it: the machine is full, and a run
		// observed to finish well inside five minutes is narrowed rather than
		// queued.
		store := &fakeStore{heavyRuns: 1, observed: map[string]time.Duration{"unit": 20 * time.Second}}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}

		t.Run("when Codex's gate answers", func(t *testing.T) {
			reply := askCodex(t, gateOrch(store, sys), bashPayload("pnpm test:unit run src/x"))

			t.Run("the command is not rewritten", func(t *testing.T) {
				if reply.Specific.UpdatedInput != nil {
					t.Fatalf("expected no updatedInput at all, got %+v", reply.Specific)
				}
			})

			t.Run("and no allow is handed out on its strength", func(t *testing.T) {
				if reply.Specific.PermissionDecision == "allow" {
					t.Fatalf("an allow with nothing rewritten approves whatever Codex already asked for: %+v", reply.Specific)
				}
			})

			t.Run("but Codex still sees a system message describing what haven expects", func(t *testing.T) {
				if reply.SystemMessage == "" {
					t.Fatal("a decision that changes nothing about the run must still be described")
				}
			})
		})
	})

	t.Run("given a session that already permits its own shell commands", func(t *testing.T) {
		store := &fakeStore{heavyRuns: 1, observed: map[string]time.Duration{"unit": 20 * time.Second}}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}
		payload := bashPayload("pnpm test:unit run src/x")
		payload["permission_mode"] = "bypassPermissions"

		t.Run("permission_mode changes nothing: still no rewrite, only a message", func(t *testing.T) {
			reply := askCodex(t, gateOrch(store, sys), payload)
			if reply.Specific.UpdatedInput != nil {
				t.Fatalf("expected no updatedInput regardless of permission mode, got %+v", reply.Specific)
			}
		})
	})

	t.Run("given a command that is not heavy", func(t *testing.T) {
		store := &fakeStore{}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}

		t.Run("it is waved through untouched, and keeps Codex's normal permission flow", func(t *testing.T) {
			reply := askCodex(t, gateOrch(store, sys), bashPayload("git status"))
			if reply.Specific.PermissionDecision != "" || reply.Specific.UpdatedInput != nil {
				t.Fatalf("gating `git status` is its own outage; got %+v", reply.Specific)
			}
		})
	})
}

// @scenario "An ungated command gets no decision at all"
func TestUngatedCommandGetsNoDecisionAtAll(t *testing.T) {
	store := &fakeStore{}
	sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}

	t.Run("given a command the gate does not class as heavy", func(t *testing.T) {
		t.Run("when a background sub-agent with nobody to ask runs it", func(t *testing.T) {
			// No permission_mode at all: the case with the least to fall back on,
			// since there is no auto-approving mode and no human to prompt either.
			payload := bashPayload("ls")
			delete(payload, "permission_mode")

			var out bytes.Buffer
			gateOrch(store, sys).Gate(bytes.NewReader(mustJSON(t, payload)), &out)

			t.Run("the wire answer carries no permissionDecision key at all", func(t *testing.T) {
				// Not merely an empty string: "defer" was never a value Claude Code's
				// protocol recognizes, so the field must be ABSENT, which is what lets
				// the agent's normal flow proceed with nobody to ask.
				if strings.Contains(out.String(), "permissionDecision") {
					t.Fatalf("an ungated command must carry no permission decision at all: %s", out.String())
				}
			})

			t.Run("and the decoded reply is a bare, unopinionated answer", func(t *testing.T) {
				var reply hookReply
				if err := json.Unmarshal(out.Bytes(), &reply); err != nil {
					t.Fatalf("the gate wrote something undecodable: %q", out.String())
				}
				if !isBareDefer(reply) {
					t.Fatalf("expected a bare, neutral answer, got %+v", reply)
				}
			})
		})
	})
}

// mustJSON marshals a payload for a test that needs the raw bytes rather than
// the map, so a key can be genuinely absent instead of present with a zero value.
func mustJSON(t *testing.T, payload map[string]any) []byte {
	t.Helper()
	b, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// hugeTranscript writes a transcript whose SIZE is above the warning threshold
// without writing its contents.
//
// Sparse on purpose, and it exercises the real path rather than dodging it: the
// gate stats the transcript instead of reading it, precisely because the fast
// path cannot afford to read a file that reaches hundreds of MB. Sizing it from
// the threshold rather than from a literal keeps the fixture honest if the
// threshold moves.
func hugeTranscript(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "transcript.jsonl")
	f, err := os.Create(path) // #nosec G304 -- t.TempDir()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = f.Close() }()
	if err := f.Truncate(int64(domain.WarnThresholdTokens)*4 + 1024); err != nil {
		t.Fatal(err)
	}
	return path
}

// editPayload is a main session editing an instructions file mid-session, on a
// transcript large enough to be worth pricing.
func editPayload(t *testing.T, tool string) map[string]any {
	t.Helper()
	return map[string]any{
		"tool_name":       tool,
		"transcript_path": hugeTranscript(t),
		"permission_mode": "default",
		"tool_input":      map[string]any{"file_path": "/repo/CLAUDE.md"},
	}
}

// isBareDefer reports that the gate said nothing at all — no decision, no
// warning, no rewrite.
func isBareDefer(reply hookReply) bool {
	return reply.Specific.PermissionDecision == "" &&
		reply.SystemMessage == "" &&
		reply.Specific.UpdatedInput == nil
}

// gatedToolPayload builds a payload that SHOULD produce an answer for one tool.
// The default case is the point of the function: a tool added to GatedTools
// without a branch to serve it fails here, naming itself.
func gatedToolPayload(t *testing.T, tool string) map[string]any {
	t.Helper()
	switch tool {
	case "Bash":
		return bashPayload("pnpm test:unit run src/x")
	case "Edit", "Write":
		return editPayload(t, tool)
	default:
		t.Fatalf("%q is routed to the gate but nothing here answers for it; "+
			"either give it a branch or take it out of domain.GatedTools", tool)
		return nil
	}
}

// The gate is woken for the tools domain.GatedTools names, so a tool listed there
// that reaches no branch is a process launch per call to reach an unconditional
// defer — and a branch whose tool is NOT listed is dead code that cannot fire at
// all. The second is what happened: the matcher named Bash and Agent while the
// cache-cost warning ran only for Edit and Write.
//
// @scenario "A branch of the gate is never left waiting for a tool nobody sends it"
// @scenario "Every tool that wakes the gate reaches something that answers"
func TestEveryGatedToolReachesALiveBranch(t *testing.T) {
	for _, tool := range domain.GatedTools {
		t.Run("given the gate is woken for "+tool, func(t *testing.T) {
			// Full slots and a timed short run, so the Bash case has something to
			// decide rather than waving the command through.
			store := &fakeStore{heavyRuns: 1, observed: map[string]time.Duration{"unit": 20 * time.Second}}
			sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}

			t.Run("when it answers, it has something to say", func(t *testing.T) {
				reply := ask(t, gateOrch(store, sys), gatedToolPayload(t, tool))
				if isBareDefer(reply) {
					t.Fatalf("%q wakes the gate and reaches nothing: %+v", tool, reply)
				}
			})
		})
	}
}

// @scenario "An edit to an instructions file is flagged with its uncertainty attached"
func TestGateWarnsOnAnInstructionsEdit(t *testing.T) {
	store := &fakeStore{}
	sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}

	t.Run("given a large session editing an instructions file", func(t *testing.T) {
		reply := ask(t, gateOrch(store, sys), editPayload(t, "Edit"))

		t.Run("the developer is told the price", func(t *testing.T) {
			if !strings.Contains(reply.SystemMessage, "$") {
				t.Fatalf("a warning with no price is a warning nobody can weigh: %q", reply.SystemMessage)
			}
		})

		t.Run("and told the invalidation is not certain, because it is not", func(t *testing.T) {
			if !strings.Contains(reply.SystemMessage, "MAY") {
				t.Fatalf("where the harness places instructions is unverified, so the copy "+
					"must hedge: %q", reply.SystemMessage)
			}
		})

		t.Run("and the edit still goes through, in a session that still prompts", func(t *testing.T) {
			// Pricing an action must never block it, and must never need an
			// approval to ride on: a deliberate cache-busting edit is the normal
			// case, not the exception.
			if reply.Specific.PermissionDecision != "" {
				t.Fatalf("the price is information, not a veto: %+v", reply.Specific)
			}
		})
	})

	t.Run("given the same edit in a session too small to be worth pricing", func(t *testing.T) {
		payload := editPayload(t, "Edit")
		payload["transcript_path"] = filepath.Join(t.TempDir(), "absent.jsonl")

		t.Run("nothing is said at all", func(t *testing.T) {
			reply := ask(t, gateOrch(store, sys), payload)
			if reply.SystemMessage != "" {
				t.Fatalf("warning on a cheap action trains the reader to dismiss the "+
					"expensive one: %q", reply.SystemMessage)
			}
		})
	})
}

// @scenario "A malformed payload defers"
func TestGateAlwaysAnswers(t *testing.T) {
	t.Run("given input the gate cannot read at all", func(t *testing.T) {
		store := &fakeStore{}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}

		t.Run("it still writes a reply, and that reply defers", func(t *testing.T) {
			var out bytes.Buffer
			gateOrch(store, sys).Gate(strings.NewReader("{ not json"), &out)

			var reply hookReply
			if err := json.Unmarshal(out.Bytes(), &reply); err != nil {
				t.Fatalf("a hook that writes nothing usable is a blocked tool call: %q", out.String())
			}
			if reply.Specific.PermissionDecision != "" {
				t.Fatalf("expected no permission decision, got %q", reply.Specific.PermissionDecision)
			}
		})
	})
}
