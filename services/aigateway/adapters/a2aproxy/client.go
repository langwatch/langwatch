package a2aproxy

import (
	"errors"
	"net/http"
	"time"

	"github.com/langwatch/langwatch/services/aigateway/adapters/egress"
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
// is checked after DNS resolution by the gateway's egress rule. No environment
// proxy is used, so the address check always sees the real target. Redirects
// are refused, so upstream headers never follow one to another host.
func NewUpstreamClient(policy UpstreamPolicy) *http.Client {
	dialer := egress.NewPolicy(policy.BlockLocal, policy.AllowedHosts).Dialer(upstreamDialTimeout)
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           dialer.DialContext,
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
