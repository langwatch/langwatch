package a2aproxy

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/pkg/ssrf"
)

// Upstream timeouts. A stream may run as long as the agent works, so there
// is no total timeout: only connecting and the wait for response headers
// are bounded.
const (
	upstreamDialTimeout   = 10 * time.Second
	upstreamTLSTimeout    = 10 * time.Second
	upstreamHeaderTimeout = 10 * time.Minute
)

var (
	errRedirectRefused = errors.New("the A2A agent answered with a redirect, which the gateway does not follow")
	errAddressBlocked  = errors.New("the A2A agent address is not allowed")
)

// NewUpstreamClient is the client the proxy calls targets with. Every dial
// is checked after DNS resolution against pkg/ssrf: cloud metadata,
// unspecified and link-local addresses are always refused, other non-public
// addresses when blockLocal is set. Redirects are refused, so the target's
// upstream headers never follow one to another host.
func NewUpstreamClient(blockLocal bool) *http.Client {
	dialer := &net.Dialer{
		Timeout:   upstreamDialTimeout,
		KeepAlive: 30 * time.Second,
		Control: func(_, address string, _ syscall.RawConn) error {
			return checkDialAddress(address, blockLocal)
		},
	}
	transport := &http.Transport{
		DialContext:           dialer.DialContext,
		TLSHandshakeTimeout:   upstreamTLSTimeout,
		ResponseHeaderTimeout: upstreamHeaderTimeout,
		IdleConnTimeout:       90 * time.Second,
		MaxIdleConnsPerHost:   16,
		ForceAttemptHTTP2:     true,
	}
	// A proxy dials in our place, so the address check would only see the
	// proxy. Where local egress is blocked, no environment proxy is used.
	if !blockLocal {
		transport.Proxy = http.ProxyFromEnvironment
	}
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errRedirectRefused
		},
	}
}

// checkDialAddress refuses a resolved ip:port the proxy may not reach.
func checkDialAddress(address string, blockLocal bool) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return fmt.Errorf("%w: %s", errAddressBlocked, address)
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return fmt.Errorf("%w: %s", errAddressBlocked, address)
	}
	addr = addr.Unmap()
	switch ssrf.Classify(addr) {
	case ssrf.CategoryGlobal:
		return nil
	case ssrf.CategoryMetadata:
		return errAddressBlocked
	case ssrf.CategorySpecial:
		if blockLocal || addr.IsUnspecified() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() {
			return errAddressBlocked
		}
	}
	return nil
}
