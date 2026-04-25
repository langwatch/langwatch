package httpblock

import (
	"errors"
	"net"
	"net/url"
	"strings"
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
	"169.254.169.254":         {},
	"metadata.google.internal": {},
	"metadata.goog":           {},
	"metadata":                {},
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
func CheckURL(raw string, opts SSRFOptions) error {
	u, err := url.Parse(raw)
	if err != nil {
		return ErrSSRFBlocked
	}
	host := strings.ToLower(u.Hostname())
	if host == "" {
		return ErrSSRFBlocked
	}
	if _, ok := metadataHosts[host]; ok {
		return ErrSSRFBlocked
	}
	for _, allowed := range opts.AllowedHosts {
		if strings.EqualFold(host, allowed) {
			return nil
		}
	}
	if _, ok := blockedHosts[host]; ok {
		return ErrSSRFBlocked
	}
	if ip := net.ParseIP(host); ip != nil {
		if isPrivate(ip) {
			return ErrSSRFBlocked
		}
		return nil
	}
	resolver := opts.Resolver
	if resolver == nil {
		resolver = func(host string) ([]net.IP, error) {
			return net.LookupIP(host)
		}
	}
	ips, err := resolver(host)
	if err != nil {
		// DNS failed — let the actual request fail with a network
		// error so the customer sees a real upstream message instead
		// of a misleading SSRF reject.
		return nil
	}
	for _, ip := range ips {
		if isPrivate(ip) {
			return ErrSSRFBlocked
		}
		if metadataIP(ip) {
			return ErrSSRFBlocked
		}
	}
	return nil
}

// ErrSSRFBlocked is returned when SSRF policy rejects a destination.
var ErrSSRFBlocked = errors.New("ssrf_blocked")

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
