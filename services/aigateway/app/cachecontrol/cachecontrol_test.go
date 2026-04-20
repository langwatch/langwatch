package cachecontrol

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestStrip_RemovesCacheControl(t *testing.T) {
	input := `{"system":[{"type":"text","text":"hello","cache_control":{"type":"ephemeral"}}],"messages":[{"role":"user","content":[{"type":"text","text":"hi","cache_control":{"type":"ephemeral"}}]}]}`

	got := Strip([]byte(input))

	var parsed map[string]any
	require.NoError(t, json.Unmarshal(got, &parsed))

	// system[0] should not have cache_control
	sys := parsed["system"].([]any)
	sysBlock := sys[0].(map[string]any)
	_, hasCacheControl := sysBlock["cache_control"]
	assert.False(t, hasCacheControl, "cache_control should be stripped from system block")

	// messages[0].content[0] should not have cache_control
	msgs := parsed["messages"].([]any)
	msg := msgs[0].(map[string]any)
	content := msg["content"].([]any)
	contentBlock := content[0].(map[string]any)
	_, hasCacheControl = contentBlock["cache_control"]
	assert.False(t, hasCacheControl, "cache_control should be stripped from content block")
}

func TestStrip_NoCacheControl(t *testing.T) {
	input := `{"model":"gpt-4","messages":[{"role":"user","content":"hello"}]}`
	got := Strip([]byte(input))
	assert.JSONEq(t, input, string(got))
}

func TestInjectEphemeral(t *testing.T) {
	input := `{"system":[{"type":"text","text":"sys1"},{"type":"text","text":"sys2"}],"messages":[{"role":"user","content":[{"type":"text","text":"msg1"},{"type":"text","text":"msg2"}]}]}`

	got := InjectEphemeral([]byte(input))

	var parsed map[string]any
	require.NoError(t, json.Unmarshal(got, &parsed))

	// Last system block should have cache_control
	sys := parsed["system"].([]any)
	lastSys := sys[len(sys)-1].(map[string]any)
	cc, ok := lastSys["cache_control"].(map[string]any)
	require.True(t, ok, "last system block should have cache_control")
	assert.Equal(t, "ephemeral", cc["type"])

	// First system block should NOT have cache_control
	firstSys := sys[0].(map[string]any)
	_, hasCC := firstSys["cache_control"]
	assert.False(t, hasCC, "first system block should not have cache_control")

	// Last message's last content block should have cache_control
	msgs := parsed["messages"].([]any)
	lastMsg := msgs[len(msgs)-1].(map[string]any)
	content := lastMsg["content"].([]any)
	lastContent := content[len(content)-1].(map[string]any)
	cc, ok = lastContent["cache_control"].(map[string]any)
	require.True(t, ok, "last content block should have cache_control")
	assert.Equal(t, "ephemeral", cc["type"])
}

func TestApply_Disable(t *testing.T) {
	input := `{"system":[{"type":"text","text":"hello","cache_control":{"type":"ephemeral"}}]}`
	got := Apply([]byte(input), domain.CacheActionDisable, domain.RequestTypeMessages)

	var parsed map[string]any
	require.NoError(t, json.Unmarshal(got, &parsed))

	sys := parsed["system"].([]any)
	sysBlock := sys[0].(map[string]any)
	_, hasCacheControl := sysBlock["cache_control"]
	assert.False(t, hasCacheControl, "disable should strip cache_control")
}

func TestApply_Force_Messages(t *testing.T) {
	input := `{"system":[{"type":"text","text":"sys"}],"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}`
	got := Apply([]byte(input), domain.CacheActionForce, domain.RequestTypeMessages)

	var parsed map[string]any
	require.NoError(t, json.Unmarshal(got, &parsed))

	// Last system block should have cache_control injected
	sys := parsed["system"].([]any)
	lastSys := sys[len(sys)-1].(map[string]any)
	cc, ok := lastSys["cache_control"].(map[string]any)
	require.True(t, ok, "force+messages should inject cache_control")
	assert.Equal(t, "ephemeral", cc["type"])
}

func TestApply_Force_Chat(t *testing.T) {
	input := `{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`
	got := Apply([]byte(input), domain.CacheActionForce, domain.RequestTypeChat)
	assert.JSONEq(t, input, string(got), "force+chat should return body unchanged")
}

func TestApply_Respect(t *testing.T) {
	input := `{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`
	got := Apply([]byte(input), domain.CacheActionRespect, domain.RequestTypeMessages)
	assert.Equal(t, []byte(input), got, "respect should return body unchanged")
}
