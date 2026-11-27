package codeblock_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// No setting turns an exposure into a mode that runs code blocks.
func TestHideModeFor(t *testing.T) {
	assert.Equal(t, "strict", codeblock.HideModeFor(""))
	assert.Equal(t, "disabled", codeblock.HideModeFor("the engine's own process files are readable by user code"))
}
