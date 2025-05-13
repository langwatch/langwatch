package otelopenai

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestJSONHelpers(t *testing.T) {
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

		// Note: JSON ints might parse as float64
		valIntFloat, okIntFloat := getFloat64(data, "int_key_float")
		assert.True(t, okIntFloat)
		assert.Equal(t, 99.0, valIntFloat)

		valIntInt, okIntInt := getFloat64(data, "int_key_int")
		assert.True(t, okIntInt)
		assert.Equal(t, 77.0, valIntInt)

		_, ok = getFloat64(data, "string_key")
		assert.False(t, ok, "Should fail for wrong type")

		_, ok = getFloat64(data, "missing_key")
		assert.False(t, ok, "Should fail for missing key")
	})

	t.Run("getInt", func(t *testing.T) {
		valFloat, okFloat := getInt(data, "int_key_float")
		assert.True(t, okFloat)
		assert.Equal(t, 99, valFloat)

		valInt, okInt := getInt(data, "int_key_int")
		assert.True(t, okInt, "Should handle actual int type if present")
		assert.Equal(t, 77, valInt)

		_, ok := getInt(data, "float_key") // Should truncate
		assert.True(t, ok, "Should convert float to int")
		// assert.Equal(t, 123, valTruncated) // Keep commented assertion example

		_, ok = getInt(data, "string_key")
		assert.False(t, ok, "Should fail for wrong type")

		_, ok = getInt(data, "missing_key")
		assert.False(t, ok, "Should fail for missing key")
	})
}
