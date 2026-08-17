// Tests for the bound a key's own expiration date puts on the auth cache, and
// for how a changed date reaches it.
// Spec: specs/ai-gateway/auth-cache.feature, Rules "A key's own expiration date
// bounds the cache, and grace never crosses it" and "A changed expiration date
// reaches the gateway on the config channel".
package authresolver

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func expiringBundle(vkID string, jwtExp, keyExpiry time.Time) *domain.Bundle {
	return &domain.Bundle{
		VirtualKeyID:        vkID,
		ExpiresAt:           jwtExp,
		VirtualKeyExpiresAt: keyExpiry,
	}
}

func deadlines(t *testing.T, svc *Service, rawKey string) (soft, hard time.Time) {
	t.Helper()
	e, ok := svc.l1.Get(hashKey(rawKey))
	require.True(t, ok, "the entry should be cached")
	_, soft, hard = e.snapshot()
	return soft, hard
}

// @scenario "the hard cap never outlives the key's expiration date"
func TestStoreL1_KeyExpiryCapsBothDeadlines(t *testing.T) {
	resolver := &fakeResolver{}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	keyExpiry := time.Now().Add(5 * time.Minute)

	t.Run("when the token already ends at the key's expiration date", func(t *testing.T) {
		rawKey := "vk-lw-capped-clamped"
		svc.storeL1(hashKey(rawKey), expiringBundle("vk_clamped", keyExpiry, keyExpiry), "")

		soft, hard := deadlines(t, svc, rawKey)
		assert.True(t, soft.Equal(keyExpiry), "soft expiry tracks the token, which ends with the key")
		assert.True(t, hard.Equal(keyExpiry),
			"the grace window must not be added on top of the key's expiration date")
	})

	t.Run("when the token outlives the key", func(t *testing.T) {
		rawKey := "vk-lw-capped-longer-token"
		svc.storeL1(hashKey(rawKey), expiringBundle("vk_longer", time.Now().Add(15*time.Minute), keyExpiry), "")

		soft, hard := deadlines(t, svc, rawKey)
		assert.True(t, soft.Equal(keyExpiry), "no deadline may sit past the key's expiration date")
		assert.True(t, hard.Equal(keyExpiry), "no deadline may sit past the key's expiration date")
	})

	t.Run("when the key has no expiration date", func(t *testing.T) {
		rawKey := "vk-lw-never-expires"
		jwtExp := time.Now().Add(15 * time.Minute)
		svc.storeL1(hashKey(rawKey), freshBundle("vk_never", jwtExp), "")

		soft, hard := deadlines(t, svc, rawKey)
		assert.True(t, soft.Equal(jwtExp), "a key with no date keeps the deadlines it always had")
		assert.True(t, hard.Equal(jwtExp.Add(svc.hardGrace)),
			"a key with no date keeps the full grace window")
	})
}

// @scenario "an outage across the expiration date fails closed"
func TestResolve_OutageAcrossKeyExpiry_FailsClosedWithTheKeysOwnError(t *testing.T) {
	resolver := &fakeResolver{returns: []resolverReturn{
		{err: herr.New(context.Background(), domain.ErrAuthUpstream, nil)},
	}}
	svc, logs := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	rawKey := "vk-lw-outage-across-expiry"
	// The key ran out a minute ago, and its token with it. Without the cap
	// this entry is stale rather than dead, so the grace window would serve it.
	ranOut := time.Now().Add(-1 * time.Minute)
	svc.storeL1(hashKey(rawKey), expiringBundle("vk_ran_out", ranOut, ranOut), "")

	bundle, err := svc.Resolve(context.Background(), rawKey)

	assert.Nil(t, bundle, "an expired key must never be served from cache")
	require.Error(t, err)
	require.ErrorIs(t, err, domain.ErrKeyExpired,
		"the customer needs the key's own answer, not a retryable upstream failure")
	assert.Equal(t, int64(0), resolver.calls.Load(),
		"the date came with the token, so the answer needs no control-plane round trip")
	_, cached := svc.l1.Get(hashKey(rawKey))
	assert.False(t, cached, "the entry must be evicted")

	var evicted bool
	for _, line := range logs.All() {
		if line.Message == "auth_cache_hard_evict" {
			evicted = true
		}
	}
	assert.True(t, evicted, "the eviction must be reported")
}

// @scenario "an outage before the expiration date still serves stale"
func TestResolve_OutageBeforeKeyExpiry_StillServesStale(t *testing.T) {
	resolver := &fakeResolver{returns: []resolverReturn{
		{err: herr.New(context.Background(), domain.ErrAuthUpstream, nil)},
	}}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	rawKey := "vk-lw-outage-before-expiry"
	svc.storeL1(hashKey(rawKey), expiringBundle(
		"vk_still_good",
		time.Now().Add(-30*time.Second),
		time.Now().Add(1*time.Hour),
	), "")
	beforeSoft, _ := deadlines(t, svc, rawKey)

	bundle, err := svc.Resolve(context.Background(), rawKey)

	require.NoError(t, err, "a key that has not run out keeps its grace window")
	require.NotNil(t, bundle)
	assert.Equal(t, "vk_still_good", bundle.VirtualKeyID)
	afterSoft, _ := deadlines(t, svc, rawKey)
	assert.True(t, afterSoft.After(beforeSoft), "the soft expiry is bumped, transport-failure style")
}

// --- the date on the config channel ------------------------------------------

