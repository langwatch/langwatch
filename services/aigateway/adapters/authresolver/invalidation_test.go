package authresolver

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// changeMidFetch returns a resolver whose ResolveKey applies ch to svc while
// the call is in flight, then answers with bundle.
func changeMidFetch(bundle *domain.Bundle) (*gatedResolver, func(svc *Service, ch CacheChange)) {
	r := &gatedResolver{release: make(chan struct{})}
	close(r.release)
	r.returns = []resolverReturn{{bundle: bundle}, {bundle: bundle}}
	arm := func(svc *Service, ch CacheChange) {
		fired := false
		r.during = func() {
			if !fired {
				fired = true
				svc.applyChange("org_1", ch)
			}
		}
	}
	return r, arm
}

// @scenario "a revocation during a cold fetch keeps the key out of the cache"
func TestInvalidation_RevocationMidColdFetchIsNotCached(t *testing.T) {
	r, arm := changeMidFetch(orgBundle("vk_rev", time.Now().Add(10*time.Minute)))
	svc, _ := newService(t, Options{Resolver: r, ConfigFetcher: r})
	key := domain.PresentedKey{Token: "vk-lw-rev"}
	arm(svc, CacheChange{Kind: ChangeKindVirtualKeyRevoked, VirtualKeyID: "vk_rev"})

	_, _ = svc.Resolve(context.Background(), key)

	_, ok := svc.l1.Peek(hashKey(key))
	assert.False(t, ok, "a fetch that began before the revocation does not publish its answer")
}

// @scenario "a config change during a fetch is not hidden by the earlier answer"
func TestInvalidation_ConfigChangeMidColdFetchIsNotCached(t *testing.T) {
	r, arm := changeMidFetch(orgBundle("vk_cfg", time.Now().Add(10*time.Minute)))
	svc, _ := newService(t, Options{Resolver: r, ConfigFetcher: r})
	key := domain.PresentedKey{Token: "vk-lw-cfg"}
	arm(svc, CacheChange{Kind: ChangeKindVirtualKeyConfigUpdate, VirtualKeyID: "vk_cfg"})

	_, err := svc.Resolve(context.Background(), key)
	require.NoError(t, err, "the request that raced the change is still answered")
	require.Zero(t, svc.denied.Len(), "a config change adds no denial")
	_, ok := svc.l1.Peek(hashKey(key))
	assert.False(t, ok, "the result read before the config change is not cached")

	_, err = svc.Resolve(context.Background(), key)
	require.NoError(t, err)
	assert.Equal(t, int64(2), r.calls.Load(), "the next request fetches the changed config")
	_, ok = svc.l1.Peek(hashKey(key))
	assert.True(t, ok, "a fetch that began after the change is cached")
}

// @scenario "a config change during a fetch is not hidden by the earlier answer"
func TestInvalidation_ConfigChangeMidStaleRefreshIsNotCached(t *testing.T) {
	r, arm := changeMidFetch(orgBundle("vk_stale", time.Now().Add(10*time.Minute)))
	svc, _ := newService(t, Options{Resolver: r, ConfigFetcher: r})
	key := domain.PresentedKey{Token: "vk-lw-stale"}
	h := hashKey(key)
	stale := orgBundle("vk_stale", time.Now().Add(10*time.Minute))
	stale.ExpiresAt = time.Now().Add(-30 * time.Second)
	svc.storeL1(h, stale, "")
	arm(svc, CacheChange{Kind: ChangeKindVirtualKeyConfigUpdate, VirtualKeyID: "vk_stale"})

	_, err := svc.Resolve(context.Background(), key)
	require.NoError(t, err)

	_, ok := svc.l1.Peek(h)
	assert.False(t, ok, "a stale refresh that raced the config change does not publish")
}

// @scenario "a change to another key does not stop a fetch from caching"
func TestInvalidation_UnrelatedChangeMidFetchStillCaches(t *testing.T) {
	r, arm := changeMidFetch(orgBundle("vk_keep", time.Now().Add(10*time.Minute)))
	svc, _ := newService(t, Options{Resolver: r, ConfigFetcher: r})
	key := domain.PresentedKey{Token: "vk-lw-keep"}
	arm(svc, CacheChange{Kind: ChangeKindVirtualKeyRevoked, VirtualKeyID: "vk_other"})

	_, err := svc.Resolve(context.Background(), key)
	require.NoError(t, err)

	_, ok := svc.l1.Peek(hashKey(key))
	assert.True(t, ok, "a change to another key leaves this fetch's answer cached")
}

// @scenario "a budget debit during a fetch caches the answer marked for refresh"
func TestInvalidation_BudgetDebitMidFetchCachesMarkedBehind(t *testing.T) {
	r, arm := changeMidFetch(orgBundle("vk_budget", time.Now().Add(10*time.Minute)))
	svc, _ := newService(t, Options{Resolver: r, ConfigFetcher: r})
	key := domain.PresentedKey{Token: "vk-lw-budget"}
	arm(svc, CacheChange{Kind: ChangeKindBudgetUpdated})

	_, err := svc.Resolve(context.Background(), key)
	require.NoError(t, err)

	e, ok := svc.l1.Peek(hashKey(key))
	require.True(t, ok, "a debit does not stop the publish")
	assert.Equal(t, uint64(1), e.budgetChangeCount(), "the entry is marked behind the debit it may have missed")
}

func TestInvalidation_TrimmedLogRefusesOldFetch(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &fakeResolver{}, ConfigFetcher: &fakeResolver{}})
	since := svc.fetchGeneration()
	for range invalidationLogSize + 1 {
		svc.evictWhere(func(*domain.Bundle) bool { return false }, evictScope{reason: "test"})
	}
	h := hashKey(domain.PresentedKey{Token: "vk-lw-old"})

	published := svc.publishFetched(h, svc.newEntry(orgBundle("vk_old", time.Now().Add(10*time.Minute)), ""), since)

	assert.False(t, published, "a fetch older than every kept event cannot be checked, so it is not cached")
}
