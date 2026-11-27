// Package egress is the gateway's one rule for calling a customer-configured
// host: which resolved addresses it may reach (BLOCK_LOCAL_HTTP_CALLS and
// ALLOWED_PROXY_HOSTS over pkg/ssrf), the dialer that resolves once and
// connects only to an address it checked, and the CONNECT proxy that gives
// Bifrost's provider clients that same dialer. Provider and A2A calls share it.
package egress

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"
	"time"

	"github.com/langwatch/langwatch/pkg/ssrf"
)

// ErrBlocked is what every refused address matches with errors.Is.
var ErrBlocked = errors.New("customer endpoint address is not allowed")

// blockedError keeps each refusal's own message while matching ErrBlocked.
type blockedError string

func (e blockedError) Error() string { return string(e) }

func (blockedError) Is(target error) bool { return target == ErrBlocked }

// Policy is the egress setting: BlockLocal refuses non-public addresses, and
// an exact allowlisted host (or IP) may still reach one.
type Policy struct {
	BlockLocal bool
	allowed    map[string]struct{}
	lookup     ssrf.Lookup
}

// NewPolicy builds a policy from BLOCK_LOCAL_HTTP_CALLS and ALLOWED_PROXY_HOSTS.
func NewPolicy(blockLocal bool, allowedHosts []string) Policy {
	policy := Policy{BlockLocal: blockLocal, allowed: make(map[string]struct{}, len(allowedHosts))}
	for _, host := range allowedHosts {
		if host = NormalizeHost(host); host != "" {
			policy.allowed[host] = struct{}{}
		}
	}
	return policy
}

// WithLookup replaces the system resolver the dialer uses (tests).
func (p Policy) WithLookup(lookup ssrf.Lookup) Policy {
	p.lookup = lookup
	return p
}

// NormalizeHost is the spelling hosts are compared in.
func NormalizeHost(host string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
}

// Allowlisted reports whether host is an exact ALLOWED_PROXY_HOSTS entry.
func (p Policy) Allowlisted(host string) bool {
	_, ok := p.allowed[NormalizeHost(host)]
	return ok
}

// AddressError judges one literal or resolved address for host, the name
// (or literal) the URL gives. Only that host is matched against the
// allowlist, never the address it resolves to: listing an IP must not admit
// every name that points at it.
func (p Policy) AddressError(ip net.IP, host string) error {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return blockedError("customer endpoint resolves to an unparseable address")
	}
	return p.addrError(addr, NormalizeHost(host))
}

// addrError maps an address onto pkg/ssrf. Cloud metadata, unspecified and
// link-local addresses are refused even when allowlisted. Other non-public
// addresses are refused when BlockLocal and not allowlisted. Loopback needs
// more: a loopback name or the allowlist, else a public name rebound to
// 127.0.0.1 reaches this pod's own listeners with local calls allowed.
func (p Policy) addrError(addr netip.Addr, host string) error {
	addr = addr.Unmap()
	allowlisted := host != "" && p.Allowlisted(host)
	switch ssrf.Classify(addr) {
	case ssrf.CategoryGlobal:
		return nil
	case ssrf.CategoryMetadata:
		return blockedError("customer endpoint resolves to a reserved address")
	case ssrf.CategorySpecial:
		return p.specialAddrError(addr, host, allowlisted)
	}
	return nil
}

// specialAddrError judges a non-public address that is not cloud metadata.
func (p Policy) specialAddrError(addr netip.Addr, host string, allowlisted bool) error {
	switch {
	case addr.IsUnspecified() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast():
		return blockedError("customer endpoint resolves to a reserved address")
	case allowlisted:
		return nil
	case p.BlockLocal:
		return blockedError("customer endpoint resolves to a non-public address")
	case addr.IsLoopback() && !ssrf.NamesLoopback(host):
		return blockedError("customer endpoint resolves to loopback through a name that is not a loopback name")
	}
	return nil
}

// CheckDial applies the policy to the resolved "ip:port" a dial connects to.
// dialHost is the name or literal the URL gives; empty means the URL gave
// the address itself.
func (p Policy) CheckDial(address, dialHost string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return blockedError("customer endpoint address is not host:port")
	}
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return blockedError("customer endpoint did not resolve to an IP address")
	}
	if dialHost == "" {
		dialHost = host
	}
	return p.addrError(addr, NormalizeHost(dialHost))
}

// check judges every address one dial resolved.
func (p Policy) check(host string, addrs []netip.Addr) error {
	if len(addrs) == 0 {
		return blockedError("customer endpoint host has no address records")
	}
	host = NormalizeHost(strings.Trim(host, "[]"))
	for _, addr := range addrs {
		if err := p.addrError(addr, host); err != nil {
			return err
		}
	}
	return nil
}

// Dialer resolves each dial once, judges every address against the policy,
// and connects only to an address it judged (ssrf.PinnedDialer).
type Dialer struct{ pinned ssrf.PinnedDialer }

// Dialer builds the pinned, policy-checking dialer for this policy.
func (p Policy) Dialer(timeout time.Duration) Dialer {
	return Dialer{pinned: ssrf.PinnedDialer{
		Dialer: &net.Dialer{Timeout: timeout, KeepAlive: 30 * time.Second},
		Lookup: p.lookup,
		Check:  p.check,
	}}
}

// DialContext dials address, refusing it when the policy does not allow an
// address it resolves to.
func (d Dialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	return d.pinned.DialContext(ctx, network, address)
}
