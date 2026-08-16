// Tests for the bound a key's own expiration date puts on the auth cache.
// Spec: specs/ai-gateway/auth-cache.feature, Rule "A key's own expiration date
// bounds the cache, and grace never crosses it".
package authresolver

import (
	"context"
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
