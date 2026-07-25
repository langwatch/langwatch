package pipeline

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestStrip_RemovesCacheControl(t *testing.T) {
	input := `{"system":[{"type":"text","text":"hello","cache_control":{"type":"ephemeral"}}],"messages":[{"role":"user","content":[{"type":"text","text":"hi","cache_control":{"type":"ephemeral"}}]}]}`

	got := stripCacheControl([]byte(input))

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
	got := stripCacheControl([]byte(input))
	assert.JSONEq(t, input, string(got))
}

func TestInjectEphemeral(t *testing.T) {
	input := `{"system":[{"type":"text","text":"sys1"},{"type":"text","text":"sys2"}],"messages":[{"role":"user","content":[{"type":"text","text":"msg1"},{"type":"text","text":"msg2"}]}]}`

	got := injectEphemeral([]byte(input))

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
	got := applyCacheControl([]byte(input), domain.CacheActionDisable, domain.RequestTypeMessages)

	var parsed map[string]any
	require.NoError(t, json.Unmarshal(got, &parsed))

	sys := parsed["system"].([]any)
	sysBlock := sys[0].(map[string]any)
	_, hasCacheControl := sysBlock["cache_control"]
	assert.False(t, hasCacheControl, "disable should strip cache_control")
}

func TestApply_Force_Messages(t *testing.T) {
	input := `{"system":[{"type":"text","text":"sys"}],"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}`
	got := applyCacheControl([]byte(input), domain.CacheActionForce, domain.RequestTypeMessages)

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
	input := `{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"hi"}]}`
	got := applyCacheControl([]byte(input), domain.CacheActionForce, domain.RequestTypeChat)

	var parsed map[string]any
	require.NoError(t, json.Unmarshal(got, &parsed))
	cc, ok := parsed["cache_control"].(map[string]any)
	require.True(t, ok, "force+chat should inject top-level cache_control")
	assert.Equal(t, "ephemeral", cc["type"])
}

func TestDefaultCacheAction(t *testing.T) {
	t.Run("anthropic defaults to force", func(t *testing.T) {
		action, ok := defaultCacheAction(&domain.ResolvedModel{ProviderID: domain.ProviderAnthropic})
		require.True(t, ok)
		assert.Equal(t, domain.CacheActionForce, action)
	})

	t.Run("openai has no default (provider caches automatically)", func(t *testing.T) {
		_, ok := defaultCacheAction(&domain.ResolvedModel{ProviderID: domain.ProviderOpenAI})
		assert.False(t, ok)
	})

	t.Run("nil resolved model has no default", func(t *testing.T) {
		_, ok := defaultCacheAction(nil)
		assert.False(t, ok)
	})
}

func largeChatBody(t *testing.T) []byte {
	t.Helper()
	// A body comfortably above defaultCacheMinBodyBytes, shaped like the
	// OpenAI-dialect chat requests the generic lane sends.
	system := make([]byte, defaultCacheMinBodyBytes)
	for i := range system {
		system[i] = 'a'
	}
	return []byte(`{"model":"claude-haiku-4-5","messages":[{"role":"system","content":"` + string(system) + `"},{"role":"user","content":"hi"}]}`)
}

