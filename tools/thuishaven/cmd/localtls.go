package cmd

import (
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"os"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/portlessproxy"
)

// localHTTPClient is the client for haven's own calls to this machine's stack
// (sign-in, `haven api`), which go to the portless HTTPS hostnames. It trusts the
// system roots plus the portless Local CA. portless puts that CA in the system
// store only once (macOS keychain, or /usr/local/share/ca-certificates on Linux),
// so a box whose store lost it (a rebuilt Linux box keeps ~/.portless and its
// ca.trusted marker, not /usr/local/share) failed every sign-in with "x509:
// certificate signed by unknown authority". Only this process trusts it, and its
// callers refuse any host that is not *.localhost (localApp).
func localHTTPClient(timeout time.Duration) *http.Client {
	client := &http.Client{Timeout: timeout}
	if pool := localRoots(portlessproxy.LocalCAPath()); pool != nil {
		t := http.DefaultTransport.(*http.Transport).Clone()
		t.TLSClientConfig = &tls.Config{RootCAs: pool}
		client.Transport = t
	}
	return client
}

// localRoots is the system pool plus the PEM at ca, or nil (the default roots)
// when there is no CA or it does not load.
func localRoots(ca string) *x509.CertPool {
	if ca == "" {
		return nil
	}
	pem, err := os.ReadFile(ca)
	if err != nil {
		return nil
	}
	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	if !pool.AppendCertsFromPEM(pem) {
		return nil
	}
	return pool
}
