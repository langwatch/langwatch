package netprobe

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseHosts(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  []Host
	}{
		{
			name:  "single host",
			input: "api.openai.com:443",
			want:  []Host{{Name: "api", Addr: "api.openai.com:443"}},
		},
		{
			name:  "multiple hosts",
			input: "api.openai.com:443, redis.local:6379",
			want: []Host{
				{Name: "api", Addr: "api.openai.com:443"},
				{Name: "redis", Addr: "redis.local:6379"},
			},
		},
		{
			name:  "host without dot uses full name",
			input: "localhost:8080",
			want:  []Host{{Name: "localhost", Addr: "localhost:8080"}},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			hosts, err := ParseHosts(tc.input)
			require.NoError(t, err)
			assert.Equal(t, tc.want, hosts)
		})
	}
}

func TestParseHosts_Empty(t *testing.T) {
	hosts, err := ParseHosts("")
	require.NoError(t, err)
	assert.Nil(t, hosts)
}

func TestParseHosts_Invalid(t *testing.T) {
	_, err := ParseHosts("not-a-host-port")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "invalid host:port")
}
