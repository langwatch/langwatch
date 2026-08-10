package app

import (
	"bytes"
	"encoding/json"
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
