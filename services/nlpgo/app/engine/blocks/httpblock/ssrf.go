package httpblock

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"net/url"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/ssrf"
)

// SSRFOptions tunes the destination policy for the HTTP block.
type SSRFOptions struct {
	// AllowedHosts is the comma-separated allow-list (host:port pairs
	// or bare hosts) that bypasses the private/loopback ban. Mirrors
	// ALLOWED_PROXY_HOSTS on the Python side.
	AllowedHosts []string
	// StrictPublicOnly refuses every address that is not globally
	// routable — CGNAT (100.64.0.0/10), reserved (240.0.0.0/4),
	// non-link-local multicast, NAT64, 6to4, Teredo, benchmarking and
	// documentation ranges — on top of the private/loopback/link-local
	// set that is refused either way.
	//
	// It is OFF by default on purpose. Turning the wider set on
	// unconditionally would silently break self-hosted installs that
	// reach an internal service over a Tailscale address (100.64/10) or
	// any other range that was historically permitted here — a working
	// workflow would start returning ssrf_blocked on a patch upgrade
	// with nothing in the release notes to explain it. Hosted LangWatch
	// sets it explicitly; self-hosters opt in once they have checked
	// their egress logs, which name every address this would refuse
	// (see logWouldRefuse).
	//
	// Cloud metadata is refused regardless of this setting.
	StrictPublicOnly bool
	// AllowLocal permits the private and loopback destinations that are
	// otherwise refused. It is what BLOCK_LOCAL_HTTP_CALLS=false
	// means for this service, and it is the whole reason an on-prem install
	// can point a workflow at a service on its own network.
	//
	// Spelled as the permission rather than the prohibition so the zero value
	// keeps refusing. The variable it comes from is named the other way round,
	// so a field named for the prohibition would make an SSRFOptions{} that
	// nobody filled in — a test, a new call site, a struct grown a field
	// since — silently mean "reach anywhere on the private network". A
	// security default is worth an inversion at the one place that resolves
	// it (cmd/root.go, from the operator's variable).
	//
	// StrictPublicOnly still wins: it exists to say "globally routable only",
	// and a private address is not globally routable. Cloud metadata and
	// link-local are refused either way, and loopback needs a loopback name
	// or the allowlist (see loopbackThroughAnotherName).
	AllowLocal bool
	// Logger receives egress refusals and strict-mode previews. nil is
	// safe and discards them.
	Logger *zap.Logger
	// Resolver lets tests inject a fake DNS lookup. nil = real DNS.
	Resolver func(host string) ([]net.IP, error)
}

// logger returns the configured logger or a no-op one.
func (o SSRFOptions) logger() *zap.Logger {
	if o.Logger == nil {
		return zap.NewNop()
	}
	return o.Logger
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
		// A name that does not resolve is left to fail at dial time, as below.
		if ips, err := addrsOf(host, opts); err == nil && anyNeverPermitted(ips, opts, host) {
			return ErrSSRFBlocked
		}
		return nil
	}
	if ip := literalIP(host); ip != nil {
		if ipBlocked(ip, opts, host) {
			return ErrSSRFBlocked
		}
		return nil
	}
	ips, err := resolveHost(host, opts)
	if err != nil {
		// DNS failed — let the actual request fail with a network
		// error so the customer sees a real upstream message instead
		// of a misleading SSRF reject.
		return nil //nolint:nilerr // error is surfaced via the channel/result payload, not the function error return
	}
	for _, ip := range ips {
		if ipBlocked(ip, opts, host) {
			return ErrSSRFBlocked
		}
	}
	return nil
}

// SafeDialer returns a DialContext function that re-runs the SSRF policy at
// dial time and connects only to an address it checked (ssrf.PinnedDialer,
// shared with the AI gateway). This closes the DNS-rebinding TOCTOU: net/http
// would otherwise resolve the host again and could connect to an address
// CheckURL never saw. Allow-listed hosts skip the private-range check but
// not the metadata one.
func SafeDialer(opts SSRFOptions) func(ctx context.Context, network, addr string) (net.Conn, error) {
	pinned := ssrf.PinnedDialer{
		Dialer: &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second},
		Lookup: opts.lookup(),
		Check: func(host string, addrs []netip.Addr) error {
			return checkResolved(strings.ToLower(host), addrs, opts)
		},
	}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		// The static deny list answers before DNS, as CheckURL does.
		if _, deny := hostPolicy(strings.ToLower(host), opts); deny {
			return nil, ErrSSRFBlocked
		}
		return pinned.DialContext(ctx, network, addr)
	}
}

// checkResolved applies the policy to every address one dial resolved.
func checkResolved(host string, addrs []netip.Addr, opts SSRFOptions) error {
	allow, deny := hostPolicy(host, opts)
	if deny || len(addrs) == 0 {
		return ErrSSRFBlocked
	}
	ips := make([]net.IP, 0, len(addrs))
	for _, addr := range addrs {
		ips = append(ips, net.IP(addr.AsSlice()))
	}
	if allow {
		if anyNeverPermitted(ips, opts, host) {
			return ErrSSRFBlocked
		}
		return nil
	}
	for _, ip := range ips {
		if ipBlocked(ip, opts, host) {
			return ErrSSRFBlocked
		}
	}
	return nil
}