// @scenario "A client's own cache markers are never overridden by the default"
// @scenario "Markers the translated lane cannot forward do not block caching"
func TestApplyDefaultCacheControl(t *testing.T) {
	t.Run("injects top-level ephemeral on a large chat body", func(t *testing.T) {
		got, applied := applyDefaultCacheControl(largeChatBody(t), domain.CacheActionForce, domain.RequestTypeChat)
		require.True(t, applied)

		var parsed map[string]any
		require.NoError(t, json.Unmarshal(got, &parsed))
		cc, ok := parsed["cache_control"].(map[string]any)
		require.True(t, ok, "default should inject top-level cache_control")
		assert.Equal(t, "ephemeral", cc["type"])
	})

	t.Run("leaves a chat body with a top-level cache_control untouched", func(t *testing.T) {
		system := make([]byte, defaultCacheMinBodyBytes)
		for i := range system {
			system[i] = 'a'
		}
		input := []byte(`{"model":"claude-haiku-4-5","cache_control":{"type":"ephemeral"},"messages":[{"role":"system","content":"` + string(system) + `"}]}`)
		got, applied := applyDefaultCacheControl(input, domain.CacheActionForce, domain.RequestTypeChat)
		assert.False(t, applied, "a client-placed top-level marker wins over the default")
		assert.Equal(t, input, got)
	})

	t.Run("message-level markers do not disable the chat default", func(t *testing.T) {
		// OpenAI-dialect SDKs (opencode) stamp cache_control on individual
		// messages, but the Anthropic translation drops that spelling — so
		// the default must still add the top-level marker or nothing is
		// ever cached on this lane.
		system := make([]byte, defaultCacheMinBodyBytes)
		for i := range system {
			system[i] = 'a'
		}
		input := []byte(`{"model":"claude-haiku-4-5","messages":[{"role":"system","content":"` + string(system) + `","cache_control":{"type":"ephemeral"}},{"role":"user","content":"hi","cache_control":{"type":"ephemeral"}}]}`)
		got, applied := applyDefaultCacheControl(input, domain.CacheActionForce, domain.RequestTypeChat)
		require.True(t, applied)

		var parsed map[string]any
		require.NoError(t, json.Unmarshal(got, &parsed))
		cc, ok := parsed["cache_control"].(map[string]any)
		require.True(t, ok, "top-level marker should be added despite message-level ones")
		assert.Equal(t, "ephemeral", cc["type"])
	})

	t.Run("any marker disables the default on the native messages dialect", func(t *testing.T) {
		system := make([]byte, defaultCacheMinBodyBytes)
		for i := range system {
			system[i] = 'a'
		}
		input := []byte(`{"system":[{"type":"text","text":"` + string(system) + `","cache_control":{"type":"ephemeral"}}],"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}`)
		got, applied := applyDefaultCacheControl(input, domain.CacheActionForce, domain.RequestTypeMessages)
		assert.False(t, applied, "native-dialect clients manage their own breakpoints")
		assert.Equal(t, input, got)
	})

	t.Run("skips bodies below the minimum cacheable size", func(t *testing.T) {
		input := []byte(`{"model":"claude-haiku-4-5","messages":[{"role":"user","content":"hi"}]}`)
		got, applied := applyDefaultCacheControl(input, domain.CacheActionForce, domain.RequestTypeChat)
		assert.False(t, applied)
		assert.Equal(t, input, got)
	})

	t.Run("injects per-block breakpoints on the native messages dialect", func(t *testing.T) {
		system := make([]byte, defaultCacheMinBodyBytes)
		for i := range system {
			system[i] = 'a'
		}
		input := []byte(`{"system":[{"type":"text","text":"` + string(system) + `"}],"messages":[{"role":"user","content":[{"type":"text","text":"hi"}]}]}`)
		got, applied := applyDefaultCacheControl(input, domain.CacheActionForce, domain.RequestTypeMessages)
		require.True(t, applied)

		var parsed map[string]any
		require.NoError(t, json.Unmarshal(got, &parsed))
		sys := parsed["system"].([]any)
		lastSys := sys[len(sys)-1].(map[string]any)
		cc, ok := lastSys["cache_control"].(map[string]any)
		require.True(t, ok, "default on messages dialect should inject block breakpoints")
		assert.Equal(t, "ephemeral", cc["type"])
	})

	t.Run("does nothing for non-force actions", func(t *testing.T) {
		got, applied := applyDefaultCacheControl(largeChatBody(t), domain.CacheActionRespect, domain.RequestTypeChat)
		assert.False(t, applied)
		assert.NotNil(t, got)
	})
}

func TestApply_Respect(t *testing.T) {
	input := `{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`
	got := applyCacheControl([]byte(input), domain.CacheActionRespect, domain.RequestTypeMessages)
	assert.Equal(t, []byte(input), got, "respect should return body unchanged")
}
