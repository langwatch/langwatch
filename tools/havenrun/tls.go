package havenrun

import (
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"strings"
)

const routeSuffix = ".langwatch.localhost"

// LocalTLSConfig skips certificate verification for the haven route (*.langwatch.localhost)
// only; every other host is verified as usual.
func LocalTLSConfig() *tls.Config {
	return &tls.Config{
		InsecureSkipVerify: true, // #nosec G402 -- VerifyConnection verifies every host but the local route.
		VerifyConnection: func(state tls.ConnectionState) error {
			if strings.HasSuffix(state.ServerName, routeSuffix) {
				return nil
			}
			pool := x509.NewCertPool()
			for _, cert := range state.PeerCertificates[1:] {
				pool.AddCert(cert)
			}
			_, err := state.PeerCertificates[0].Verify(x509.VerifyOptions{
				DNSName: state.ServerName, Intermediates: pool})
			return err
		},
	}
}

// TrustLocalRoute makes the default HTTP transport accept the haven route's certificate.
func TrustLocalRoute() {
	if transport, ok := http.DefaultTransport.(*http.Transport); ok {
		transport.TLSClientConfig = LocalTLSConfig()
	}
}
