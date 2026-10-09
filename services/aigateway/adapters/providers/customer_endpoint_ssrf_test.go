package providers

import (
	"context"
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func staticResolver(addresses ...string) endpointResolver {
	return func(context.Context, string) ([]net.IP, error) {
		ips := make([]net.IP, 0, len(addresses))
		for _, address := range addresses {
			ips = append(ips, net.ParseIP(address))
		}
		return ips, nil
	}
}

func policyWithResolver(blockLocal bool, allowed []string, resolve endpointResolver) customerEndpointPolicy {
	policy := newCustomerEndpointPolicy(blockLocal, false, allowed)
	policy.resolve = resolve
	return policy
}

func TestValidateCustomerEndpointWhenLocalCallsAreBlocked(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name      string
		url       string
		addresses []string
		wantError bool
	}{
		{name: "public HTTPS DNS", url: "https://models.example.com/v1", addresses: []string{"8.8.8.8"}},
		{name: "public IPv6", url: "https://[2606:4700:4700::1111]/v1"},
		{name: "file URL", url: "file:///etc/passwd", wantError: true},
		{name: "gopher URL", url: "gopher://models.example.com", wantError: true},
		{name: "protocol-relative URL", url: "//models.example.com/v1", wantError: true},
		{name: "opaque HTTP URL", url: "http:models.example.com/v1", wantError: true},
		{name: "public plaintext", url: "http://models.example.com", addresses: []string{"8.8.8.8"}},
		{name: "URL credentials", url: "https://user:pass@models.example.com", addresses: []string{"8.8.8.8"}, wantError: true},
		{name: "loopback DNS", url: "https://models.example.com", addresses: []string{"127.0.0.1"}, wantError: true},
		{name: "mixed DNS answers fail closed", url: "https://models.example.com", addresses: []string{"8.8.8.8", "10.0.0.2"}, wantError: true},
		{name: "Kubernetes service", url: "https://api.default.svc.cluster.local", addresses: []string{"10.0.0.10"}, wantError: true},
		{name: "AWS metadata", url: "https://169.254.169.254/latest/meta-data", wantError: true},
		{name: "Azure metadata", url: "https://168.63.129.16/machine", wantError: true},
		{name: "private IPv4", url: "https://10.1.2.3/v1", wantError: true},
		{name: "carrier NAT", url: "https://100.64.0.1/v1", wantError: true},
		{name: "private IPv6", url: "https://[fd00::1]/v1", wantError: true},
		{name: "local-use NAT64", url: "https://[64:ff9b:1::a00:1]/v1", wantError: true},
		{name: "documentation range", url: "https://192.0.2.1/v1", wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validateCustomerEndpoint(
				t.Context(),
				test.url,
				policyWithResolver(true, nil, staticResolver(test.addresses...)),
			)
			if test.wantError {
				require.Error(t, err)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestValidateCustomerEndpointHonorsSelfHostedPolicyAndAllowlist(t *testing.T) {
	t.Parallel()

	err := validateCustomerEndpoint(
		t.Context(),
		"http://llm-server:8000/v1",
		policyWithResolver(false, nil, staticResolver("10.0.0.8")),
	)
	require.NoError(t, err)

	err = validateCustomerEndpoint(
		t.Context(),
		"http://internal.example.com:8000/v1",
		policyWithResolver(true, []string{"INTERNAL.EXAMPLE.COM"}, staticResolver("10.0.0.8")),
	)
	require.NoError(t, err)

	err = validateCustomerEndpoint(
		t.Context(),
		"http://169.254.169.254/latest/meta-data",
		newCustomerEndpointPolicy(false, false, []string{"169.254.169.254"}),
	)
	require.Error(t, err, "metadata must remain blocked even when allowlisted")

	err = validateCustomerEndpoint(
		t.Context(),
		"http://[fd00:ec2::254]/latest/meta-data",
		newCustomerEndpointPolicy(false, false, []string{"fd00:ec2::254"}),
	)
	require.Error(t, err, "IPv6 metadata must remain blocked even when allowlisted")
}

func TestValidateCustomerEndpointRejectsMetadataAliasesInPermissiveMode(t *testing.T) {
	t.Parallel()

	for _, address := range []string{"169.254.169.254", "168.63.129.16", "fd00:ec2::254"} {
		err := validateCustomerEndpoint(
			t.Context(),
			"http://customer-endpoint.example/v1",
			policyWithResolver(false, nil, staticResolver(address)),
		)
		require.Error(t, err, "metadata address %s must remain blocked behind a DNS alias", address)
	}
}

func TestValidateCustomerEndpointAlwaysBlocksUnspecifiedAndLinkLocalInPermissiveMode(t *testing.T) {
	t.Parallel()

	// Even with private egress opted in (blockLocal=false, no allowlist), these
	// stay refused: 0.0.0.0/:: collapse to localhost on many stacks, and
	// link-local is where undocumented instance-metadata surfaces appear.
	for _, address := range []string{"0.0.0.0", "::", "169.254.0.1", "fe80::1"} {
		err := validateCustomerEndpoint(
			t.Context(),
			"http://customer-endpoint.example/v1",
			policyWithResolver(false, nil, staticResolver(address)),
		)
		require.Error(t, err, "unspecified/link-local %s must remain blocked in permissive mode", address)
	}
}

func TestValidateCustomerEndpointHostedCloudCanRequireHTTPS(t *testing.T) {
	t.Parallel()

	policy := newCustomerEndpointPolicy(true, true, []string{"internal.example.com"})
	policy.resolve = staticResolver("10.0.0.8")
	err := validateCustomerEndpoint(t.Context(), "http://internal.example.com/v1", policy)
	require.ErrorContains(t, err, "must use https")

	err = validateCustomerEndpoint(t.Context(), "https://internal.example.com:8443/v1", policy)
	require.NoError(t, err)
}

func TestValidateCustomerEndpointPreservesResolutionFailures(t *testing.T) {
	t.Parallel()

	resolveErr := &net.DNSError{Err: "temporary failure", Name: "models.example.com", IsTemporary: true}
	err := validateCustomerEndpoint(
		t.Context(),
		"https://models.example.com/v1",
		policyWithResolver(true, nil, func(context.Context, string) ([]net.IP, error) {
			return nil, resolveErr
		}),
	)
	require.Error(t, err)
	assert.True(t, isRetryableEndpointResolutionError(err))
	assert.ErrorIs(t, err, resolveErr)
}

func TestValidateCredentialEndpointsCoversCustomOpenAIAndAzure(t *testing.T) {
	t.Parallel()
	policy := policyWithResolver(true, nil, staticResolver("10.0.0.8"))

	for _, cred := range []domain.Credential{
		{ProviderID: domain.ProviderCustom, Extra: map[string]string{"base_url": "https://models.example.com"}},
		{ProviderID: domain.ProviderOpenAI, Extra: map[string]string{"api_base": "https://models.example.com"}},
		{ProviderID: domain.ProviderAzure, Extra: map[string]string{"endpoint": "https://azure.example.com"}},
	} {
		err := validateCredentialEndpoints(t.Context(), cred, policy)
		require.Error(t, err)
	}
}

func TestDispatchBoundariesRejectPrivateCustomerEndpoints(t *testing.T) {
	t.Parallel()
	router := &BifrostRouter{
		endpointPolicy: policyWithResolver(true, nil, staticResolver("10.0.0.8")),
	}
	cred := domain.Credential{
		ProviderID: domain.ProviderCustom,
		Extra:      map[string]string{"base_url": "https://models.example.com"},
	}
	req := &domain.Request{Type: domain.RequestTypeChat, Model: "model"}

	_, err := router.Dispatch(t.Context(), req, cred)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBadRequest))

	_, err = router.DispatchStream(t.Context(), req, cred)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBadRequest))
}
