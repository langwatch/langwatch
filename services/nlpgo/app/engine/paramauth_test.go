package engine

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// TestParamAuth guards the two on-the-wire shapes the HTTP block must accept:
// the structured `auth` object, AND the discrete `auth_type`/`auth_token`/...
// params that the Studio UI + experiments builder actually emit. The latter
// was previously dropped, so HTTP-block auth silently sent no credential on
// the real UI path.
func TestParamAuth(t *testing.T) {
	str := func(s string) json.RawMessage { b, _ := json.Marshal(s); return b }

	t.Run("structured auth object (direct engine shape)", func(t *testing.T) {
		params := []dsl.Field{
			{Identifier: "auth", Type: dsl.FieldType("json"), Value: json.RawMessage(`{"type":"bearer","token":"{{ secrets.TOK }}"}`)},
		}
		got := paramAuth(params)
		assert.NotNil(t, got)
		assert.Equal(t, "bearer", got.Type)
		assert.Equal(t, "{{ secrets.TOK }}", got.Token)
	})

	t.Run("discrete auth_type + auth_token (Studio UI shape)", func(t *testing.T) {
		params := []dsl.Field{
			{Identifier: "auth_type", Type: dsl.FieldTypeStr, Value: str("bearer")},
			{Identifier: "auth_token", Type: dsl.FieldTypeStr, Value: str("{{ secrets.TOK }}")},
		}
		got := paramAuth(params)
		assert.NotNil(t, got, "auth_type/auth_token must be honored, not dropped")
		assert.Equal(t, "bearer", got.Type)
		assert.Equal(t, "{{ secrets.TOK }}", got.Token)
	})

	t.Run("discrete api_key (header + value)", func(t *testing.T) {
		params := []dsl.Field{
			{Identifier: "auth_type", Type: dsl.FieldTypeStr, Value: str("api_key")},
			{Identifier: "auth_header", Type: dsl.FieldTypeStr, Value: str("X-API-Key")},
			{Identifier: "auth_value", Type: dsl.FieldTypeStr, Value: str("{{ secrets.API_KEY }}")},
		}
		got := paramAuth(params)
		assert.NotNil(t, got)
		assert.Equal(t, "api_key", got.Type)
		assert.Equal(t, "X-API-Key", got.Header)
		assert.Equal(t, "{{ secrets.API_KEY }}", got.Value)
	})

	t.Run("auth_type none yields no auth", func(t *testing.T) {
		params := []dsl.Field{{Identifier: "auth_type", Type: dsl.FieldTypeStr, Value: str("none")}}
		assert.Nil(t, paramAuth(params))
	})

	t.Run("no auth params yields no auth", func(t *testing.T) {
		params := []dsl.Field{{Identifier: "url", Type: dsl.FieldTypeStr, Value: str("https://x")}}
		assert.Nil(t, paramAuth(params))
	})
}
