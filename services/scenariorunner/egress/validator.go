package egress

import (
	"context"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"

	"golang.org/x/net/idna"

	"github.com/langwatch/langwatch/pkg/ssrf"
)

// Refusal messages, word for word the ones packages/egress throws, so a run
// that the fence refuses reads the same whichever runner refused it.
const (
	msgInvalidURL       = "Invalid URL format"
	msgMetadataHost     = "Access to cloud metadata endpoints is not allowed for security reasons"
	msgCloudDomain      = "Access to cloud provider internal domains is not allowed for security reasons"
	msgPrivateLiteral   = "Access to private or localhost IP addresses is not allowed for security reasons"
	msgResolvesMetadata = "This hostname resolves to a cloud metadata endpoint, which is not allowed for security reasons"
	msgResolvesPrivate  = "This hostname resolves to a private or localhost IP address, which is not allowed for security reasons"
)

// blockedCloudDomains are refused by suffix whatever the local policy says
// (packages/egress blocked-hosts.ts).
var blockedCloudDomains = []string{
	".amazonaws.com", ".aws.amazon.com", ".compute.internal", ".internal", ".local", ".localhost",
}

// blockedMetadataHosts are refused by name whatever the local policy says.
var blockedMetadataHosts = map[string]struct{}{
	"169.254.169.254": {}, "fd00:ec2::254": {}, "169.254.170.2": {},
	"metadata": {}, "metadata.google.internal": {}, "metadata.goog": {},
}

// Kind is how a destination passed the policy.
type Kind int

// Destination kinds.
const (
	// KindResolved was judged at a resolved (or literal) address.
	KindResolved Kind = iota
	// KindAllowlisted names an allowlisted host.
	KindAllowlisted
	// KindUnresolved did not resolve and the policy lets that through.
	KindUnresolved
)

// Destination is a URL that passed the policy and the address it was judged at.
type Destination struct {
	Kind Kind
	// URL is the destination as given.
	URL *url.URL
	// Hostname is the host as judged: lowercased, IPv6 unbracketed, no
	// trailing dot.
	Hostname string
	// RequestHost is the host written back into the request line and Host
	// header: an IPv6 literal keeps its brackets.
	RequestHost string
	Port        int
	// Pinned is the judged address the connection must go to; invalid when
	// nothing was resolved.
	Pinned netip.Addr
}

// Resolver looks up a host's addresses.
type Resolver func(ctx context.Context, host string) []netip.Addr

// Validator judges URLs against one policy.
type Validator struct {
	policy  Policy
	resolve Resolver
}

// NewValidator returns a validator; a nil resolver uses the system's.
func NewValidator(policy Policy, resolve Resolver) *Validator {
	if resolve == nil {
		resolve = systemResolve
	}
	return &Validator{policy: policy, resolve: resolve}
}

// systemResolve is A then AAAA records, each lookup's failure read as no
// records, as packages/egress resolves.
func systemResolve(ctx context.Context, host string) []netip.Addr {
	var out []netip.Addr
	for _, network := range []string{"ip4", "ip6"} {
		addrs, err := net.DefaultResolver.LookupNetIP(ctx, network, host)
		if err != nil {
			continue
		}
		for _, a := range addrs {
			out = append(out, a.Unmap())
		}
	}
	return out
}

// Validate admits a URL or returns the refusal.
func (v *Validator) Validate(ctx context.Context, raw string) (Destination, error) {
	dest, err := parseDestination(raw)
	if err != nil {
		return Destination{}, err
	}
	if isCloudMetadataHost(dest.Hostname) {
		return Destination{}, refusal(msgMetadataHost)
	}
	if isBlockedCloudDomain(dest.Hostname) {
		return Destination{}, refusal(msgCloudDomain)
	}
	if v.isAllowlisted(dest.Hostname) {
		return v.allowlisted(ctx, dest)
	}
	if literal, err := netip.ParseAddr(dest.Hostname); err == nil {
		if v.policy.BlockLocal && ssrf.Classify(literal) != ssrf.CategoryGlobal {
			return Destination{}, refusal(msgPrivateLiteral)
		}
		dest.Kind, dest.Pinned = KindResolved, literal.Unmap()
		return dest, nil
	}
	return v.resolved(ctx, dest)
}

func (v *Validator) allowlisted(ctx context.Context, dest Destination) (Destination, error) {
	dest.Kind = KindAllowlisted
	if literal, err := netip.ParseAddr(dest.Hostname); err == nil {
		dest.Pinned = literal.Unmap()
		return dest, nil
	}
	addrs := v.resolve(ctx, dest.Hostname)
	if anyMetadata(addrs) {
		return Destination{}, refusal(msgResolvesMetadata)
	}
	if len(addrs) > 0 {
		dest.Pinned = addrs[0]
	}
	return dest, nil
}

func (v *Validator) resolved(ctx context.Context, dest Destination) (Destination, error) {
	addrs := v.resolve(ctx, dest.Hostname)
	if len(addrs) == 0 {
		if !v.policy.BlockLocal {
			dest.Kind = KindUnresolved
			return dest, nil
		}
		return Destination{}, refusalf("Unable to resolve hostname %q. Please verify the URL is correct.", dest.Hostname)
	}
	if anyMetadata(addrs) {
		return Destination{}, refusal(msgResolvesMetadata)
	}
	if v.policy.BlockLocal {
		for _, a := range addrs {
			if ssrf.Classify(a) != ssrf.CategoryGlobal {
				return Destination{}, refusal(msgResolvesPrivate)
			}
		}
	}
	dest.Kind, dest.Pinned = KindResolved, addrs[0]
	return dest, nil
}

