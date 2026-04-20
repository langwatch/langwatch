package infra

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestProjectRegistry_Set_ValidatesScheme(t *testing.T) {
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
			r := NewProjectRegistry()
			err := r.Set("proj-1", tt.endpoint, nil)
			if tt.wantErr {
				require.ErrorIs(t, err, ErrInvalidEndpoint)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestProjectRegistry_Set_StoresValidEndpoint(t *testing.T) {
	r := NewProjectRegistry()
	err := r.Set("proj-1", "https://otel.internal:4318/v1/traces", map[string]string{"X-Auth-Token": "tok"})
	require.NoError(t, err)

	endpoint, headers, ok := r.Lookup("proj-1")
	assert.True(t, ok)
	assert.Equal(t, "https://otel.internal:4318/v1/traces", endpoint)
	assert.Equal(t, "tok", headers["X-Auth-Token"])
}

func TestProjectRegistry_Set_RejectsInvalidEndpoint(t *testing.T) {
	r := NewProjectRegistry()
	err := r.Set("proj-1", "ftp://evil.com", nil)
	require.Error(t, err)

	// Entry should NOT be stored
	_, _, ok := r.Lookup("proj-1")
	assert.False(t, ok)
}

func TestProjectRegistry_Set_ClearsWithEmpty(t *testing.T) {
	r := NewProjectRegistry()
	_ = r.Set("proj-1", "https://otel.internal:4318", nil)
	_ = r.Set("proj-1", "", nil)

	_, _, ok := r.Lookup("proj-1")
	assert.False(t, ok)
}
