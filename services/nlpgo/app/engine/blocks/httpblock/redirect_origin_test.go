package httpblock

import (
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestSameOrigin(t *testing.T) {
	cases := []struct {
		name string
		a, b string
		want bool
	}{
		{"another path", "https://agent.test/a", "https://agent.test/b?x=1", true},
		{"host case", "https://agent.test/", "https://AGENT.test/", true},
		{"default https port", "https://agent.test/", "https://agent.test:443/", true},
		{"default http port", "http://agent.test/", "http://agent.test:80/", true},
		{"another host", "https://agent.test/", "https://other.test/", false},
		{"subdomain", "https://agent.test/", "https://sub.agent.test/", false},
		{"another scheme", "https://agent.test/", "http://agent.test/", false},
		{"another port", "https://agent.test/", "https://agent.test:8443/", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			a, _ := url.Parse(tc.a)
			b, _ := url.Parse(tc.b)
			assert.Equal(t, tc.want, sameOrigin(a, b))
		})
	}
}

func TestSameOriginOfRawURL(t *testing.T) {
	assert.True(t, SameOrigin("https://AGENT.test:443/chat?x=1", "https://agent.test"))
	assert.False(t, SameOrigin("https://agent.test.evil.test/chat", "https://agent.test"))
	assert.False(t, SameOrigin("https://{{host}}.agent.test/chat", "https://agent.test"))
	assert.False(t, SameOrigin("not a url", "https://agent.test"))
}
