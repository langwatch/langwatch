package providers

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strings"

	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/pkg/ssrf"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type endpointResolver func(context.Context, string) ([]net.IP, error)

type customerEndpointPolicy struct {
	blockLocal   bool
	requireHTTPS bool
	allowedHosts map[string]struct{}
	resolve      endpointResolver
	// allowLoopbackPrivateEndpoints lets a private endpoint binding carry a
	// loopback address. Test-only: it lets a local TLS server stand in for a
	// PrivateLink endpoint. Production never sets it.
	allowLoopbackPrivateEndpoints bool
	// bindings are the calling organization's private endpoint bindings
	// (ADR-203). A host bound here is checked against its binding and never
	// resolved. validateCredentialEndpoints sets them per credential.
	bindings []domain.PrivateEndpoint
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
	return domain.NormalizeEndpointHost(host)
}

func defaultEndpointResolver(ctx context.Context, host string) ([]net.IP, error) {
	return net.DefaultResolver.LookupIP(ctx, "ip", host)
}

// endpointAddressError maps a literal or resolved customer-endpoint address
// onto the shared pkg/ssrf rule set. Classification is shared; the always-block
// policy below is this validator's own, deliberately stricter layer on top.
//
// Refused unconditionally (even for a self-hosted operator who has opted into
// private egress):
//   - cloud metadata (pkg/ssrf CategoryMetadata) — credential-theft SSRF;
//   - unspecified 0.0.0.0/:: — collapses to localhost on many network stacks;
//   - link-local 169.254.0.0/16 / fe80::/10 (and link-local multicast) — where
//     undocumented instance-metadata surfaces live.
//
// None of those is ever a legitimate LLM endpoint. Every other non-public
// address is refused only when the policy blocks local egress and the host is
// not explicitly allowlisted. Sharing pkg/ssrf keeps the underlying "which range
// is this address in" decision identical across this validator, the Langy egress
// proxy and the TypeScript app — one rule set, tested by one corpus.
func endpointAddressError(ip net.IP, blockLocal, allowlisted bool) error {
	addr, ok := netip.AddrFromSlice(ip)
	if !ok {
		return fmt.Errorf("customer endpoint resolves to an unparseable address")
	}
	addr = addr.Unmap()
	switch ssrf.Classify(addr) {
	case ssrf.CategoryGlobal:
		return nil
	case ssrf.CategoryMetadata:
		return fmt.Errorf("customer endpoint resolves to a reserved address")
	case ssrf.CategorySpecial:
		if addr.IsUnspecified() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() {
			return fmt.Errorf("customer endpoint resolves to a reserved address")
		}
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

// validateCustomerEndpoint checks a customer-configured URL. A host bound in
// policy.bindings is checked against its binding and never resolved
// (ADR-203); every other host gets the SSRF rules.
func validateCustomerEndpoint(ctx context.Context, rawURL string, policy customerEndpointPolicy) error {
	u, scheme, host, err := parseCustomerEndpoint(rawURL)
	if err != nil {
		return err
	}
	if ep, bound := domain.PrivateEndpointFor(policy.bindings, host); bound {
		return checkBoundEndpoint(u, ep, policy.allowLoopbackPrivateEndpoints)
	}

	if policy.requireHTTPS && scheme != "https" {
		return fmt.Errorf("customer endpoint must use https")
	}
	if parsed := net.ParseIP(host); parsed != nil {
		_, allowlisted := policy.allowedHosts[host]
		return endpointAddressError(parsed, policy.blockLocal, allowlisted)
	}
	return checkResolvedEndpoint(ctx, host, policy)
}

// parseCustomerEndpoint checks the parts of a customer endpoint URL that
// hold whatever the host resolves to, and returns its lowercased scheme and
// normalized host.
func parseCustomerEndpoint(rawURL string) (*url.URL, string, string, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, "", "", fmt.Errorf("customer endpoint is not a valid URL")
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, "", "", fmt.Errorf("customer endpoint must use http or https")
	}
	if u.Opaque != "" {
		return nil, "", "", fmt.Errorf("customer endpoint must use an absolute hierarchical URL")
	}
	if u.User != nil {
		return nil, "", "", fmt.Errorf("customer endpoint must not contain URL credentials")
	}
	host := normalizeEndpointHost(u.Hostname())
	if host == "" {
		return nil, "", "", fmt.Errorf("customer endpoint has no host")
	}
	if isAlwaysBlockedEndpointHost(host) {
		return nil, "", "", fmt.Errorf("customer endpoint host is reserved for cloud metadata")
	}
	return u, scheme, host, nil
}

// checkResolvedEndpoint resolves an unbound host and checks every address.
func checkResolvedEndpoint(ctx context.Context, host string, policy customerEndpointPolicy) error {
	_, allowlisted := policy.allowedHosts[host]
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
	policy.bindings = cred.PrivateEndpoints.List()
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
	if ep, bound := boundEndpointForCredential(cred); bound && !privateEndpointProviderSupported(cred) {
		return fmt.Errorf("customer endpoint %s is bound to a private endpoint, which %s credentials cannot use yet",
			ep.Hostname, cred.ProviderID)
	}
	return nil
}

// credentialEndpointURLs lists the customer-configured URLs a credential
// reaches, the same ones validateCredentialEndpoints checks.
func credentialEndpointURLs(cred domain.Credential) []string {
	var urls []string
	if baseURL := credBaseURL(cred); baseURL != "" {
		urls = append(urls, baseURL)
	}
	if cred.ProviderID == domain.ProviderAzure {
		if endpoint := credExtra(cred, "endpoint", "api_base"); endpoint != "" {
			urls = append(urls, endpoint)
		}
	}
	return urls
}

// urlHost is the normalized host of a URL, or "" when it does not parse.
func urlHost(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return normalizeEndpointHost(u.Hostname())
}

// privateEndpointProviderSupported reports whether a bound credential's
// dispatch can be pinned to its binding. Only the Bifrost lanes reached
// through a per-endpoint provider can: the OpenAI-compatible lane (mapped to
// an OpenAI-type provider for the pinned call) and the URL-derived
// Anthropic, Gemini and OpenAI Responses providers. Azure and Bedrock cannot
// be derived per endpoint in Bifrost, and the direct HTTP lanes (the
// LangWatch provider, realtime mints, Azure audio) share one connection pool
// across tenants, so a bound credential on any of them is refused rather
// than sent through DNS.
func privateEndpointProviderSupported(cred domain.Credential) bool {
	switch cred.ProviderID {
	case domain.ProviderAzure, domain.ProviderBedrock, domain.ProviderLangWatch,
		domain.ProviderOpenAICodex, domain.ProviderVoyage:
		return false
	default:
		provider := mapProvider(cred)
		return provider == bfschemas.VLLM || isURLDerivedProvider(provider)
	}
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
