package codeblock_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// The runner skips its hide step on this flag, so nothing but the engine's own
// mode may put it in the interpreter's environment.
func TestRunEnv_OnlyTheEnginesModeSetsTheHideFlag(t *testing.T) {
	const flag = "NLPGO_CODE_BLOCK_HIDE=best-effort"
	smuggled := []string{"A=1", flag, "NLPGO_CODE_BLOCK_HIDE=x"}

	assert.Equal(t, []string{"A=1"}, codeblock.RunEnv(smuggled, false))
	assert.Equal(t, []string{"A=1", flag}, codeblock.RunEnv(smuggled, true))
}