// lookup adapts the injected Resolver to ssrf.Lookup; nil means system DNS.
func (o SSRFOptions) lookup() ssrf.Lookup {
	if o.Resolver == nil {
		return ssrf.SystemLookup
	}
	return func(_ context.Context, host string) ([]netip.Addr, error) {
		ips, err := o.Resolver(host)
		if err != nil {
			return nil, err
		}
		addrs := make([]netip.Addr, 0, len(ips))
		for _, ip := range ips {
			addr, ok := netip.AddrFromSlice(ip)
			if !ok {
				return nil, ErrSSRFBlocked // an answer the policy cannot judge is refused
			}
			addrs = append(addrs, addr)
		}
		return addrs, nil
	}
}

// addrsOf is the literal address, or what the name resolves to.
func addrsOf(host string, opts SSRFOptions) ([]net.IP, error) {
	if ip := literalIP(host); ip != nil {
		return []net.IP{ip}, nil
	}
	return resolveHost(host, opts)
}

// literalIP is host as an address literal, a scoped IPv6 one included, the
// way the connection parses it; nil when host is a name.
func literalIP(host string) net.IP {
	addr, err := netip.ParseAddr(host)
	if err != nil {
		return nil
	}
	return net.IP(addr.WithZone("").AsSlice())
}

// anyNeverPermitted reports whether an allow-listed host reaches cloud metadata
// or a link-local address, which the allow-list never lifts. An unparseable
// address counts, failing closed.
func anyNeverPermitted(ips []net.IP, opts SSRFOptions, host string) bool {
	for _, ip := range ips {
		addr, ok := netip.AddrFromSlice(ip)
		if !ok {
			opts.logger().Warn("ssrf_refused",
				zap.String("host", host),
				zap.String("reason", "unparseable_address"),
			)
			return true
		}
		if ssrf.Classify(addr.Unmap()) == ssrf.CategoryMetadata {
			opts.logger().Warn("ssrf_refused",
				zap.String("host", host),
				zap.String("reason", "allowlisted_host_resolves_to_metadata"),
			)
			return true
		}
		if linkLocal(addr.Unmap()) {
			opts.logger().Warn("ssrf_refused",
				zap.String("host", host),
				zap.String("reason", "allowlisted_host_resolves_to_link_local"),
			)
			return true
		}
	}
	return false
}

// linkLocal is the range platform services live on (cloud metadata, the AWS
// Lambda runtime API), never a workflow's destination, as in the AI gateway.
func linkLocal(addr netip.Addr) bool {
	return addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast()
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
	// The loopback aliases are a shortcut for the IP-level check below, taken
	// before DNS so the common case answers without a lookup. When local
	// destinations are permitted they are no longer a shortcut to anything —
	// let the name resolve and let ipBlocked decide, so "localhost" and
	// "127.0.0.1" get the same answer as every other private address.
	if _, ok := blockedHosts[host]; ok && !allowsLocal(opts) {
		return false, true
	}
	return false, false
}

// allowsLocal reports whether this policy permits the private/loopback set.
// Strict egress overrides the permission: it means globally routable only,
// and none of these addresses are globally routable.
func allowsLocal(opts SSRFOptions) bool {
	return opts.AllowLocal && !opts.StrictPublicOnly
}

