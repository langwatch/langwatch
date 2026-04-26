package httpblock

import (
	"context"
	"errors"
	"net"
	"net/url"
	"strings"
	"time"
)

// SSRFOptions tunes the destination policy for the HTTP block.
type SSRFOptions struct {
	// AllowedHosts is the comma-separated allow-list (host:port pairs
	// or bare hosts) that bypasses the private/loopback ban. Mirrors
	// ALLOWED_PROXY_HOSTS on the Python side.
	AllowedHosts []string
	// Resolver lets tests inject a fake DNS lookup. nil = real DNS.
	Resolver func(host string) ([]net.IP, error)
}

// metadataHosts is the always-blocked set: cloud metadata endpoints
// MUST never be reachable from a workflow regardless of allow-list.
var metadataHosts = map[string]struct{}{
	"169.254.169.254":          {},
	"metadata.google.internal": {},
	"metadata.goog":            {},
	"metadata":                 {},
}

// blockedHosts are common loopback aliases to reject before DNS.
var blockedHosts = map[string]struct{}{
	"localhost": {},
	"127.0.0.1": {},
	"0.0.0.0":   {},
	"::1":       {},
	"[::1]":     {},
}

// CheckURL returns nil if the URL is permitted; ErrSSRFBlocked otherwise.
//
// CheckURL is the early/optimistic gate — it gives a clean error message
// before we build the request. It is NOT the only line of defense:
// SafeDialer re-runs the policy at dial time so that a host whose DNS
// resolves to a public IP at check time but a private IP at dial time
// (DNS rebinding) cannot slip past.
func CheckURL(raw string, opts SSRFOptions) error {
	u, err := url.Parse(raw)
	if err != nil {
		return ErrSSRFBlocked
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return ErrSSRFBlocked
	}
	allow, deny := hostPolicy(host, opts)
	if deny {
		return ErrSSRFBlocked
	}
	if allow {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil {
		if ipBlocked(ip) {
			return ErrSSRFBlocked
		}
		return nil
	}
	ips, err := resolveHost(host, opts)
	if err != nil {
		// DNS failed — let the actual request fail with a network
		// error so the customer sees a real upstream message instead
		// of a misleading SSRF reject.
		return nil
	}
	for _, ip := range ips {
		if ipBlocked(ip) {
			return ErrSSRFBlocked
		}
	}
	return nil
}

// SafeDialer returns a DialContext function that re-runs the SSRF
// policy at dial time and dials against the validated IP rather than
// the hostname. This closes the DNS-rebinding TOCTOU: net/http would
// otherwise resolve the host a second time inside the standard library
// and could connect to a different IP than what CheckURL validated.
//
// allow-listed hosts skip the IP check entirely and are dialed via the
// hostname (so the kernel resolver picks an address). The allow-list
// is the customer-controlled escape hatch — same trust model as
// CheckURL.
func SafeDialer(opts SSRFOptions) func(ctx context.Context, network, addr string) (net.Conn, error) {
	base := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		host = strings.ToLower(host)
		allow, deny := hostPolicy(host, opts)
		if deny {
			return nil, ErrSSRFBlocked
		}
		if allow {
			return base.DialContext(ctx, network, addr)
		}
		var ips []net.IP
		if ip := net.ParseIP(host); ip != nil {
			ips = []net.IP{ip}
		} else {
			resolved, err := resolveHost(host, opts)
			if err != nil {
				return nil, err
			}
			ips = resolved
		}
		if len(ips) == 0 {
			return nil, ErrSSRFBlocked
		}
		for _, ip := range ips {
			if ipBlocked(ip) {
				return nil, ErrSSRFBlocked
			}
		}
		// Dial against the IP we just validated — net/http's internal
		// resolver can't redirect us to an unchecked address.
		return base.DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}
}

// ErrSSRFBlocked is returned when SSRF policy rejects a destination.
var ErrSSRFBlocked = errors.New("ssrf_blocked")

// hostPolicy classifies a hostname against the static deny/allow
// lists. Returns (allow, deny) — both false means "needs IP-level
// check". Pulled out so CheckURL and SafeDialer apply the same rules.
func hostPolicy(host string, opts SSRFOptions) (allow, deny bool) {
	if host == "" {
		return false, true
	}
	if _, ok := metadataHosts[host]; ok {
		return false, true
	}
	for _, allowed := range opts.AllowedHosts {
		if strings.EqualFold(host, allowed) {
			return true, false
		}
	}
	if _, ok := blockedHosts[host]; ok {
		return false, true
	}
	return false, false
}

// ipBlocked is the unified IP-level deny check.
func ipBlocked(ip net.IP) bool { return isPrivate(ip) || metadataIP(ip) }

func resolveHost(host string, opts SSRFOptions) ([]net.IP, error) {
	r := opts.Resolver
	if r == nil {
		r = func(h string) ([]net.IP, error) { return net.LookupIP(h) }
	}
	return r(host)
}

// isPrivate covers loopback, link-local, private, and unspecified IPs.
func isPrivate(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsPrivate() || ip.IsUnspecified() {
		return true
	}
	return false
}

// metadataIP catches IPv4 169.254.169.254 even after DNS resolution.
func metadataIP(ip net.IP) bool {
	return ip.String() == "169.254.169.254"
}
