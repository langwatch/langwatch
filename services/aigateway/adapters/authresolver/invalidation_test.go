package authresolver

import (
	"context"
	"fmt"
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
	seedL1(svc, h, stale, "")
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

// @scenario "a burst of budget debits does not stop the cache from filling"
func TestInvalidation_BudgetDebitBurstStillPublishes(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &fakeResolver{}, ConfigFetcher: &fakeResolver{}, LRUSize: 16})
	since := svc.fetchGeneration()
	for i := range 5000 {
		svc.applyChange("org_1", CacheChange{Kind: ChangeKindBudgetUpdated, ProjectID: fmt.Sprintf("proj_%d", i)})
	}
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindBudgetUpdated})

	h := hashKey(domain.PresentedKey{Token: "vk-lw-burst"})
	require.True(t, svc.publishFetched(h, svc.newEntry(orgBundle("vk_burst", time.Now().Add(10*time.Minute)), "", time.Now()), since),
		"budget debits only mark a publish behind, however many land")
	e, _ := svc.l1.Peek(h)
	assert.Equal(t, uint64(1), e.budgetChangeCount(), "the publish that raced the debits is marked behind")

	h2 := hashKey(domain.PresentedKey{Token: "vk-lw-after"})
	require.True(t, svc.publishFetched(h2, svc.newEntry(orgBundle("vk_after", time.Now().Add(10*time.Minute)), "", time.Now()), svc.fetchGeneration()))
	e2, _ := svc.l1.Peek(h2)
	assert.Zero(t, e2.budgetChangeCount(), "a fetch that began after the burst publishes caught up")
}

// @scenario "a key change during a fetch blocks only that key's publish"
func TestInvalidation_KeyChangeBlocksOnlyThatKey(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &fakeResolver{}, ConfigFetcher: &fakeResolver{}})
	since := svc.fetchGeneration()
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyConfigUpdate, VirtualKeyID: "vk_a"})

	ha, hb := hashKey(domain.PresentedKey{Token: "vk-lw-a"}), hashKey(domain.PresentedKey{Token: "vk-lw-b"})
	assert.False(t, svc.publishFetched(ha, svc.newEntry(orgBundle("vk_a", time.Now().Add(10*time.Minute)), "", time.Now()), since),
		"the changed key's earlier answer is not cached")
	assert.True(t, svc.publishFetched(hb, svc.newEntry(orgBundle("vk_b", time.Now().Add(10*time.Minute)), "", time.Now()), since),
		"another key fetched over the same window is cached")
}

// @scenario "a change the in-flight guard cannot track reaches every fetch in flight"
func TestInvalidation_EvictAllAndOverflowBumpTheEpoch(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &fakeResolver{}, ConfigFetcher: &fakeResolver{}, LRUSize: 2})
	bundle := func() *entry { return svc.newEntry(orgBundle("vk_x", time.Now().Add(10*time.Minute)), "", time.Now()) }
	h := hashKey(domain.PresentedKey{Token: "vk-lw-x"})

	since := svc.fetchGeneration()
	svc.evictWhere(func(*domain.Bundle) bool { return true }, evictScope{reason: "test"})
	assert.False(t, svc.publishFetched(h, bundle(), since), "an evict-all event reaches every fetch in flight")

	since = svc.fetchGeneration()
	for _, id := range []string{"vk_1", "vk_2", "vk_3"} {
		svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyConfigUpdate, VirtualKeyID: id})
	}
	assert.False(t, svc.publishFetched(h, bundle(), since), "an identity pushed out of the guard counts as reaching every bundle")
	assert.True(t, svc.publishFetched(h, bundle(), svc.fetchGeneration()), "a fetch after the overflow publishes")
}

// @scenario "a cache refresh keeps the pace of fail closed re-checks"
func TestInvalidation_ReplacementKeepsTheReconfirmClaim(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &fakeResolver{}})
	h := hashKey(domain.PresentedKey{Token: "vk-lw-paced"})
	bundle := func() *entry {
		return svc.newEntry(orgBundle("vk_paced", time.Now().Add(10*time.Minute)), "", time.Now())
	}
	require.True(t, svc.publishFetched(h, bundle(), svc.fetchGeneration()))
	require.True(t, svc.claimReconfirm(h))

	require.True(t, svc.publishFetched(h, bundle(), svc.fetchGeneration()))
	assert.False(t, svc.claimReconfirm(h), "a replaced entry inside the interval must not start a second re-check")
}
