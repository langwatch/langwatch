package providers

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/tidwall/gjson"
)

func TestWithoutProviderInternals(t *testing.T) {
	t.Run("when the envelope carries the provider's raw exchange", func(t *testing.T) {
		body := []byte(`{"id":"x","extra_fields":{"provider":"openai","latency":12,` +
			`"raw_request":{"a":1},"raw_response":{"b":2},` +
			`"provider_response_headers":{"Openai-Organization":"acme"}}}`)

		out := withoutProviderInternals(body)

		assert.NotContains(t, string(out), "raw_request")
		assert.NotContains(t, string(out), "raw_response")
		assert.NotContains(t, string(out), "Openai-Organization")
		assert.Equal(t, "openai", gjson.GetBytes(out, "extra_fields.provider").String())
		assert.Equal(t, int64(12), gjson.GetBytes(out, "extra_fields.latency").Int())
	})

	t.Run("when the envelope carries none of it", func(t *testing.T) {
		body := []byte(`{"id":"x","extra_fields":{"provider":"openai"}}`)

		assert.Equal(t, string(body), string(withoutProviderInternals(body)))
	})
}
