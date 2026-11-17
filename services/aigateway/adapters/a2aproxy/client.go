package a2aproxy

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
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

// UpstreamPolicy is the egress rule for A2A targets, the same settings the
// gateway applies to every other customer endpoint.
type UpstreamPolicy struct {
	// BlockLocal refuses non-public addresses (BLOCK_LOCAL_HTTP_CALLS).
	BlockLocal bool
	// AllowedHosts may resolve to non-public addresses (ALLOWED_PROXY_HOSTS).
	AllowedHosts []string
}

// NewUpstreamClient is the client the proxy calls targets with. Every dial
// is checked after DNS resolution against pkg/ssrf. No environment proxy is
// used, so the address check always sees the real target. Redirects are
// refused, so the target's upstream headers never follow one to another host.
func NewUpstreamClient(policy UpstreamPolicy) *http.Client {
	allowed := make(map[string]bool, len(policy.AllowedHosts))
	for _, h := range policy.AllowedHosts {
		if h = normalizeHost(h); h != "" {
			allowed[h] = true
		}
	}
	dialerFor := func(blockLocal bool) *net.Dialer {
		return &net.Dialer{
			Timeout:   upstreamDialTimeout,
			KeepAlive: 30 * time.Second,
			Control: func(_, address string, _ syscall.RawConn) error {
				return checkDialAddress(address, blockLocal)
			},
		}
	}
	strict, open := dialerFor(policy.BlockLocal), dialerFor(false)
	transport := &http.Transport{
		Proxy: nil,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			if host, _, err := net.SplitHostPort(address); err == nil && allowed[normalizeHost(host)] {
				return open.DialContext(ctx, network, address)
			}
			return strict.DialContext(ctx, network, address)
		},
		TLSHandshakeTimeout:   upstreamTLSTimeout,
		ResponseHeaderTimeout: upstreamHeaderTimeout,
		IdleConnTimeout:       90 * time.Second,
		MaxIdleConnsPerHost:   16,
		ForceAttemptHTTP2:     true,
	}
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errRedirectRefused
		},
	}
}

func normalizeHost(host string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
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
