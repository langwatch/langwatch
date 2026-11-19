package providers

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"time"

	"github.com/langwatch/langwatch/pkg/ssrf"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// This file is the Go side of ADR-203 (private model endpoints): the check a
// bound base URL must pass, the address gate a registered address must pass,
// and the dialer that connects to a binding without ever resolving its name.
//
// Every error built here names the hostname and port at most. The registered
// addresses belong to staff and stay out of anything a tenant can read.

// sharedAddressSpace is RFC 6598 (100.64.0.0/10). AWS VPCs may carry it as a
// secondary CIDR, so a PrivateLink interface can sit in it.
var sharedAddressSpace = netip.MustParsePrefix("100.64.0.0/10")

// errPrivateEndpointAddress is the refusal for a binding that carries an
// address no private endpoint may have. Staff validation should make it
// unreachable; this is the defence in depth behind it.
var errPrivateEndpointAddress = errors.New("has an address that may not be dialled")

// privateEndpointAddressAllowed reports whether addr may be dialled as a
// private endpoint address: a private-use (RFC 1918), unique-local (RFC 4193)
// or shared (RFC 6598) address, and never cloud metadata. Loopback, link-local,
// unspecified, multicast, public and every other special range are refused.
// allowLoopback is a test-only seam so a local TLS server can stand in for
// the endpoint.
func privateEndpointAddressAllowed(addr netip.Addr, allowLoopback bool) bool {
	addr = addr.Unmap()
	if !addr.IsValid() || ssrf.Classify(addr) == ssrf.CategoryMetadata {
		return false
	}
	if addr.IsLoopback() {
		return allowLoopback
	}
	return addr.IsPrivate() || (addr.Is4() && sharedAddressSpace.Contains(addr))
}

// checkPrivateEndpointAddresses refuses the whole binding when any of its
// addresses fails the gate: a binding with one bad address is a corrupt
// binding, not one to use partly.
func checkPrivateEndpointAddresses(ep domain.PrivateEndpoint, allowLoopback bool) error {
	if len(ep.Addresses) == 0 {
		return fmt.Errorf("private endpoint for %s has no addresses", ep.Hostname)
	}
	for _, addr := range ep.Addresses {
		if !privateEndpointAddressAllowed(addr, allowLoopback) {
			return fmt.Errorf("private endpoint for %s %w", ep.Hostname, errPrivateEndpointAddress)
		}
	}
	return nil
}

// checkBoundEndpoint applies a binding to a parsed customer endpoint URL. The
// URL must be https on the binding's port. No DNS lookup happens: the
// binding's addresses are where the call goes.
func checkBoundEndpoint(scheme, port string, ep domain.PrivateEndpoint, allowLoopback bool) error {
	if scheme != "https" {
		return fmt.Errorf("customer endpoint %s is bound to a private endpoint and must use https", ep.Hostname)
	}
	if port == "" {
		port = "443"
	}
	if port != strconv.Itoa(ep.Port) {
		return fmt.Errorf("customer endpoint %s:%s is bound to a private endpoint that accepts port %d only",
			ep.Hostname, port, ep.Port)
	}
	return checkPrivateEndpointAddresses(ep, allowLoopback)
}

// privateEndpointDialer connects to a binding's registered addresses in
// order, moving to the next when one refuses or times out. It holds no
// resolver: a bound hostname is never looked up.
type privateEndpointDialer struct {
	// dial is the connect step. Production uses a net.Dialer; tests replace
	// it to observe which addresses are tried.
	dial          func(ctx context.Context, network, address string) (net.Conn, error)
	allowLoopback bool
}

func newPrivateEndpointDialer(timeout time.Duration, allowLoopback bool) privateEndpointDialer {
	d := &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second}
	return privateEndpointDialer{dial: d.DialContext, allowLoopback: allowLoopback}
}

// privateEndpointDialError is the connect failure a tenant sees. It names the
// hostname and port only; the underlying error, which carries the address, is
// kept for errors.Is/As but left out of the text.
type privateEndpointDialError struct {
	host  string
	port  int
	cause error
}

func (e *privateEndpointDialError) Error() string {
	return fmt.Sprintf("could not connect to the private endpoint for %s:%d", e.host, e.port)
}

func (e *privateEndpointDialError) Unwrap() error { return e.cause }

// DialEndpoint dials ep for a request addressed to "host:port". The target
// must be exactly the binding's hostname and port; anything else is refused
// before a connection is attempted.
func (d privateEndpointDialer) DialEndpoint(ctx context.Context, ep domain.PrivateEndpoint, target string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		return nil, fmt.Errorf("private endpoint dial target is not host:port")
	}
	if domain.NormalizeEndpointHost(host) != ep.Hostname || port != strconv.Itoa(ep.Port) {
		// The target is not echoed: it may be an address.
		return nil, fmt.Errorf("private endpoint for %s:%d does not serve this target", ep.Hostname, ep.Port)
	}
	if err := checkPrivateEndpointAddresses(ep, d.allowLoopback); err != nil {
		return nil, err
	}
	var lastErr error
	for _, addr := range ep.Addresses {
		if ctx.Err() != nil {
			break
		}
		conn, dialErr := d.dial(ctx, "tcp", net.JoinHostPort(addr.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		lastErr = dialErr
	}
	if lastErr == nil {
		lastErr = ctx.Err()
	}
	return nil, &privateEndpointDialError{host: ep.Hostname, port: ep.Port, cause: lastErr}
}

// boundEndpointForURL returns the binding a credential URL's host is bound
// to, if any. An unparseable URL is not bound; validation refuses it.
func boundEndpointForCredential(cred domain.Credential) (domain.PrivateEndpoint, bool) {
	if len(cred.PrivateEndpoints) == 0 {
		return domain.PrivateEndpoint{}, false
	}
	for _, raw := range credentialEndpointURLs(cred) {
		if ep, ok := domain.PrivateEndpointFor(cred.PrivateEndpoints, urlHost(raw)); ok {
			return ep, true
		}
	}
	return domain.PrivateEndpoint{}, false
}
