package providers

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strings"

	"github.com/langwatch/langwatch/pkg/ssrf"
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

// endpointAddressError maps a literal or resolved customer-endpoint address
// onto the shared pkg/ssrf rule set. Cloud metadata is refused unconditionally;
// any other non-public address is refused when the policy blocks local egress
// and the host is not explicitly allowlisted. Sharing pkg/ssrf keeps this
// validator, the Langy egress proxy and the TypeScript app in lockstep on which
// addresses are non-public — the same rule set, tested by one shared corpus.
func endpointAddressError(ip net.IP, blockLocal, allowlisted bool) error {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return fmt.Errorf("customer endpoint resolves to an unparseable address")
	}
	switch ssrf.Classify(addr) {
	case ssrf.CategoryMetadata:
		return fmt.Errorf("customer endpoint resolves to a reserved address")
	case ssrf.CategorySpecial:
		if blockLocal && !allowlisted {
			return fmt.Errorf("customer endpoint resolves to a non-public address")
		}
	}
	return nil
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
		return endpointAddressError(parsed, policy.blockLocal, allowlisted)
	}

	addresses, err := policy.resolve(ctx, host)
	if err != nil {
		return &endpointResolutionError{cause: err}
	}
	if len(addresses) == 0 {
		return fmt.Errorf("customer endpoint host has no address records")
	}
	for _, address := range addresses {
		if err := endpointAddressError(address, policy.blockLocal, allowlisted); err != nil {
			return err
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
