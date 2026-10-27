package httpapi

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestForwardedPassthroughHeaders_DropsCredentialsAndCookies(t *testing.T) {
	h := http.Header{}
	for _, k := range []string{"Authorization", "X-Api-Key", "X-Goog-Api-Key", "Xi-Api-Key", "Cookie", "X-LangWatch-Instance"} {
		h.Set(k, "secret")
	}
	h.Set("X-Custom", "kept")

	assert.Equal(t, map[string]string{"X-Custom": "kept"}, forwardedPassthroughHeaders(h))
}

func TestForwardedPassthroughQuery_DropsKeyParameter(t *testing.T) {
	assert.Equal(t, "alt=sse", forwardedPassthroughQuery("key=vk-secret&alt=sse"))
	assert.Equal(t, "alt=sse", forwardedPassthroughQuery("alt=sse"))
	assert.Empty(t, forwardedPassthroughQuery("key=vk-secret"))
}

/** @scenario "the passthrough lane never forwards a key query parameter" */
func TestForwardedPassthroughQuery_DropsKeyFromAnyQueryShape(t *testing.T) {
	cases := map[string]string{
		"alt=sse;x=1&key=VK":         "alt=sse;x=1",
		"key=VK&x=%zz":               "x=%zz",
		"x=1;key=VK&alt=sse":         "x=1&alt=sse",
		"KEY=VK&k%65y=VK&alt=sse":    "alt=sse",
		"alt=sse&key=VK&key=VK2":     "alt=sse",
		"%zz=VK&alt=sse":             "alt=sse",
		"b=2&a=%2F+x&alt=sse":        "b=2&a=%2F+x&alt=sse",
		"alt=sse&key=VK&b=2&a=%2F+x": "alt=sse&b=2&a=%2F+x",
		"":                           "",
	}
	for raw, want := range cases {
		assert.Equal(t, want, forwardedPassthroughQuery(raw), raw)
	}
}
