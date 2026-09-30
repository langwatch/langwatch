package controlplane

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Each refusal of a license token means a different action for the install's
// operator, so each has to arrive under its own code. Folded into the generic
// mapping, a wrong instance would read as a revoked key and a missing instance
// id as a retryable upstream failure.
func TestResolveKey_LicenseTokenRefusalsKeepTheirCode(t *testing.T) {
	cases := []struct {
		code   string
		status int
		want   error
	}{
		{"connect_instance_required", http.StatusBadRequest, domain.ErrConnectInstanceRequired},
		{"connect_license_not_registered", http.StatusUnauthorized, domain.ErrConnectLicenseNotRegistered},
		{"connect_license_revoked", http.StatusForbidden, domain.ErrConnectLicenseRevoked},
		{"connect_license_expired", http.StatusForbidden, domain.ErrConnectLicenseExpired},
		{"connect_wrong_instance", http.StatusForbidden, domain.ErrConnectWrongInstance},
		// Malformed is refused by the gateway before it asks. If the control
		// plane ever answers it, it reads as any other bad credential.
		{"connect_license_token_malformed", http.StatusUnauthorized, domain.ErrInvalidAPIKey},
	}

	for _, tc := range cases {
		t.Run(tc.code, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(`{"error":{"type":"` + tc.code + `","code":"` + tc.code + `","message":"?"}}`))
			}))
			defer srv.Close()
			cp := NewClient(ClientOptions{
				BaseURL:    srv.URL,
				Sign:       func(_ *http.Request, _ []byte) {},
				HTTPClient: srv.Client(),
			})

			_, err := cp.ResolveKey(context.Background(), domain.PresentedKey{
				Token:      domain.LicenseTokenPrefix + strings.Repeat("a", 64),
				InstanceID: "instance-a",
			})

			require.Error(t, err)
			assert.ErrorIs(t, err, tc.want)
		})
	}
}

func TestResolveKey_SendsTheInstanceOnlyWithALicenseToken(t *testing.T) {
	var bodies []map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]string
		_ = json.Unmarshal(raw, &body)
		bodies = append(bodies, body)
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()
	cp := NewClient(ClientOptions{
		BaseURL:    srv.URL,
		Sign:       func(_ *http.Request, _ []byte) {},
		HTTPClient: srv.Client(),
	})
	license := domain.LicenseTokenPrefix + strings.Repeat("a", 64)

	_, _ = cp.ResolveKey(context.Background(), domain.PresentedKey{Token: license, InstanceID: "instance-a"})
	_, _ = cp.ResolveKey(context.Background(), domain.PresentedKey{Token: "vk-lw-whatever"})

	require.Len(t, bodies, 2)
	assert.Equal(t, map[string]string{"key_presented": license, "instance_id": "instance-a"}, bodies[0])
	assert.Equal(t, map[string]string{"key_presented": "vk-lw-whatever"}, bodies[1],
		"a virtual key is sent exactly as before")
}
