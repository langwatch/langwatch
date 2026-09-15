package app

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// GateCodex no longer rewrites the command through `haven run` - see
// specs/setup/haven-agent-hooks.feature, "Codex heavy commands use the
// existing Haven gate", and app/gate_test.go's
// TestCodexGateNeverRewritesTheCommandEither for that behavior in full.
// What remains worth its own test here is the neutral, undecided answer a
// Codex-shaped payload gets when the gate has nothing to say - a command
// that is not heavy, or one a permission mode or malformed payload defers
// on its own terms.
func TestCodexGateUsesNeutralSuccessForDeferredCalls(t *testing.T) {
	for _, input := range []string{
		`{"permission_mode":"dontAsk","tool_name":"Bash","tool_input":{"command":"rg --files"}}`,
		`{invalid`,
	} {
		t.Run(input, func(t *testing.T) {
			store := &fakeStore{}
			sys := &fakeSystem{memStat: domain.MemStat{TotalBytes: 4 << 30}, now: time.Now()}
			var output bytes.Buffer
			gateOrch(store, sys).GateCodex(strings.NewReader(input), &output)
			if !json.Valid(output.Bytes()) || strings.Contains(output.String(), "permissionDecision") || strings.Contains(output.String(), "updatedInput") {
				t.Fatalf("neutral Codex call must remain undecided: %s", output.String())
			}
		})
	}
}