func (v *Validator) isAllowlisted(hostname string) bool {
	for _, h := range v.policy.AllowedHosts {
		if withoutTrailingDot(strings.ToLower(strings.TrimSpace(h))) == hostname {
			return true
		}
	}
	return false
}

func parseDestination(raw string) (Destination, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || !u.IsAbs() {
		return Destination{}, refusal(msgInvalidURL)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return Destination{}, refusalf("Unsupported protocol: %s: — only http and https are allowed", u.Scheme)
	}
	hostname, err := canonicalHost(strings.ToLower(u.Hostname()))
	if err != nil {
		return Destination{}, err
	}
	requestHost := hostname
	if strings.Contains(requestHost, ":") {
		requestHost = "[" + requestHost + "]"
	}
	return Destination{
		URL:         u,
		Hostname:    withoutTrailingDot(hostname),
		RequestHost: requestHost,
		Port:        portFor(u),
	}, nil
}

// whatwgDomains maps a non-ASCII host as the WHATWG URL parser does (UTS 46,
// nontransitional, no STD3 rules), so full-width digits read as digits.
var whatwgDomains = idna.New(idna.MapForLookup(), idna.Transitional(false),
	idna.StrictDomainName(false), idna.CheckHyphens(false))

// canonicalHost reads a host as the WHATWG URL parser the Node child uses
// does: a zone identifier is invalid, and a host ending in a number is an
// IPv4 address in any of its decimal, octal or hex spellings, else invalid.
func canonicalHost(host string) (string, error) {
	if strings.Contains(host, "%") {
		return "", refusal(msgInvalidURL)
	}
	if !strings.Contains(host, ":") && !isASCII(host) {
		mapped, err := whatwgDomains.ToASCII(host)
		if err != nil {
			return "", refusal(msgInvalidURL)
		}
		host = mapped
	}
	if strings.Contains(host, ":") || !endsInANumber(host) {
		return host, nil
	}
	addr, ok := parseWHATWGIPv4(host)
	if !ok {
		return "", refusal(msgInvalidURL)
	}
	return addr.String(), nil
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return false
		}
	}
	return true
}

// endsInANumber is the WHATWG "ends in a number" check on a host's last label.
func endsInANumber(host string) bool {
	parts := strings.Split(host, ".")
	if parts[len(parts)-1] == "" {
		if len(parts) == 1 {
			return false
		}
		parts = parts[:len(parts)-1]
	}
	last := parts[len(parts)-1]
	if last != "" && strings.Trim(last, "0123456789") == "" {
		return true
	}
	_, ok := parseIPv4Number(last)
	return ok
}

// parseWHATWGIPv4 is the WHATWG IPv4 parser: up to four parts, each decimal,
// 0-prefixed octal or 0x-prefixed hex, the last filling the remaining bytes.
func parseWHATWGIPv4(host string) (netip.Addr, bool) {
	numbers, ok := ipv4Numbers(host)
	if !ok {
		return netip.Addr{}, false
	}
	last := numbers[len(numbers)-1]
	if last >= 1<<(8*(5-len(numbers))) {
		return netip.Addr{}, false
	}
	ipv4 := last
	for i, n := range numbers[:len(numbers)-1] {
		if n > 255 {
			return netip.Addr{}, false
		}
		ipv4 += n << (8 * (3 - i))
	}
	return netip.AddrFrom4([4]byte{byte(ipv4 >> 24), byte(ipv4 >> 16), byte(ipv4 >> 8), byte(ipv4)}), true
}

// ipv4Numbers splits a host into at most four IPv4 numbers.
func ipv4Numbers(host string) ([]uint64, bool) {
	parts := strings.Split(host, ".")
	if parts[len(parts)-1] == "" && len(parts) > 1 {
		parts = parts[:len(parts)-1]
	}
	if len(parts) > 4 {
		return nil, false
	}
	numbers := make([]uint64, 0, len(parts))
	for _, part := range parts {
		n, ok := parseIPv4Number(part)
		if !ok {
			return nil, false
		}
		numbers = append(numbers, n)
	}
	return numbers, true
}

// parseIPv4Number reads one IPv4 part; an empty part is not a number.
func parseIPv4Number(part string) (uint64, bool) {
	if part == "" {
		return 0, false
	}
	base := 10
	switch {
	case len(part) >= 2 && (part[:2] == "0x" || part[:2] == "0X"):
		part, base = part[2:], 16
	case len(part) >= 2 && part[0] == '0':
		part, base = part[1:], 8
	}
	if part == "" {
		return 0, true
	}
	n, err := strconv.ParseUint(part, base, 64)
	if err != nil || n > 1<<32 {
		return 0, false
	}
	return n, true
}

func portFor(u *url.URL) int {
	if p := u.Port(); p != "" {
		n, err := strconv.Atoi(p)
		if err == nil {
			return n
		}
	}
	if u.Scheme == "https" {
		return 443
	}
	return 80
}

func withoutTrailingDot(host string) string {
	return strings.TrimSuffix(host, ".")
}

func isCloudMetadataHost(hostname string) bool {
	if _, ok := blockedMetadataHosts[hostname]; ok {
		return true
	}
	addr, err := netip.ParseAddr(hostname)
	return err == nil && ssrf.Classify(addr) == ssrf.CategoryMetadata
}

func isBlockedCloudDomain(hostname string) bool {
	if hostname == "localhost" || hostname == "local" {
		return false
	}
	for _, domain := range blockedCloudDomains {
		if hostname == domain[1:] || strings.HasSuffix(hostname, domain) {
			return true
		}
	}
	return false
}

func anyMetadata(addrs []netip.Addr) bool {
	for _, a := range addrs {
		if ssrf.Classify(a) == ssrf.CategoryMetadata {
			return true
		}
	}
	return false
}
