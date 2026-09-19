package authresolver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

var licenseToken = domain.LicenseTokenPrefix + strings.Repeat("a", 64)

// registryResolver stands in for the control plane's license registry: it
// knows which installs a token is good for and records every question it is
// asked.
type registryResolver struct {
	mu     sync.Mutex
	asked  []domain.PresentedKey
	answer func(domain.PresentedKey) (*domain.Bundle, error)
}

func (r *registryResolver) ResolveKey(_ context.Context, key domain.PresentedKey) (*domain.Bundle, error) {
	r.mu.Lock()
	r.asked = append(r.asked, key)
	r.mu.Unlock()
	return r.answer(key)
}

func (r *registryResolver) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	return domain.ConfigFetchResult{}, nil
}

func (r *registryResolver) timesAsked() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.asked)
}

// boundTo answers like a registry whose license is bound to one install.
func boundTo(instanceID string) func(domain.PresentedKey) (*domain.Bundle, error) {
	return func(key domain.PresentedKey) (*domain.Bundle, error) {
		if key.InstanceID != instanceID {
			return nil, herr.New(context.Background(), domain.ErrConnectWrongInstance, nil)
		}
		return &domain.Bundle{
			VirtualKeyID:   "vk_connect",
			OrganizationID: "org_acme",
			ExpiresAt:      time.Now().Add(15 * time.Minute),
		}, nil
	}
}

func refusing(code herr.Code) func(domain.PresentedKey) (*domain.Bundle, error) {
	return func(domain.PresentedKey) (*domain.Bundle, error) {
		return nil, herr.New(context.Background(), code, nil)
	}
}

// @scenario "A malformed license token is refused before any lookup"
func TestResolve_LicenseToken_Malformed_RefusedWithoutLookup(t *testing.T) {
	malformed := []string{
		domain.LicenseTokenPrefix,
		domain.LicenseTokenPrefix + "not-a-hash",
		domain.LicenseTokenPrefix + strings.Repeat("a", 63),
		domain.LicenseTokenPrefix + strings.Repeat("a", 65),
		domain.LicenseTokenPrefix + strings.Repeat("A", 64),
		domain.LicenseTokenPrefix + strings.Repeat("g", 64),
	}
	for _, token := range malformed {
		resolver := &registryResolver{answer: boundTo("instance-a")}
		svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})

		_, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: token, InstanceID: "instance-a"})

		require.ErrorIs(t, err, domain.ErrInvalidAPIKey, token)
		assert.Zero(t, resolver.timesAsked(), "the registry was asked about %q", token)
	}
}

// @scenario "A license token with no instance id is refused"
func TestResolve_LicenseToken_NoInstance_RefusedWithoutLookup(t *testing.T) {
	for _, instanceID := range []string{"", strings.Repeat("x", 129)} {
		resolver := &registryResolver{answer: boundTo("instance-a")}
		svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})

		_, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: licenseToken, InstanceID: instanceID})

		require.ErrorIs(t, err, domain.ErrConnectInstanceRequired)
		assert.Zero(t, resolver.timesAsked())
	}
}

// @scenario "A cached credential is never served to another instance"
func TestResolve_LicenseToken_CachedForOneInstance_IsNotServedToAnother(t *testing.T) {
	resolver := &registryResolver{answer: boundTo("instance-a")}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	ctx := context.Background()

	bundle, err := svc.Resolve(ctx, domain.PresentedKey{Token: licenseToken, InstanceID: "instance-a"})
	require.NoError(t, err)
	require.Equal(t, "vk_connect", bundle.VirtualKeyID)
	_, err = svc.Resolve(ctx, domain.PresentedKey{Token: licenseToken, InstanceID: "instance-a"})
	require.NoError(t, err)
	require.Equal(t, 1, resolver.timesAsked(), "the second call from the bound install is a cache hit")

	_, err = svc.Resolve(ctx, domain.PresentedKey{Token: licenseToken, InstanceID: "instance-b"})

	require.ErrorIs(t, err, domain.ErrConnectWrongInstance)
	require.Equal(t, 2, resolver.timesAsked(), "the other install was checked against the registry")
	assert.Equal(t, "instance-b", resolver.asked[1].InstanceID)
}

// @scenario "Repeated unknown license tokens do not reach the registry every time"
func TestResolve_LicenseToken_RepeatedRefusal_AnsweredFromMemory(t *testing.T) {
	resolver := &registryResolver{answer: refusing(domain.ErrConnectLicenseNotRegistered)}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	key := domain.PresentedKey{Token: licenseToken, InstanceID: "instance-a"}

	for range 25 {
		_, err := svc.Resolve(context.Background(), key)
		require.ErrorIs(t, err, domain.ErrConnectLicenseNotRegistered)
	}

	assert.Equal(t, 1, resolver.timesAsked())
}

