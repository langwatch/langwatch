package customertracebridge

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestParseTraceparent_valid(t *testing.T) {
	tp := "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
	traceID, spanID := parseTraceparent(tp)
	assert.Len(t, traceID, 16)
	assert.Len(t, spanID, 8)
	assert.Equal(t, "4bf92f3577b34da6a3ce929d0e0e4736", hexEncode(traceID))
	assert.Equal(t, "00f067aa0ba902b7", hexEncode(spanID))
}

func TestParseTraceparent_empty(t *testing.T) {
	traceID, spanID := parseTraceparent("")
	assert.Nil(t, traceID)
	assert.Nil(t, spanID)
}

func TestParseTraceparent_malformed(t *testing.T) {
	tests := []string{
		"not-a-traceparent",
		"00-short-00f067aa0ba902b7-01",
		"00-4bf92f3577b34da6a3ce929d0e0e4736-short-01",
	}
	for _, tp := range tests {
		traceID, spanID := parseTraceparent(tp)
		assert.Nil(t, traceID, "traceparent: %s", tp)
		assert.Nil(t, spanID, "traceparent: %s", tp)
	}
}

func TestRegistry_Set_ValidatesScheme(t *testing.T) {
	tests := []struct {
		name     string
		endpoint string
		wantErr  bool
	}{
		{name: "https allowed", endpoint: "https://otel.internal:4318", wantErr: false},
		{name: "http allowed", endpoint: "http://localhost:4318", wantErr: false},
		{name: "empty clears entry", endpoint: "", wantErr: false},
		{name: "ftp rejected", endpoint: "ftp://evil.com/exfil", wantErr: true},
		{name: "file rejected", endpoint: "file:///etc/passwd", wantErr: true},
		{name: "javascript rejected", endpoint: "javascript:alert(1)", wantErr: true},
		{name: "no scheme rejected", endpoint: "evil.com:4318", wantErr: true},
		{name: "data uri rejected", endpoint: "data:text/plain,hello", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := NewRegistry()
			err := r.Set("proj-1", tt.endpoint, nil)
			if tt.wantErr {
				assert.ErrorIs(t, err, ErrInvalidEndpoint)
			} else {
				assert.NoError(t, err)
			}
		})
	}
}

func TestRegistry_Lookup(t *testing.T) {
	r := NewRegistry()
	_ = r.Set("proj-1", "https://otel.internal:4318/v1/traces", map[string]string{"X-Auth-Token": "tok"})

	endpoint, headers, ok := r.Lookup("proj-1")
	assert.True(t, ok)
	assert.Equal(t, "https://otel.internal:4318/v1/traces", endpoint)
	assert.Equal(t, "tok", headers["X-Auth-Token"])
}

func TestRegistry_Set_ClearsWithEmpty(t *testing.T) {
	r := NewRegistry()
	_ = r.Set("proj-1", "https://otel.internal:4318", nil)
	_ = r.Set("proj-1", "", nil)

	_, _, ok := r.Lookup("proj-1")
	assert.False(t, ok)
}

func hexEncode(b []byte) string {
	const hexChars = "0123456789abcdef"
	out := make([]byte, len(b)*2)
	for i, v := range b {
		out[i*2] = hexChars[v>>4]
		out[i*2+1] = hexChars[v&0x0f]
	}
	return string(out)
}
