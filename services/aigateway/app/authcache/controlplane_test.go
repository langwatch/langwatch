package authcache

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFetchConfig_EscapesVKID(t *testing.T) {
	tests := []struct {
		name    string
		vkID    string
		wantURI string
	}{
		{
			name:    "normal id",
			vkID:    "vk-abc123",
			wantURI: "/api/internal/gateway/config/vk-abc123",
		},
		{
			name:    "path traversal attempt",
			vkID:    "../../admin/secrets",
			wantURI: "/api/internal/gateway/config/..%2F..%2Fadmin%2Fsecrets",
		},
		{
			name:    "query injection attempt",
			vkID:    "test?admin=1",
			wantURI: "/api/internal/gateway/config/test%3Fadmin=1",
		},
		{
			name:    "fragment injection",
			vkID:    "test#fragment",
			wantURI: "/api/internal/gateway/config/test%23fragment",
		},
		{
			name:    "slashes in id",
			vkID:    "a/b/c",
			wantURI: "/api/internal/gateway/config/a%2Fb%2Fc",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var capturedURI string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				capturedURI = r.RequestURI
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{}`))
			}))
			defer srv.Close()

			signer, err := NewSigner("test-secret", "node-1")
			require.NoError(t, err)
			verifier := NewJWTVerifier("jwt-secret", "")
			cp := NewControlPlaneClient(srv.URL, signer, verifier, srv.Client())

			_, _ = cp.FetchConfig(context.Background(), tt.vkID)

			assert.Equal(t, tt.wantURI, capturedURI)
		})
	}
}