// expiryConfigFetcher answers a config fetch with a programmable expiry
// tri-state, the way the control plane's config endpoint does: a date, no date,
// or nothing about expiry at all.
type expiryConfigFetcher struct {
	fakeResolver
	mu      sync.Mutex
	expiry  time.Time
	known   bool
	fetches atomic.Int64
}

func (f *expiryConfigFetcher) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	f.fetches.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	return domain.ConfigFetchResult{
		Config:                domain.BundleConfig{Credentials: []domain.Credential{{ID: "cred-current"}}},
		ETag:                  "43",
		VirtualKeyExpiresAt:   f.expiry,
		VirtualKeyExpiryKnown: f.known,
	}, nil
}

// newExpiryService wires a service around an expiryConfigFetcher with the change
// feed left unwired, which is the failure the config channel has to cover on its
// own, and seeds one cached entry whose config is already past its TTL.
//
// RefreshThreshold is held down so the near-soft-expiry auth refresh stays out
// of the way: that path re-resolves the key and would bring the date back on the
// token, which is the channel these cases are not about.
func newExpiryService(t *testing.T, fetcher *expiryConfigFetcher, rawKey string, bundle *domain.Bundle) (*Service, *entry) {
	t.Helper()
	svc, _ := newService(t, Options{
		Resolver:         &fetcher.fakeResolver,
		ConfigFetcher:    fetcher,
		ConfigTTL:        60 * time.Second,
		RefreshThreshold: time.Millisecond,
	})
	svc.storeL1(hashKey(rawKey), bundle, "42")
	return svc, backdateConfig(t, svc, rawKey, 2*time.Minute)
}

// @scenario "a shortened date is followed while the change feed is unavailable"
func TestResolve_ConfigRefreshShortensKeyExpiry_FailsClosed(t *testing.T) {
	fetcher := &expiryConfigFetcher{expiry: time.Now().Add(-1 * time.Minute), known: true}
	rawKey := "vk-lw-cfg-shortened"
	// The key the gateway holds has no date at all, so nothing but the config
	// refresh can tell it the key now ends.
	svc, e := newExpiryService(t, fetcher, rawKey, freshBundle("vk_shortened", time.Now().Add(1*time.Hour)))

	_, err := svc.Resolve(context.Background(), rawKey)
	require.NoError(t, err, "the triggering request still serves; it is what kicks the refresh")
	awaitConfigRefresh(t, e)

	bundle, err := svc.Resolve(context.Background(), rawKey)

	assert.Nil(t, bundle, "a key the control plane says has run out must not be served")
	require.ErrorIs(t, err, domain.ErrKeyExpired,
		"the shortened date is the key's own answer, not a retryable upstream failure")
	assert.Equal(t, int64(0), fetcher.calls.Load(),
		"the config channel carried the date, so no auth round trip is needed to act on it")
	_, cached := svc.l1.Get(hashKey(rawKey))
	assert.False(t, cached, "the entry must be evicted")
}

// @scenario "an extended date is followed the same way"
func TestResolve_ConfigRefreshExtendsKeyExpiry_ServesPastTheOldDate(t *testing.T) {
	oldBoundary := time.Now().Add(250 * time.Millisecond)
	fetcher := &expiryConfigFetcher{expiry: time.Now().Add(1 * time.Hour), known: true}
	rawKey := "vk-lw-cfg-extended"
	svc, e := newExpiryService(t, fetcher, rawKey,
		expiringBundle("vk_extended", time.Now().Add(1*time.Hour), oldBoundary))

	_, err := svc.Resolve(context.Background(), rawKey)
	require.NoError(t, err)
	awaitConfigRefresh(t, e)

	soft, hard := deadlines(t, svc, rawKey)
	assert.True(t, soft.After(oldBoundary), "the soft expiry must move with the date")
	assert.True(t, hard.After(oldBoundary), "and so must the hard cap")

	time.Sleep(time.Until(oldBoundary) + 20*time.Millisecond)
	bundle, err := svc.Resolve(context.Background(), rawKey)

	require.NoError(t, err, "a date the control plane has already moved must not refuse a request")
	require.NotNil(t, bundle)
	assert.Equal(t, "vk_extended", bundle.VirtualKeyID)
	assert.Equal(t, int64(0), fetcher.calls.Load(),
		"the extension landed before the boundary, so the request serves from cache")
}

// @scenario "a config response with no expiration field keeps the date the gateway holds"
func TestResolve_ConfigRefreshWithoutExpiryField_KeepsTheCachedDate(t *testing.T) {
	keyExpiry := time.Now().Add(5 * time.Minute)
	// An older control plane says nothing about expiry. Reading that as "no
	// date" would lift the cap off a key whose own token says it expires.
	fetcher := &expiryConfigFetcher{known: false}
	rawKey := "vk-lw-cfg-no-expiry-field"
	svc, e := newExpiryService(t, fetcher, rawKey,
		expiringBundle("vk_skew", time.Now().Add(1*time.Hour), keyExpiry))

	_, err := svc.Resolve(context.Background(), rawKey)
	require.NoError(t, err)
	awaitConfigRefresh(t, e)

	live, ok := svc.l1.Peek(hashKey(rawKey))
	require.True(t, ok)
	assert.Equal(t, "cred-current", live.bundle.Credentials[0].ID,
		"the config itself still lands; only the date is left alone")
	assert.True(t, live.bundle.VirtualKeyExpiresAt.Equal(keyExpiry),
		"the date the token carried stands")
	_, hard := deadlines(t, svc, rawKey)
	assert.True(t, hard.Equal(keyExpiry), "and the hard cap stays on it")
}
