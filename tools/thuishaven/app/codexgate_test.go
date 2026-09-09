package app

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "Codex heavy commands use the existing Haven gate"
func TestCodexGateRewritesOnlyTheCommand(t *testing.T) {
	store := &fakeStore{heavyRuns: 1}
	sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}
	o := gateOrch(store, sys)
	input := `{"session_id":"thread-1","turn_id":"turn-1","model":"codex","permission_mode":"dontAsk","tool_name":"Bash","tool_input":{"command":"pnpm typecheck worker"}}`
	var output bytes.Buffer
	o.GateCodex(strings.NewReader(input), &output)
	var reply hookReply
	if err := json.Unmarshal(output.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	command, _ := reply.Specific.UpdatedInput["command"].(string)
	if reply.Specific.PermissionDecision != "allow" || len(reply.Specific.UpdatedInput) != 1 || !strings.Contains(command, "run --class heavy") || !strings.Contains(command, "pnpm typecheck worker") {
		t.Fatalf("unexpected Codex rewrite: %s", output.String())
	}
	if strings.Contains(command, "GOMEMLIMIT") || strings.Contains(command, "--workers") {
		t.Fatalf("typecheck rewrite introduced resource caps: %s", command)
	}
}

func TestCodexGateUsesNeutralSuccessForDeferredCalls(t *testing.T) {
	for _, input := range []string{
		`{"permission_mode":"dontAsk","tool_name":"Bash","tool_input":{"command":"rg --files"}}`,
		`{"permission_mode":"default","tool_name":"Bash","tool_input":{"command":"pnpm typecheck worker"}}`,
		`{"permission_mode":"plan","tool_name":"Bash","tool_input":{"command":"pnpm typecheck worker"}}`,
		`{"tool_name":"Bash","tool_input":{"command":"pnpm typecheck worker"}}`,
		`{invalid`,
	} {
		t.Run(input, func(t *testing.T) {
			store := &fakeStore{heavyRuns: 1}
			sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}
			var output bytes.Buffer
			gateOrch(store, sys).GateCodex(strings.NewReader(input), &output)
			if !json.Valid(output.Bytes()) || strings.Contains(output.String(), "permissionDecision") || strings.Contains(output.String(), "updatedInput") {
				t.Fatalf("neutral Codex call must remain undecided: %s", output.String())
			}
		})
	}
}

// @scenario "Codex heavy commands use the existing Haven gate"
func TestCodexGateCountsHeavyRunsOnAnIdleMachine(t *testing.T) {
	var output bytes.Buffer
	o := gateOrch(&fakeStore{}, &fakeSystem{now: time.Now()})
	o.GateCodex(strings.NewReader(`{"permission_mode":"dontAsk","tool_name":"Bash","tool_input":{"command":"pnpm typecheck worker"}}`), &output)
	var reply hookReply
	if err := json.Unmarshal(output.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	command, _ := reply.Specific.UpdatedInput["command"].(string)
	if reply.Specific.PermissionDecision != "allow" || !strings.Contains(command, "run --class heavy") {
		t.Fatalf("idle heavy run would be uncounted: %s", output.String())
	}
}
