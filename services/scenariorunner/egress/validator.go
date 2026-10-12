package egress

import (
	"context"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"

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
	requestHost := strings.ToLower(u.Hostname())
	if strings.Contains(requestHost, ":") {
		requestHost = "[" + requestHost + "]"
	}
	return Destination{
		URL:         u,
		Hostname:    withoutTrailingDot(strings.ToLower(u.Hostname())),
		RequestHost: requestHost,
		Port:        portFor(u),
	}, nil
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
