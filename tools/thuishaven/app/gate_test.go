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
// already approves its own tool calls, which is the only mode the gate rewrites
// in.
func bashPayload(command string) map[string]any {
	return map[string]any{
		"tool_name":       "Bash",
		"agent_id":        "agent_7",
		"permission_mode": "bypassPermissions",
		"tool_input":      map[string]any{"command": command},
	}
}

// @scenario "The rewrap carries the decision it was given"
func TestGateRewriteCarriesWhatItDecided(t *testing.T) {
	t.Run("given a sub-agent whose short unit run finds no free slot", func(t *testing.T) {
		// One slot, one run already in it: the machine is full, and a run
		// observed to finish well inside five minutes is narrowed rather than
		// queued.
		store := &fakeStore{heavyRuns: 1, observed: map[string]time.Duration{"unit": 20 * time.Second}}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}

		t.Run("when the gate answers", func(t *testing.T) {
			reply := ask(t, gateOrch(store, sys), bashPayload("pnpm test:unit run src/x"))
			command, _ := reply.Specific.UpdatedInput["command"].(string)

			t.Run("the command is rewritten to run under haven's slot", func(t *testing.T) {
				if reply.Specific.PermissionDecision != "allow" || command == "" {
					t.Fatalf("expected a rewrite, got %+v", reply.Specific)
				}
			})

			t.Run("and it carries the agent id, which picks the wait ceiling", func(t *testing.T) {
				// Without it `haven run` resolves an empty id as a main session and
				// holds a sub-agent on the thirty-minute failsafe, six times its
				// own five-minute cache floor.
				if !strings.Contains(command, "--agent-id 'agent_7'") {
					t.Fatalf("the caller was dropped on the way through: %q", command)
				}
			})

			t.Run("and it carries a width, so the narrowing is something that happens", func(t *testing.T) {
				if !strings.Contains(command, "--workers ") {
					t.Fatalf("a narrowing nobody applies is not a narrowing: %q", command)
				}
			})
		})
	})

	t.Run("given a session that still prompts for permission", func(t *testing.T) {
		store := &fakeStore{heavyRuns: 1, observed: map[string]time.Duration{"unit": 20 * time.Second}}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}
		payload := bashPayload("pnpm test:unit run src/x")
		payload["permission_mode"] = "default"

		t.Run("nothing is rewritten, because rewriting needs an approval to ride on", func(t *testing.T) {
			reply := ask(t, gateOrch(store, sys), payload)
			if reply.Specific.PermissionDecision != "defer" || reply.Specific.UpdatedInput != nil {
				t.Fatalf("expected an untouched defer, got %+v", reply.Specific)
			}
		})
	})

	t.Run("given a command that is not heavy", func(t *testing.T) {
		store := &fakeStore{}
		sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}

		t.Run("it is waved through untouched", func(t *testing.T) {
			reply := ask(t, gateOrch(store, sys), bashPayload("git status"))
			if reply.Specific.PermissionDecision != "defer" || reply.Specific.UpdatedInput != nil {
				t.Fatalf("gating `git status` is its own outage; got %+v", reply.Specific)
			}
		})
	})
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
	return reply.Specific.PermissionDecision == "defer" &&
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
			if reply.Specific.PermissionDecision != "defer" {
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
			if reply.Specific.PermissionDecision != "defer" {
				t.Fatalf("expected defer, got %q", reply.Specific.PermissionDecision)
			}
		})
	})
}
