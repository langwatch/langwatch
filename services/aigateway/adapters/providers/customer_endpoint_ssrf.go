package providers

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strings"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type endpointResolver func(context.Context, string) ([]net.IP, error)

type customerEndpointPolicy struct {
	blockLocal   bool
	requireHTTPS bool
	allowedHosts map[string]struct{}
	resolve      endpointResolver
}

type endpointResolutionError struct{ cause error }

func (e *endpointResolutionError) Error() string {
	return "customer endpoint host could not be resolved"
}

func (e *endpointResolutionError) Unwrap() error { return e.cause }

// netip handles private, loopback, link-local, multicast, and unspecified
// addresses directly. This small remainder comes from the IANA special-purpose
// registries and covers ranges whose Go classification is still global-unicast.
var nonPublicPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("100::/64"),
	netip.MustParsePrefix("64:ff9b:1::/48"),
	netip.MustParsePrefix("2001:db8::/32"),
}

var cloudMetadataAddresses = map[netip.Addr]struct{}{
	netip.MustParseAddr("168.63.129.16"): {}, // Azure WireServer
	netip.MustParseAddr("fd00:ec2::254"): {}, // AWS EC2 IMDS IPv6
}

func newCustomerEndpointPolicy(blockLocal, requireHTTPS bool, allowedHosts []string) customerEndpointPolicy {
	policy := customerEndpointPolicy{
		blockLocal:   blockLocal,
		requireHTTPS: requireHTTPS,
		allowedHosts: make(map[string]struct{}, len(allowedHosts)),
		resolve:      defaultEndpointResolver,
	}
	for _, host := range allowedHosts {
		host = normalizeEndpointHost(host)
		if host != "" {
			policy.allowedHosts[host] = struct{}{}
		}
	}
	return policy
}

func normalizeEndpointHost(host string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
}

func defaultEndpointResolver(ctx context.Context, host string) ([]net.IP, error) {
	return net.DefaultResolver.LookupIP(ctx, "ip", host)
}

func isPublicEndpointIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return false
	}
	addr = addr.Unmap()
	if addr.IsUnspecified() || addr.IsLoopback() || addr.IsPrivate() ||
		addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() {
		return false
	}
	for _, prefix := range nonPublicPrefixes {
		if prefix.Contains(addr) {
			return false
		}
	}
	return true
}

func isAlwaysBlockedEndpointIP(ip net.IP) bool {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true
	}
	addr = addr.Unmap()
	if addr.IsUnspecified() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() {
		return true
	}
	_, blocked := cloudMetadataAddresses[addr]
	return blocked
}

func isAlwaysBlockedEndpointHost(host string) bool {
	return host == "metadata" || host == "metadata.google.internal" ||
		host == "metadata.goog" || strings.HasSuffix(host, ".compute.internal")
}

func validateCustomerEndpoint(ctx context.Context, rawURL string, policy customerEndpointPolicy) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("customer endpoint is not a valid URL")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("customer endpoint must use http or https")
	}
	if u.Opaque != "" {
		return fmt.Errorf("customer endpoint must use an absolute hierarchical URL")
	}
	if u.User != nil {
		return fmt.Errorf("customer endpoint must not contain URL credentials")
	}
	host := normalizeEndpointHost(u.Hostname())
	if host == "" {
		return fmt.Errorf("customer endpoint has no host")
	}
	if isAlwaysBlockedEndpointHost(host) {
		return fmt.Errorf("customer endpoint host is reserved for cloud metadata")
	}

	_, allowlisted := policy.allowedHosts[host]
	if policy.requireHTTPS && scheme != "https" {
		return fmt.Errorf("customer endpoint must use https")
	}
	if parsed := net.ParseIP(host); parsed != nil {
		if isAlwaysBlockedEndpointIP(parsed) {
			return fmt.Errorf("customer endpoint resolves to a reserved address")
		}
		if policy.blockLocal && !allowlisted && !isPublicEndpointIP(parsed) {
			return fmt.Errorf("customer endpoint resolves to a non-public address")
		}
		return nil
	}

	addresses, err := policy.resolve(ctx, host)
	if err != nil {
		return &endpointResolutionError{cause: err}
	}
	if len(addresses) == 0 {
		return fmt.Errorf("customer endpoint host has no address records")
	}
	for _, address := range addresses {
		if isAlwaysBlockedEndpointIP(address) {
			return fmt.Errorf("customer endpoint resolves to a reserved address")
		}
		if policy.blockLocal && !allowlisted && !isPublicEndpointIP(address) {
			return fmt.Errorf("customer endpoint resolves to a non-public address")
		}
	}
	return nil
}

func validateCredentialEndpoints(ctx context.Context, cred domain.Credential, policy customerEndpointPolicy) error {
	if baseURL := credBaseURL(cred); baseURL != "" {
		if err := validateCustomerEndpoint(ctx, baseURL, policy); err != nil {
			return fmt.Errorf("base_url rejected: %w", err)
		}
	}
	if cred.ProviderID == domain.ProviderAzure {
		if endpoint := credExtra(cred, "endpoint", "api_base"); endpoint != "" {
			if err := validateCustomerEndpoint(ctx, endpoint, policy); err != nil {
				return fmt.Errorf("azure endpoint rejected: %w", err)
			}
		}
	}
	return nil
}

func isRetryableEndpointResolutionError(err error) bool {
	var resolutionErr *endpointResolutionError
	if !errors.As(err, &resolutionErr) {
		return false
	}
	var dnsErr *net.DNSError
	if !errors.As(resolutionErr.cause, &dnsErr) {
		return true
	}
	return !dnsErr.IsNotFound
}
