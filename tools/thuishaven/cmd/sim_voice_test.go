package cmd

import (
	"strings"
	"testing"
)

// @scenario "An agent clears the call log between runs"
func TestVoiceClearDeletesTheCallLog(t *testing.T) {
	api, seen := stubSim(t, map[string]string{"DELETE /_sim/api/calls": ``})
	if err := voiceCommand(api, simInv("clear"), true); err != nil {
		t.Fatal(err)
	}
	if len(*seen) != 1 || !strings.HasPrefix((*seen)[0], "DELETE /_sim/api/calls") {
		t.Fatalf("requests = %v, want one DELETE /_sim/api/calls", *seen)
	}
}
