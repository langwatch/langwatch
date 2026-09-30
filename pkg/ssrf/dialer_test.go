package ssrf_test

import (
	"net"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ssrf"
)

func TestSafeDialerRefusesCloudMetadataWhateverTheConfig(t *testing.T) {
	toMetadata := func(string) ([]net.IP, error) { return []net.IP{net.ParseIP("169.254.169.254")}, nil }
	for name, opts := range map[string]ssrf.Options{
		"allow-listed host":     {AllowedHosts: []string{"rebind.test"}, Resolver: toMetadata},
		"local calls permitted": {AllowLocal: true, Resolver: toMetadata},
	} {
		t.Run(name, func(t *testing.T) {
			_, err := ssrf.SafeDialer(opts)(t.Context(), "tcp", "rebind.test:80")
			require.ErrorIs(t, err, ssrf.ErrBlocked)
		})
	}
}