func TestResolve_LicenseToken_RefusalLapses_RegistryIsAskedAgain(t *testing.T) {
	resolver := &registryResolver{answer: refusing(domain.ErrConnectLicenseNotRegistered)}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver, LicenseRefusalTTL: 20 * time.Millisecond})
	key := domain.PresentedKey{Token: licenseToken, InstanceID: "instance-a"}

	_, err := svc.Resolve(context.Background(), key)
	require.ErrorIs(t, err, domain.ErrConnectLicenseNotRegistered)
	time.Sleep(40 * time.Millisecond)
	resolver.answer = boundTo("instance-a")

	bundle, err := svc.Resolve(context.Background(), key)

	require.NoError(t, err, "a license linked after a refusal works once the refusal lapses")
	assert.Equal(t, "vk_connect", bundle.VirtualKeyID)
}

func TestResolve_LicenseToken_TransportFailure_IsNotRemembered(t *testing.T) {
	resolver := &registryResolver{answer: func(domain.PresentedKey) (*domain.Bundle, error) {
		return nil, herr.New(context.Background(), domain.ErrAuthUpstream, nil, errors.New("connection refused"))
	}}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	key := domain.PresentedKey{Token: licenseToken, InstanceID: "instance-a"}

	_, err := svc.Resolve(context.Background(), key)
	require.ErrorIs(t, err, domain.ErrAuthUpstream)
	resolver.answer = boundTo("instance-a")

	_, err = svc.Resolve(context.Background(), key)

	require.NoError(t, err, "an unreachable control plane refused nothing")
}

func TestResolve_VirtualKey_Refused_IsNeverRemembered(t *testing.T) {
	resolver := &registryResolver{answer: refusing(domain.ErrInvalidAPIKey)}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})

	for range 3 {
		_, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: "vk-lw-unknown"})
		require.ErrorIs(t, err, domain.ErrInvalidAPIKey)
	}

	assert.Equal(t, 3, resolver.timesAsked(), "virtual keys are resolved exactly as before")
	assert.Zero(t, svc.licenseRefusals.Len())
}

func TestHashKey_VirtualKey_IsTheTokenHashAlone(t *testing.T) {
	token := "vk-lw-" + strings.Repeat("A", 26)
	sum := sha256.Sum256([]byte(token))
	got := hashKey(domain.PresentedKey{Token: token})
	assert.Equal(t, hex.EncodeToString(sum[:]), string(got[:]))

	assert.NotEqual(t,
		hashKey(domain.PresentedKey{Token: licenseToken, InstanceID: "instance-a"}),
		hashKey(domain.PresentedKey{Token: licenseToken, InstanceID: "instance-b"}),
	)
}

// @scenario "A gateway that cached a revoked license refuses it on the next change poll"
func TestResolve_LicenseToken_RevokedAfterCaching_RefusedAfterTheChangeIsApplied(t *testing.T) {
	resolver := &registryResolver{answer: boundTo("instance-a")}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	key := domain.PresentedKey{Token: licenseToken, InstanceID: "instance-a"}
	ctx := context.Background()

	_, err := svc.Resolve(ctx, key)
	require.NoError(t, err)

	// Revoking the license ends its managed key, which reaches the gateway as
	// the same change a revoked virtual key does.
	resolver.answer = refusing(domain.ErrConnectLicenseRevoked)
	svc.applyChange("org_acme", CacheChange{Kind: ChangeKindVirtualKeyRevoked, VirtualKeyID: "vk_connect"})

	_, err = svc.Resolve(ctx, key)

	require.ErrorIs(t, err, domain.ErrConnectLicenseRevoked)
}

func TestResolve_LicenseToken_StaleEntry_RefusalEvictsInsteadOfServingStale(t *testing.T) {
	resolver := &registryResolver{answer: refusing(domain.ErrConnectLicenseRevoked)}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	key := domain.PresentedKey{Token: licenseToken, InstanceID: "instance-a"}
	svc.storeL1(hashKey(key), freshBundle("vk_connect", time.Now().Add(-time.Minute)), "")

	_, err := svc.Resolve(context.Background(), key)

	require.ErrorIs(t, err, domain.ErrConnectLicenseRevoked)
	_, cached := svc.l1.Get(hashKey(key))
	assert.False(t, cached, "a revoked license must not ride the stale window")
}
