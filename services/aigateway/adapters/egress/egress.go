// Package egress is the gateway's one rule for calling a customer-configured
// host: which resolved addresses it may reach (BLOCK_LOCAL_HTTP_CALLS and
// ALLOWED_PROXY_HOSTS over pkg/ssrf) and the dialer that checks every address
// immediately before it connects. Provider endpoints and A2A targets share it.
package egress

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"
	"syscall"
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

// NormalizeHost is the spelling hosts are compared in.
func NormalizeHost(host string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
}

// Allowlisted reports whether host is an exact ALLOWED_PROXY_HOSTS entry.
func (p Policy) Allowlisted(host string) bool {
	_, ok := p.allowed[NormalizeHost(host)]
	return ok
}

// AddressError maps a literal or resolved address onto pkg/ssrf. Cloud
// metadata, unspecified and link-local addresses are refused even when
// allowlisted: none is ever a legitimate customer endpoint. Every other
// non-public address is refused only when blockLocal and not allowlisted.
func AddressError(ip net.IP, blockLocal, allowlisted bool) error {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return blockedError("customer endpoint resolves to an unparseable address")
	}
	addr = addr.Unmap()
	switch ssrf.Classify(addr) {
	case ssrf.CategoryGlobal:
		return nil
	case ssrf.CategoryMetadata:
		return blockedError("customer endpoint resolves to a reserved address")
	case ssrf.CategorySpecial:
		if addr.IsUnspecified() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() {
			return blockedError("customer endpoint resolves to a reserved address")
		}
		if blockLocal && !allowlisted {
			return blockedError("customer endpoint resolves to a non-public address")
		}
	}
	return nil
}

// CheckDial applies the policy to the resolved "ip:port" a dialer is about to
// connect to. Only the host the URL names (dialHost, a name or a literal IP)
// is matched against the allowlist, never the address a name resolves to:
// listing an IP must not admit every name that points at it.
func (p Policy) CheckDial(address, dialHost string) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		return blockedError("customer endpoint address is not host:port")
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return blockedError("customer endpoint did not resolve to an IP address")
	}
	return AddressError(ip, p.BlockLocal, dialHost != "" && p.Allowlisted(dialHost))
}

// Dialer re-checks every resolved address against the policy immediately
// before connecting, so DNS rebinding cannot slip past an earlier check.
type Dialer struct{ dialer *net.Dialer }

// dialHostKey carries the host a dial was asked for (before resolution) to
// the pre-connect check, so an allowlisted name keeps its exemption there.
type dialHostKey struct{}

// Dialer builds the pre-connect checking dialer for this policy.
func (p Policy) Dialer(timeout time.Duration) Dialer {
	return Dialer{dialer: &net.Dialer{
		Timeout:   timeout,
		KeepAlive: 30 * time.Second,
		ControlContext: func(ctx context.Context, _, address string, _ syscall.RawConn) error {
			dialHost, _ := ctx.Value(dialHostKey{}).(string)
			return p.CheckDial(address, dialHost)
		},
	}}
}

// DialContext dials address, refusing it when the policy does not allow the
// address it resolves to.
func (d Dialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	if host, _, err := net.SplitHostPort(address); err == nil {
		ctx = context.WithValue(ctx, dialHostKey{}, NormalizeHost(host))
	}
	return d.dialer.DialContext(ctx, network, address)
}
