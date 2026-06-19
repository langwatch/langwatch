package openai

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestJSONUtils(t *testing.T) {
	jsonDataStr := `{
		"string_key": "hello",
		"float_key": 123.45,
		"int_key_float": 99.0,
		"int_key_int": 77,
		"bool_key": true,
		"null_key": null
	}`
	var data jsonData
	err := json.Unmarshal([]byte(jsonDataStr), &data)
	assert.NoError(t, err)

	t.Run("getString", func(t *testing.T) {
		val, ok := getString(data, "string_key")
		assert.True(t, ok)
		assert.Equal(t, "hello", val)

		_, ok = getString(data, "float_key")
		assert.False(t, ok, "Should fail for wrong type")

		_, ok = getString(data, "missing_key")
		assert.False(t, ok, "Should fail for missing key")
	})

	t.Run("getFloat64", func(t *testing.T) {
		val, ok := getFloat64(data, "float_key")
		assert.True(t, ok)
		assert.Equal(t, 123.45, val)

		valIntFloat, okIntFloat := getFloat64(data, "int_key_float")
		assert.True(t, okIntFloat)
		assert.Equal(t, 99.0, valIntFloat)

		_, ok = getFloat64(data, "string_key")
		assert.False(t, ok, "Should fail for wrong type")
	})

	t.Run("getInt", func(t *testing.T) {
		valFloat, okFloat := getInt(data, "int_key_float")
		assert.True(t, okFloat)
		assert.Equal(t, 99, valFloat)

		val, _ := getInt(data, "float_key")
		assert.Equal(t, 123, val, "Should truncate float to int")

		_, ok := getInt(data, "string_key")
		assert.False(t, ok, "Should fail for wrong type")
	})

	t.Run("hasKey", func(t *testing.T) {
		assert.True(t, hasKey(data, "string_key"))
		assert.False(t, hasKey(data, "null_key"), "null values are treated as absent")
		assert.False(t, hasKey(data, "missing_key"))
	})

	t.Run("getStreamingFlag", func(t *testing.T) {
		assert.False(t, getStreamingFlag(data))
		streaming, _ := parseBody([]byte(`{"stream":true}`))
		assert.True(t, getStreamingFlag(streaming))
	})
}

func TestParseBodyAndPeekObject(t *testing.T) {
	t.Run("parseBody on object", func(t *testing.T) {
		body, ok := parseBody([]byte(`{"a":1}`))
		assert.True(t, ok)
		assert.Contains(t, body, "a")
	})

	t.Run("parseBody on non-object", func(t *testing.T) {
		_, ok := parseBody([]byte(`["not","an","object"]`))
		assert.False(t, ok)
	})

	t.Run("peekObjectField", func(t *testing.T) {
		assert.Equal(t, "chat.completion", peekObjectField([]byte(`{"object":"chat.completion","x":1}`)))
		assert.Equal(t, "", peekObjectField([]byte(`{"no_object":true}`)))
		assert.Equal(t, "", peekObjectField([]byte(`not json`)))
	})
}
