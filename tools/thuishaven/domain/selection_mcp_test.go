package domain

import (
	"strings"
	"testing"
)

// @scenario "haven runs mcpsim only when the worktree asks for it"
func TestMcpIsOptInAndNamedInTheSelection(t *testing.T) {
	if DefaultSelection().Mcp {
		t.Error("mcpsim must be off by default")
	}
	sel, err := applySelectionDelta(Selection{}, "mcp", true)
	if err != nil || !sel.Mcp {
		t.Fatalf("+mcp did not select it: %v %v", sel, err)
	}
	if !strings.Contains(DefaultSelection().Describe(), "mcp (haven up +mcp)") {
		t.Errorf("Describe does not offer +mcp: %s", DefaultSelection().Describe())
	}
	if got := SelectionFromStack(Stack{Services: []Service{{Name: McpService, Port: 45599}}}); !got.Mcp {
		t.Error("a stack running mcpsim does not read back as +mcp")
	}
}
