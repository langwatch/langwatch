package providers

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/langwatch/langwatch/services/aigateway/adapters/egress"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type endpointResolver func(context.Context, string) ([]net.IP, error)

type customerEndpointPolicy struct {
	egress       egress.Policy
	requireHTTPS bool
	resolve      endpointResolver
}

type endpointResolutionError struct{ cause error }

func (e *endpointResolutionError) Error() string {
	return "customer endpoint host could not be resolved"
}

func (e *endpointResolutionError) Unwrap() error { return e.cause }

func newCustomerEndpointPolicy(blockLocal, requireHTTPS bool, allowedHosts []string) customerEndpointPolicy {
	return customerEndpointPolicy{
		egress:       egress.NewPolicy(blockLocal, allowedHosts),
		requireHTTPS: requireHTTPS,
		resolve:      defaultEndpointResolver,
	}
}

func defaultEndpointResolver(ctx context.Context, host string) ([]net.IP, error) {
	return net.DefaultResolver.LookupIP(ctx, "ip", host)
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
	host := egress.NormalizeHost(u.Hostname())
	if host == "" {
		return fmt.Errorf("customer endpoint has no host")
	}
	if isAlwaysBlockedEndpointHost(host) {
		return fmt.Errorf("customer endpoint host is reserved for cloud metadata")
	}

	allowlisted := policy.egress.Allowlisted(host)
	if policy.requireHTTPS && scheme != "https" {
		return fmt.Errorf("customer endpoint must use https")
	}
	if parsed := net.ParseIP(host); parsed != nil {
		return egress.AddressError(parsed, policy.egress.BlockLocal, allowlisted)
	}

	addresses, err := policy.resolve(ctx, host)
	if err != nil {
		return &endpointResolutionError{cause: err}
	}
	if len(addresses) == 0 {
		return fmt.Errorf("customer endpoint host has no address records")
	}
	for _, address := range addresses {
		if err := egress.AddressError(address, policy.egress.BlockLocal, allowlisted); err != nil {
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