// ipBlocked is the unified IP-level deny check, classifying against the shared
// pkg/ssrf rule set so the HTTP block, the Langy egress proxy, the AI gateway
// and the TypeScript app agree on what each address IS. What to DO about a
// non-public address differs by deployment, and that is the split below:
//
//   - Cloud metadata is refused unconditionally. This now includes Azure
//     WireServer (168.63.129.16), which the pre-pkg/ssrf check missed — a
//     genuine hole, closed for everyone, with no legitimate traffic behind it.
//   - Private, loopback, link-local and unspecified addresses are refused
//     unless the deployment permits them (AllowLocal, i.e.
//     BLOCK_LOCAL_HTTP_CALLS=false). An on-prem install whose agents live on
//     its own network is the normal case for that, and refusing it here while
//     the rest of the product allowed it was a difference customers hit as
//     "it passes the test button and fails the run".
//   - Every other non-globally-routable address (CGNAT, reserved, multicast,
//     NAT64, 6to4, benchmarking, documentation) is refused only under
//     StrictPublicOnly. See that field for why it is opt-in.
//
// The AllowedHosts escape hatch bypasses this check, except for cloud metadata
// (see anyNeverPermitted), so an operator who does need one of these addresses
// has a way through without widening the policy for every workflow.
func ipBlocked(ip net.IP, opts SSRFOptions, host string) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		opts.logger().Warn("ssrf_refused",
			zap.String("host", host),
			zap.String("reason", "unparseable_address"),
			zap.String("hint", "the resolver returned an address this build cannot parse; the request was refused rather than dialed"),
		)
		return true // fail closed on an address we cannot classify
	}

	// net.ParseIP hands back a 16-byte IPv4-in-IPv6 form, so an IPv4 literal
	// arrives here as ::ffff:a.b.c.d. Every classification below is already
	// unmap-safe (both Classify and netip's own predicates unmap internally);
	// this is for the operator reading the log, who should see "100.64.0.1"
	// rather than "::ffff:100.64.0.1".
	addr = addr.Unmap()

	category := ssrf.Classify(addr)
	if category == ssrf.CategoryMetadata {
		opts.logger().Warn("ssrf_refused",
			zap.String("host", host),
			zap.String("address", addr.String()),
			zap.String("range", ssrf.Describe(addr)),
			zap.String("reason", "cloud_metadata"),
			zap.String("hint", "cloud instance metadata is never a permitted destination and cannot be allow-listed"),
		)
		return true
	}

	if linkLocal(addr) {
		opts.logger().Warn("ssrf_refused",
			zap.String("host", host),
			zap.String("address", addr.String()),
			zap.String("range", ssrf.Describe(addr)),
			zap.String("reason", "link_local"),
			zap.String("hint", "link-local addresses carry platform services and are never a permitted destination, whatever BLOCK_LOCAL_HTTP_CALLS says"),
		)
		return true
	}

	if legacyBlocked(addr) {
		if allowsLocal(opts) {
			return loopbackThroughAnotherName(opts, host, addr)
		}
		opts.logger().Warn("ssrf_refused",
			zap.String("host", host),
			zap.String("address", addr.String()),
			zap.String("range", ssrf.Describe(addr)),
			zap.String("reason", "private_address"),
			zap.String("hint", "this deployment blocks local destinations; add this host to ALLOWED_PROXY_HOSTS to reach it, or set BLOCK_LOCAL_HTTP_CALLS=false to permit them all"),
		)
		return true
	}

	if category == ssrf.CategoryGlobal {
		return false
	}

	// Non-public, but outside the historical deny set: the opt-in band.
	if opts.StrictPublicOnly {
		opts.logger().Warn("ssrf_refused",
			zap.String("host", host),
			zap.String("address", addr.String()),
			zap.String("range", ssrf.Describe(addr)),
			zap.String("reason", "strict_public_only"),
			zap.String("hint", "strict egress is enabled, so only globally routable addresses are permitted; add this host to ALLOWED_PROXY_HOSTS if it is an internal service you intend to reach"),
		)
		return true
	}
	logWouldRefuse(opts, host, addr)
	return false
}

// loopbackThroughAnotherName refuses loopback reached through a name that is
// not a loopback name, even with local calls allowed: otherwise a public name
// rebound to 127.0.0.1 reaches this service's own listeners. Loopback stays
// reachable as a literal, as localhost or *.localhost, or via the allowlist.
func loopbackThroughAnotherName(opts SSRFOptions, host string, addr netip.Addr) bool {
	if !addr.IsLoopback() || ssrf.NamesLoopback(host) {
		return false
	}
	opts.logger().Warn("ssrf_refused",
		zap.String("host", host),
		zap.String("address", addr.String()),
		zap.String("reason", "loopback_through_non_loopback_name"),
		zap.String("hint", "only a loopback literal, localhost or a .localhost name reaches loopback; add this host to ALLOWED_PROXY_HOSTS if it is intended"),
	)
	return true
}

// legacyBlocked is the deny set that applies whether or not strict egress is
// on: loopback, link-local, RFC1918/unique-local and the unspecified address.
// Kept as an explicit predicate rather than folded into pkg/ssrf because it is
// a deployment policy — "what this service refused before strict mode existed"
// — not a property of the address.
func legacyBlocked(addr netip.Addr) bool {
	return addr.IsLoopback() || addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() || addr.IsPrivate() || addr.IsUnspecified()
}

// logWouldRefuse reports an address that strict egress would have refused but
// that this deployment permits. It is the whole reason the tightening is
// opt-in rather than silent: an operator can read their logs, see exactly
// which internal destinations their workflows depend on, allow-list them, and
// only then turn StrictPublicOnly on — instead of discovering the list from a
// broken production workflow after an upgrade.
func logWouldRefuse(opts SSRFOptions, host string, addr netip.Addr) {
	opts.logger().Info("ssrf_permitted_non_public_address",
		zap.String("host", host),
		zap.String("address", addr.String()),
		zap.String("range", ssrf.Describe(addr)),
		zap.String("hint", "strict egress would refuse this address; allow-list this host via ALLOWED_PROXY_HOSTS before enabling strict egress, or leave it as-is to keep reaching it"),
	)
}

// resolveHost looks up every address for host, falling back to the system
// resolver when the options carry none. Tests inject their own resolver here to
// exercise multi-answer and DNS-rebinding sequences without real DNS.
func resolveHost(host string, opts SSRFOptions) ([]net.IP, error) {
	r := opts.Resolver
	if r == nil {
		r = net.LookupIP
	}
	return r(host)
}
