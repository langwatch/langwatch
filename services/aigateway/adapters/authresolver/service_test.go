// Tests for stale-while-error auth cache resilience.
// Spec: specs/ai-gateway/auth-cache.feature, Rule "Cached JWT serves
// stale-while-error past natural expiry on transport failure".
//
// Each scenario in the failure taxonomy maps to a test case here:
//   - AuthRejection (ErrInvalidAPIKey, ErrKeyRevoked) -> evict + reject
//   - TransportFailure (everything else, incl. ErrAuthUpstream, raw
//     network errors, JWT verify failures) -> serve stale + bump soft
//   - HardCapExceeded -> evict + reject
package authresolver

import (
	"context"
	"errors"
	"fmt"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// fakeResolver is a programmable upstream resolver/configfetcher pair.
// Each Resolve call returns the next item from the returns slice; if
// the slice is exhausted it returns the last item indefinitely.
type fakeResolver struct {
	mu      sync.Mutex
	calls   atomic.Int64
	returns []resolverReturn
}

type resolverReturn struct {
	bundle *domain.Bundle
	err    error
}

func (f *fakeResolver) ResolveKey(_ context.Context, _ string) (*domain.Bundle, error) {
	f.calls.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.returns) == 0 {
		return nil, errors.New("fakeResolver: no returns programmed")
	}
	r := f.returns[0]
	if len(f.returns) > 1 {
		f.returns = f.returns[1:]
	}
	return r.bundle, r.err
}

func (f *fakeResolver) FetchConfig(_ context.Context, _ string) (domain.BundleConfig, error) {
	return domain.BundleConfig{}, nil
}

// fakeL2 is an in-memory stand-in for the shared cache tier every gateway
// node reads, so a test can prove an invalidation reaches further than the
// node that saw the event. delErr makes the store unreachable; failNthBatch
// fails one batch (1-based) and lets the others through, which is how a
// partial outage looks. batches records what each DeleteMany was handed.
type fakeL2 struct {
	mu           sync.Mutex
	entries      map[string]CachedBundle
	delErr       error
	failNthBatch int
	batches      [][]string
}

func newFakeL2() *fakeL2 {
	return &fakeL2{entries: make(map[string]CachedBundle)}
}

func (f *fakeL2) Get(_ context.Context, hash string) (*CachedBundle, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	cached, ok := f.entries[hash]
	if !ok {
		return nil, nil
	}
	return &cached, nil
}

func (f *fakeL2) Set(_ context.Context, hash string, cached CachedBundle) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.entries[hash] = cached
}

func (f *fakeL2) DeleteMany(_ context.Context, hashes []string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.batches = append(f.batches, append([]string(nil), hashes...))
	if f.delErr != nil {
		return f.delErr
	}
	if f.failNthBatch == len(f.batches) {
		return errors.New("shared cache dropped this batch")
	}
	for _, hash := range hashes {
		delete(f.entries, hash)
	}
	return nil
}

func (f *fakeL2) has(hash string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.entries[hash]
	return ok
}

func (f *fakeL2) len() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.entries)
}

func (f *fakeL2) batchSizes() []int {
	f.mu.Lock()
	defer f.mu.Unlock()
	sizes := make([]int, 0, len(f.batches))
	for _, batch := range f.batches {
		sizes = append(sizes, len(batch))
	}
	return sizes
}

// l2Key is the shared-tier key for a raw virtual key, the one Resolve computes.
func l2Key(rawKey string) string {
	h := hashKey(rawKey)
	return string(h[:])
}

// seedBothTiers primes L1 and the shared tier with the same bundle, the state
// a node is in after it has served a request for that key.
func seedBothTiers(svc *Service, l2 *fakeL2, rawKey string, bundle *domain.Bundle) {
	svc.storeL1(hashKey(rawKey), bundle)
	l2.Set(context.Background(), l2Key(rawKey), CachedBundle{
		Bundle:          bundle,
		ConfigFetchedAt: time.Now(),
	})
}

func newService(t *testing.T, opts Options) (*Service, *observer.ObservedLogs) {
	t.Helper()
	core, logs := observer.New(zap.WarnLevel)
	if opts.Logger == nil {
		opts.Logger = zap.New(core)
	}
	if opts.SoftBump == 0 {
		opts.SoftBump = 5 * time.Minute
	}
	// Don't default HardGrace here — let New() apply its 30m default.
	svc, err := New(opts)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return svc, logs
}

func freshBundle(vkID string, exp time.Time) *domain.Bundle {
	return &domain.Bundle{VirtualKeyID: vkID, ExpiresAt: exp}
}

// seedExpiredEntry primes L1 with a vk whose JWT exp is `staleness` in the
// past (i.e. soft-expired). HardExpiresAt is set per the service's config.
func seedExpiredEntry(t *testing.T, svc *Service, rawKey, vkID string, staleness time.Duration) {
	t.Helper()
	originalExp := time.Now().Add(-staleness)
	svc.storeL1(hashKey(rawKey), freshBundle(vkID, originalExp))
}

// --- AuthRejection class -----------------------------------------------------

func TestResolve_StaleEntry_AuthRejection_401_EvictsAndRejects(t *testing.T) {
	resolver := &fakeResolver{returns: []resolverReturn{
		{err: herr.New(context.Background(), domain.ErrInvalidAPIKey, nil)},
	}}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	rawKey := "vk-lw-test_001"
	seedExpiredEntry(t, svc, rawKey, "vk_001", 30*time.Second)

	_, err := svc.Resolve(context.Background(), rawKey)
	if err == nil {
		t.Fatal("expected error from auth-rejection path")
	}
	if !errors.Is(err, domain.ErrInvalidAPIKey) {
		t.Fatalf("expected ErrInvalidAPIKey, got %v", err)
	}
	if _, ok := svc.l1.Get(hashKey(rawKey)); ok {
		t.Fatal("entry should have been evicted")
	}
}

func TestResolve_StaleEntry_AuthRejection_403Revoked_EvictsAndRejects(t *testing.T) {
	resolver := &fakeResolver{returns: []resolverReturn{
		{err: herr.New(context.Background(), domain.ErrKeyRevoked, nil)},
	}}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	rawKey := "vk-lw-test_002"
	seedExpiredEntry(t, svc, rawKey, "vk_002", 30*time.Second)

	_, err := svc.Resolve(context.Background(), rawKey)
	if !errors.Is(err, domain.ErrKeyRevoked) {
		t.Fatalf("expected ErrKeyRevoked, got %v", err)
	}
	if _, ok := svc.l1.Get(hashKey(rawKey)); ok {
		t.Fatal("entry should have been evicted on revoked")
	}
}

// --- TransportFailure class --------------------------------------------------

func TestResolve_StaleEntry_TransportFailure_ServesStaleAndBumpsSoft(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{"ErrAuthUpstream", herr.New(context.Background(), domain.ErrAuthUpstream, nil)},
		{"raw net.OpError (connection refused)", &net.OpError{Op: "dial", Err: errors.New("connection refused")}},
		{"context.DeadlineExceeded", context.DeadlineExceeded},
		{"unknown error type", errors.New("unparseable JWT response body")},
		{"wrapped 5xx via herr ErrAuthUpstream", herr.New(context.Background(), domain.ErrAuthUpstream, nil, errors.New("control plane returned 503"))},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resolver := &fakeResolver{returns: []resolverReturn{{err: tc.err}}}
			svc, logs := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
			rawKey := "vk-lw-" + tc.name
			vkID := "vk_" + tc.name
			seedExpiredEntry(t, svc, rawKey, vkID, 30*time.Second)

			beforeSoft := func() time.Time {
				e, _ := svc.l1.Get(hashKey(rawKey))
				_, soft, _ := e.snapshot()
				return soft
			}()

			bundle, err := svc.Resolve(context.Background(), rawKey)
			if err != nil {
				t.Fatalf("expected stale-serve, got error: %v", err)
			}
			if bundle == nil || bundle.VirtualKeyID != vkID {
				t.Fatalf("expected stale bundle for %s, got %+v", vkID, bundle)
			}

			e, ok := svc.l1.Get(hashKey(rawKey))
			if !ok {
				t.Fatal("entry should still be present after transport-class failure")
			}
			_, newSoft, _ := e.snapshot()
			if !newSoft.After(beforeSoft) {
				t.Fatalf("expected soft expiry to advance, was %v -> %v", beforeSoft, newSoft)
			}
			if d := time.Until(newSoft); d < 4*time.Minute || d > 6*time.Minute {
				t.Fatalf("expected new soft expiry ~5m from now, got %v", d)
			}

			// Verify the warn log line fired with the right name.
			found := false
			for _, entry := range logs.All() {
				if entry.Message == "auth_cache_refresh_transport_failure" {
					found = true
					break
				}
			}
			if !found {
				t.Fatalf("expected auth_cache_refresh_transport_failure log, got %d entries", logs.Len())
			}
		})
	}
}

// --- Hard cap stops the chain ------------------------------------------------

func TestResolve_StaleEntry_HardCapExceeded_EvictsAndRejects(t *testing.T) {
	transportErr := herr.New(context.Background(), domain.ErrAuthUpstream, nil)
	resolver := &fakeResolver{returns: []resolverReturn{{err: transportErr}}}
	// Use a small HardGrace so we can drive the entry past the cap quickly.
	svc, logs := newService(t, Options{
		Resolver:      resolver,
		ConfigFetcher: resolver,
		SoftBump:      1 * time.Second,
		HardGrace:     2 * time.Second,
	})
	rawKey := "vk-lw-hardcap"
	// Seed an entry whose original JWT exp is already past the hard cap
	// (staleness > HardGrace).
	seedExpiredEntry(t, svc, rawKey, "vk_hardcap", 10*time.Second)

	_, err := svc.Resolve(context.Background(), rawKey)
	if err == nil {
		t.Fatal("expected hard-cap eviction to reject the request")
	}
	if !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("expected the upstream transport error to surface, got %v", err)
	}
	if _, ok := svc.l1.Get(hashKey(rawKey)); ok {
		t.Fatal("entry should have been evicted at hard cap")
	}

	found := false
	for _, entry := range logs.All() {
		if entry.Message == "auth_cache_hard_evict" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected auth_cache_hard_evict log line")
	}
}

// --- Successful refresh resets soft expiry -----------------------------------

func TestResolve_StaleEntry_RecoveryReplacesEntryWithFreshBundle(t *testing.T) {
	freshExp := time.Now().Add(15 * time.Minute)
	resolver := &fakeResolver{returns: []resolverReturn{
		{bundle: freshBundle("vk_recovered", freshExp)},
	}}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	rawKey := "vk-lw-recover"
	seedExpiredEntry(t, svc, rawKey, "vk_recovered", 30*time.Second)

	bundle, err := svc.Resolve(context.Background(), rawKey)
	if err != nil {
		t.Fatalf("expected recovery to succeed, got %v", err)
	}
	if bundle.VirtualKeyID != "vk_recovered" {
		t.Fatalf("expected fresh bundle, got %+v", bundle)
	}

	e, ok := svc.l1.Get(hashKey(rawKey))
	if !ok {
		t.Fatal("entry should be present after recovery")
	}
	_, soft, hard := e.snapshot()
	if !soft.Equal(freshExp) {
		t.Fatalf("soft expiry should track fresh JWT exp; got %v want %v", soft, freshExp)
	}
	expectedHard := freshExp.Add(svc.hardGrace)
	if !hard.Equal(expectedHard) {
		t.Fatalf("hard cap should be fresh exp + hardGrace; got %v want %v", hard, expectedHard)
	}
}

func TestApplyChange_ModelProviderUpdatedEvictsMatchingModelProvider(t *testing.T) {
	resolver := &fakeResolver{}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})

	matchingKey := hashKey("vk-lw-matching-provider")
	otherKey := hashKey("vk-lw-other-provider")
	svc.storeL1(matchingKey, &domain.Bundle{
		VirtualKeyID: "vk-matching",
		Config: domain.BundleConfig{Credentials: []domain.Credential{{
			ID:         "model-provider-1",
			ProviderID: domain.ProviderOpenAI,
		}}},
	})
	svc.storeL1(otherKey, &domain.Bundle{
		VirtualKeyID: "vk-other",
		Config: domain.BundleConfig{Credentials: []domain.Credential{{
			ID:         "model-provider-2",
			ProviderID: domain.ProviderOpenAI,
		}}},
	})

	svc.applyChange("", CacheChange{
		Kind:            ChangeKindProviderBindingUpdated,
		ModelProviderID: "model-provider-1",
	})

	_, isMatchingPresent := svc.l1.Get(matchingKey)
	_, isOtherPresent := svc.l1.Get(otherKey)
	if isMatchingPresent {
		t.Fatal("the changed model provider must be evicted")
	}
	if !isOtherPresent {
		t.Fatal("other provider bindings must stay cached")
	}
}

func TestApplyChange_BudgetMutationWithoutProjectIDEvictsOrganization(t *testing.T) {
	resolver := &fakeResolver{}
	l2 := newFakeL2()
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver, L2: l2})

	for _, kind := range []string{
		ChangeKindBudgetCreated,
		ChangeKindBudgetUpdated,
		ChangeKindBudgetDeleted,
	} {
		t.Run(kind, func(t *testing.T) {
			matchingRaw := "vk-lw-budget-matching-" + kind
			otherRaw := "vk-lw-budget-other-" + kind
			seedBothTiers(svc, l2, matchingRaw, &domain.Bundle{OrganizationID: "org-1"})
			seedBothTiers(svc, l2, otherRaw, &domain.Bundle{OrganizationID: "org-2"})

			svc.applyChange("org-1", CacheChange{Kind: kind})

			_, isMatchingPresent := svc.l1.Get(hashKey(matchingRaw))
			_, isOtherPresent := svc.l1.Get(hashKey(otherRaw))
			assert.False(t, isMatchingPresent, "budget changes must evict the polled organization")
			assert.True(t, isOtherPresent, "other organizations must remain cached")
			// The shared tier is the half a single node's eviction cannot
			// fix by itself: leave the bundle there and the next request
			// rehydrates the budget the event just changed.
			assert.False(t, l2.has(l2Key(matchingRaw)), "budget changes must drop the shared tier's copy too")
			assert.True(t, l2.has(l2Key(otherRaw)), "other organizations must remain in the shared tier")
		})
	}
}

/** @scenario Disable and enable propagate through the change feed */
func TestApplyChange_VkDisableAndEnableEvictTheKey(t *testing.T) {
	resolver := &fakeResolver{}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})

	for _, kind := range []string{
		ChangeKindVirtualKeyDisabled,
		ChangeKindVirtualKeyEnabled,
	} {
		t.Run(kind, func(t *testing.T) {
			matchingKey := hashKey("vk-lw-lifecycle-matching-" + kind)
			otherKey := hashKey("vk-lw-lifecycle-other-" + kind)
			svc.storeL1(matchingKey, &domain.Bundle{VirtualKeyID: "vk-flipped"})
			svc.storeL1(otherKey, &domain.Bundle{VirtualKeyID: "vk-untouched"})

			svc.applyChange("org-1", CacheChange{Kind: kind, VirtualKeyID: "vk-flipped"})

			_, isMatchingPresent := svc.l1.Get(matchingKey)
			_, isOtherPresent := svc.l1.Get(otherKey)
			assert.False(t, isMatchingPresent, "a disabled or enabled key must be evicted so the next request re-resolves its status")
			assert.True(t, isOtherPresent, "unrelated keys must remain cached")
		})
	}
}

/** @scenario "an edited routing policy evicts the organization's cached bundles" */
func TestApplyChange_RoutingPolicyUpdatedEvictsOrganization(t *testing.T) {
	resolver := &fakeResolver{}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})

	matchingKey := hashKey("vk-lw-policy-matching")
	otherKey := hashKey("vk-lw-policy-other")
	svc.storeL1(matchingKey, &domain.Bundle{OrganizationID: "org-1"})
	svc.storeL1(otherKey, &domain.Bundle{OrganizationID: "org-2"})

	svc.applyChange("org-1", CacheChange{Kind: ChangeKindRoutingPolicyUpdated})

	_, isMatchingPresent := svc.l1.Get(matchingKey)
	_, isOtherPresent := svc.l1.Get(otherKey)
	assert.False(t, isMatchingPresent, "a routing-policy edit must evict the polled organization")
	assert.True(t, isOtherPresent, "other organizations must remain cached")
}

/** @scenario "a deleted routing policy evicts the organization's cached bundles" */
func TestApplyChange_RoutingPolicyDeletedEvictsOrganization(t *testing.T) {
	resolver := &fakeResolver{}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})

	matchingKey := hashKey("vk-lw-policy-deleted-matching")
	otherKey := hashKey("vk-lw-policy-deleted-other")
	svc.storeL1(matchingKey, &domain.Bundle{OrganizationID: "org-1"})
	svc.storeL1(otherKey, &domain.Bundle{OrganizationID: "org-2"})

	svc.applyChange("org-1", CacheChange{Kind: ChangeKindRoutingPolicyDeleted})

	_, isMatchingPresent := svc.l1.Get(matchingKey)
	_, isOtherPresent := svc.l1.Get(otherKey)
	assert.False(t, isMatchingPresent, "a routing-policy deletion must evict the polled organization")
	assert.True(t, isOtherPresent, "other organizations must remain cached")
}

/** @scenario "a cache-rule mutation evicts the organization's cached bundles" */
func TestApplyChange_CacheRuleMutationEvictsOrganization(t *testing.T) {
	resolver := &fakeResolver{}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})

	for _, kind := range []string{
		ChangeKindCacheRuleCreated,
		ChangeKindCacheRuleUpdated,
		ChangeKindCacheRuleDeleted,
	} {
		t.Run(kind, func(t *testing.T) {
			matchingKey := hashKey("vk-lw-cache-rule-matching-" + kind)
			otherKey := hashKey("vk-lw-cache-rule-other-" + kind)
			svc.storeL1(matchingKey, &domain.Bundle{OrganizationID: "org-1"})
			svc.storeL1(otherKey, &domain.Bundle{OrganizationID: "org-2"})

			svc.applyChange("org-1", CacheChange{Kind: kind})

			_, isMatchingPresent := svc.l1.Get(matchingKey)
			_, isOtherPresent := svc.l1.Get(otherKey)
			assert.False(t, isMatchingPresent, "a cache-rule mutation must evict the polled organization")
			assert.True(t, isOtherPresent, "other organizations must remain cached")
		})
	}
}

// --- Invalidation reaches the shared tier ------------------------------------

/** @scenario "a change event drops the entry from the shared cache tier too" */
func TestApplyChange_RoutingPolicyUpdate_EvictsBothTiers(t *testing.T) {
	l2 := newFakeL2()
	exp := time.Now().Add(1 * time.Hour)
	resolver := &fakeResolver{returns: []resolverReturn{{bundle: freshBundle("vk-policy", exp)}}}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver, L2: l2})

	invalidatedRaw := "vk-lw-policy-shared"
	invalidated := &domain.Bundle{VirtualKeyID: "vk-policy", OrganizationID: "org-1", ExpiresAt: exp}
	invalidated.Config.AllowedModels = []string{"model-from-the-old-policy"}
	seedBothTiers(svc, l2, invalidatedRaw, invalidated)
	otherRaw := "vk-lw-policy-shared-other"
	seedBothTiers(svc, l2, otherRaw, &domain.Bundle{OrganizationID: "org-2", ExpiresAt: exp})

	svc.applyChange("org-1", CacheChange{Kind: ChangeKindRoutingPolicyUpdated})

	_, isPresentInL1 := svc.l1.Get(hashKey(invalidatedRaw))
	assert.False(t, isPresentInL1, "the polled organization must be evicted locally")
	assert.False(t, l2.has(l2Key(invalidatedRaw)), "and dropped from the shared tier")
	assert.True(t, l2.has(l2Key(otherRaw)), "other organizations must stay in the shared tier")

	// The whole point of the deletion: without it this request finds the
	// invalidated bundle in the shared tier and puts it straight back, so the
	// policy the event announced never takes effect on this node.
	got, err := svc.Resolve(context.Background(), invalidatedRaw)
	require.NoError(t, err)
	assert.Empty(t, got.Config.AllowedModels, "the next request must re-resolve, not rehydrate the invalidated bundle")
	assert.Equal(t, int64(1), resolver.calls.Load(), "the evicted key must reach the control plane")
}

/** @scenario "a shared tier that cannot be reached does not hold up the local eviction" */
func TestApplyChange_SharedTierUnreachable_StillEvictsLocallyAndReports(t *testing.T) {
	l2 := newFakeL2()
	l2.delErr = errors.New("shared cache unreachable")
	resolver := &fakeResolver{}
	svc, logs := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver, L2: l2})

	rawKey := "vk-lw-shared-tier-down"
	seedBothTiers(svc, l2, rawKey, &domain.Bundle{OrganizationID: "org-1"})

	svc.applyChange("org-1", CacheChange{Kind: ChangeKindCacheRuleUpdated})

	_, isPresent := svc.l1.Get(hashKey(rawKey))
	assert.False(t, isPresent, "an unreachable shared tier must not hold up the local eviction")
	assert.Len(t, logs.FilterMessage("auth_cache_l2_delete_failed").All(), 1,
		"a shared-tier deletion that failed must be reported, it leaves that copy stale until the config TTL")
}

/** @scenario "a bundle past its hard cap is never served from the shared tier" */
func TestResolve_L2Hit_BundlePastHardCapIsAMissNotAServe(t *testing.T) {
	l2 := newFakeL2()
	resolver := &fakeResolver{returns: []resolverReturn{
		{bundle: freshBundle("vk_resolved_fresh", time.Now().Add(1*time.Hour))},
	}}
	svc, _ := newService(t, Options{
		Resolver: resolver, ConfigFetcher: resolver, L2: l2, HardGrace: time.Minute,
	})

	// The interface promises no expiry filtering, so a store is free to hand
	// back anything it still holds. This one does, which leaves the guard in
	// serveFromL2 as the only thing between a long-dead bundle and the caller.
	rawKey := "vk-lw-shared-tier-hard-expired"
	dead := freshBundle("vk_dead", time.Now().Add(-2*time.Hour))
	dead.Credentials = []domain.Credential{{ID: "cred-dead"}}
	l2.Set(context.Background(), l2Key(rawKey), CachedBundle{Bundle: dead, ConfigFetchedAt: time.Now()})

	got, err := svc.Resolve(context.Background(), rawKey)
	require.NoError(t, err)
	assert.Equal(t, "vk_resolved_fresh", got.VirtualKeyID, "a bundle past its hard cap must not be served")
	assert.Equal(t, int64(1), resolver.calls.Load(), "the request must resolve fresh instead")
}

/** @scenario "a shared-tier batch that fails does not take the rest of the eviction with it" */
func TestApplyChange_LargeEviction_ChunksAndContinuesPastAFailedBatch(t *testing.T) {
	l2 := newFakeL2()
	l2.failNthBatch = 1
	resolver := &fakeResolver{}
	svc, logs := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver, L2: l2})

	const cachedKeys = l2DeleteChunkSize*2 + 40
	for i := 0; i < cachedKeys; i++ {
		seedBothTiers(svc, l2, fmt.Sprintf("vk-lw-bulk-%04d", i), &domain.Bundle{OrganizationID: "org-1"})
	}

	svc.applyChange("org-1", CacheChange{Kind: ChangeKindRoutingPolicyUpdated})

	assert.Equal(t, 0, svc.l1.Len(), "every bundle in the polled organization leaves L1")
	assert.Equal(t, []int{l2DeleteChunkSize, l2DeleteChunkSize, 40}, l2.batchSizes(),
		"an org-wide eviction goes out in chunks, one round trip each, not one per key")
	assert.Equal(t, l2DeleteChunkSize, l2.len(),
		"only the failed batch survives; a batch that fails must not abandon the batches after it")

	warnings := logs.FilterMessage("auth_cache_l2_delete_failed").All()
	require.Len(t, warnings, 1, "one warn for the whole eviction, not one per key")
	assert.Equal(t, int64(l2DeleteChunkSize), warnings[0].ContextMap()["failed"])
	assert.Equal(t, int64(cachedKeys), warnings[0].ContextMap()["total"])
}

/** @scenario "the evict log names the change kind that caused it" */
func TestApplyChange_EvictLogNamesTheChangeKind(t *testing.T) {
	resolver := &fakeResolver{}
	for _, tc := range []struct{ kind, reason string }{
		{ChangeKindRoutingPolicyUpdated, "routing_policy_updated"},
		{ChangeKindRoutingPolicyDeleted, "routing_policy_deleted"},
		{ChangeKindCacheRuleCreated, "cache_rule_created"},
		{ChangeKindCacheRuleDeleted, "cache_rule_deleted"},
		{ChangeKindBudgetDeleted, "budget_deleted"},
		{ChangeKindVirtualKeyRevoked, "vk_revoked"},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			// auth_cache_change_evict is an info line, below newService's
			// default observer level.
			core, logs := observer.New(zap.InfoLevel)
			svc, _ := newService(t, Options{
				Resolver: resolver, ConfigFetcher: resolver, Logger: zap.New(core),
			})
			svc.storeL1(hashKey("vk-lw-reason-"+tc.kind), &domain.Bundle{
				OrganizationID: "org-1",
				VirtualKeyID:   "vk-reason",
			})

			svc.applyChange("org-1", CacheChange{Kind: tc.kind, VirtualKeyID: "vk-reason"})

			evictions := logs.FilterMessage("auth_cache_change_evict").All()
			require.Len(t, evictions, 1, "the eviction must be logged")
			assert.Equal(t, tc.reason, evictions[0].ContextMap()["reason"],
				"an operator has to be able to tell a delete from an update")
		})
	}
}

/** @scenario "rehydrating from the shared tier keeps the config's real age" */
func TestResolve_L2Hit_KeepsTheConfigFetchTimeItWasStoredWith(t *testing.T) {
	rawKey := "vk-lw-shared-tier-age"

	t.Run("when the shared entry's config is older than the TTL", func(t *testing.T) {
		l2 := newFakeL2()
		fetcher := &fakeConfigFetcher{cfg: domain.BundleConfig{Credentials: []domain.Credential{{ID: "cred-fresh"}}}}
		svc, _ := newService(t, Options{
			Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher, L2: l2,
			ConfigTTL: 60 * time.Second, RefreshThreshold: time.Second,
		})
		bundle := freshBundle("vk_shared_age", time.Now().Add(1*time.Hour))
		bundle.Credentials = []domain.Credential{{ID: "cred-old"}}
		l2.Set(context.Background(), l2Key(rawKey), CachedBundle{
			Bundle:          bundle,
			ConfigFetchedAt: time.Now().Add(-2 * time.Minute),
		})

		got, err := svc.Resolve(context.Background(), rawKey)
		require.NoError(t, err)
		assert.Equal(t, "cred-old", got.Credentials[0].ID, "the triggering request still serves what the shared tier held")
		// Stamping the rehydrate moment instead would leave this entry
		// looking fresh for another full TTL, so config staleness could
		// reach twice the TTL and an eviction could be undone by it.
		assert.Eventually(t, func() bool { return fetcher.fetches.Load() == 1 }, 2*time.Second, 10*time.Millisecond,
			"a rehydrated entry past its config TTL must refresh rather than restart the clock")
	})

	t.Run("when the shared entry's config is inside the TTL", func(t *testing.T) {
		l2 := newFakeL2()
		fetcher := &fakeConfigFetcher{}
		svc, _ := newService(t, Options{
			Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher, L2: l2,
			ConfigTTL: 60 * time.Second, RefreshThreshold: time.Second,
		})
		fetchedAt := time.Now().Add(-5 * time.Second)
		l2.Set(context.Background(), l2Key(rawKey), CachedBundle{
			Bundle:          freshBundle("vk_shared_age_fresh", time.Now().Add(1*time.Hour)),
			ConfigFetchedAt: fetchedAt,
		})

		_, err := svc.Resolve(context.Background(), rawKey)
		require.NoError(t, err)

		e, ok := svc.l1.Peek(hashKey(rawKey))
		require.True(t, ok, "the rehydrated bundle must land in L1")
		e.mu.Lock()
		storedFetchedAt := e.configFetchedAt
		e.mu.Unlock()
		assert.True(t, storedFetchedAt.Equal(fetchedAt), "L1 must inherit the shared tier's config-fetch time")
		assert.Equal(t, int64(0), fetcher.fetches.Load(), "config inside the TTL must not be refetched")
	})
}

// --- Background refresh classification --------------------------------------

func TestRefreshBackground_TransportFailure_BumpsSoft(t *testing.T) {
	transportErr := herr.New(context.Background(), domain.ErrAuthUpstream, nil)
	resolver := &fakeResolver{returns: []resolverReturn{{err: transportErr}}}
	svc, logs := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver, SoftBump: 5 * time.Minute})
	rawKey := "vk-lw-bgtransport"
	// Seed an entry near soft expiry but not past it (so background path is invoked).
	originalExp := time.Now().Add(30 * time.Second)
	svc.storeL1(hashKey(rawKey), freshBundle("vk_bgtransport", originalExp))

	beforeE, _ := svc.l1.Get(hashKey(rawKey))
	_, beforeSoft, _ := beforeE.snapshot()

	svc.refreshBackground(rawKey, hashKey(rawKey))

	afterE, ok := svc.l1.Get(hashKey(rawKey))
	if !ok {
		t.Fatal("entry should remain on background transport failure")
	}
	_, afterSoft, _ := afterE.snapshot()
	if !afterSoft.After(beforeSoft) {
		t.Fatalf("expected background transport failure to bump soft; %v -> %v", beforeSoft, afterSoft)
	}

	found := false
	for _, entry := range logs.All() {
		if entry.Message == "auth_cache_refresh_transport_failure" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected warn log on background transport failure")
	}
}

func TestRefreshBackground_AuthRejection_EvictsEntry(t *testing.T) {
	resolver := &fakeResolver{returns: []resolverReturn{
		{err: herr.New(context.Background(), domain.ErrKeyRevoked, nil)},
	}}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	rawKey := "vk-lw-bgrevoked"
	originalExp := time.Now().Add(30 * time.Second)
	svc.storeL1(hashKey(rawKey), freshBundle("vk_bgrevoked", originalExp))

	svc.refreshBackground(rawKey, hashKey(rawKey))

	if _, ok := svc.l1.Get(hashKey(rawKey)); ok {
		t.Fatal("entry should be evicted on background auth-rejection")
	}
}

// --- Classifier ---------------------------------------------------------------

func TestClassifyRefreshError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want refreshErrorClass
	}{
		{"nil", nil, classNone},
		{"ErrInvalidAPIKey direct", domain.ErrInvalidAPIKey, classAuthRejection},
		{"ErrKeyRevoked direct", domain.ErrKeyRevoked, classAuthRejection},
		{"ErrInvalidAPIKey via herr", herr.New(context.Background(), domain.ErrInvalidAPIKey, nil), classAuthRejection},
		{"ErrKeyRevoked via herr", herr.New(context.Background(), domain.ErrKeyRevoked, nil), classAuthRejection},
		{"ErrAuthUpstream", herr.New(context.Background(), domain.ErrAuthUpstream, nil), classTransportFailure},
		{"raw network error", &net.OpError{Op: "dial", Err: errors.New("connection refused")}, classTransportFailure},
		{"context deadline exceeded", context.DeadlineExceeded, classTransportFailure},
		{"unknown error", errors.New("something we have not anticipated"), classTransportFailure},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := classifyRefreshError(tc.err)
			if got != tc.want {
				t.Fatalf("classifyRefreshError(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

// @scenario "a negative hard grace disables stale-while-error"
func TestResolve_StaleEntry_NegativeHardGrace_DisablesStaleWhileError(t *testing.T) {
	transportErr := herr.New(context.Background(), domain.ErrAuthUpstream, nil)
	// Two returns: first call (foreground) fails, second (re-resolve after evict) also fails.
	resolver := &fakeResolver{returns: []resolverReturn{{err: transportErr}, {err: transportErr}}}

	// A negative HardGrace places the hard cap before the JWT exp, so an
	// entry is hard-expired before it could ever be served stale and the
	// resolve falls through to the cold-path L3 (which fails). This is the
	// opt-out for deployments where serving a stale bundle is unacceptable;
	// zero is "unset" and takes the 6h default instead.
	svc, _ := newService(t, Options{
		Resolver:      resolver,
		ConfigFetcher: resolver,
		HardGrace:     -1 * time.Second,
	})
	rawKey := "vk-lw-legacy"
	seedExpiredEntry(t, svc, rawKey, "vk_legacy", 30*time.Second)

	_, err := svc.Resolve(context.Background(), rawKey)
	if err == nil {
		t.Fatal("legacy-mode (no grace) should hard-fail when CP is down")
	}
	if !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("expected upstream error, got %v", err)
	}
}

// --- Single soft-bump never exceeds hard cap --------------------------------

func TestEntry_BumpSoft_RespectsHardCap(t *testing.T) {
	now := time.Now()
	e := &entry{
		bundle:        freshBundle("vk_x", now.Add(-1*time.Second)),
		softExpiresAt: now.Add(-1 * time.Second),
		hardExpiresAt: now.Add(2 * time.Second),
	}

	newSoft, bumped := e.bumpSoft(10 * time.Second)
	if !bumped {
		t.Fatal("expected first bump to apply")
	}
	if newSoft.After(e.hardExpiresAt) {
		t.Fatalf("bumpSoft must not exceed hard cap; got %v > %v", newSoft, e.hardExpiresAt)
	}
	if !newSoft.Equal(e.hardExpiresAt) {
		t.Fatalf("bumpSoft should clamp to hard cap when amount overshoots; got %v want %v", newSoft, e.hardExpiresAt)
	}

	// Subsequent bump at the cap should be a no-op.
	_, bumped2 := e.bumpSoft(10 * time.Second)
	if bumped2 {
		t.Fatal("expected second bump to be a no-op once at cap")
	}
}

// --- Concurrent stale-bump is race-free -------------------------------------

func TestEntry_BumpSoft_ConcurrentSafe(t *testing.T) {
	now := time.Now()
	e := &entry{
		bundle:        freshBundle("vk_x", now.Add(-1*time.Second)),
		softExpiresAt: now.Add(-1 * time.Second),
		hardExpiresAt: now.Add(1 * time.Hour),
	}

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = e.bumpSoft(1 * time.Second)
		}()
	}
	wg.Wait()
	// If the test ran without a -race trigger we're good; the only
	// behavioral assertion is that softExpiresAt advanced from before.
	_, soft, _ := e.snapshot()
	if !soft.After(now) {
		t.Fatal("expected soft to be in the future after concurrent bumps")
	}
}

// --- Print helper for clearer test output -----------------------------------

func init() {
	// Force errors.Is on string comparisons to surface as comparable in test failures.
	_ = fmt.Sprintf
}

// --- ConfigTTL refresh --------------------------------------------------------

// fakeConfigFetcher returns a programmable config, counting calls.
type fakeConfigFetcher struct {
	fakeResolver
	cfg     domain.BundleConfig
	cfgErr  error
	fetches atomic.Int64
}

func (f *fakeConfigFetcher) FetchConfig(_ context.Context, _ string) (domain.BundleConfig, error) {
	f.fetches.Add(1)
	return f.cfg, f.cfgErr
}

// backdateConfig makes the L1 entry's config look older than the TTL.
func backdateConfig(t *testing.T, svc *Service, rawKey string, age time.Duration) *entry {
	t.Helper()
	e, ok := svc.l1.Get(hashKey(rawKey))
	if !ok {
		t.Fatal("expected L1 entry")
	}
	e.mu.Lock()
	e.configFetchedAt = time.Now().Add(-age)
	e.mu.Unlock()
	return e
}

func TestResolve_FreshEntry_ConfigPastTTL_RefreshesConfigInBackground(t *testing.T) {
	fetcher := &fakeConfigFetcher{
		cfg: domain.BundleConfig{
			Credentials: []domain.Credential{{ID: "cred-new"}},
			// A non-Credentials Config field, to lock in that the whole Config
			// is refreshed, not just the mirrored top-level Credentials.
			AllowedModels: []string{"anthropic/claude-sonnet-4-5"},
		},
	}
	svc, _ := newService(t, Options{
		Resolver:         &fetcher.fakeResolver,
		ConfigFetcher:    fetcher,
		ConfigTTL:        60 * time.Second,
		RefreshThreshold: time.Second, // keep near-soft-expiry path out of the way
	})

	rawKey := "vk-lw-cfgttl_001"
	bundle := freshBundle("vk_cfg_001", time.Now().Add(1*time.Hour))
	bundle.Credentials = []domain.Credential{{ID: "cred-old"}}
	svc.storeL1(hashKey(rawKey), bundle)
	backdateConfig(t, svc, rawKey, 2*time.Minute)

	got, err := svc.Resolve(context.Background(), rawKey)
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	// The triggering request still serves the (stale-config) bundle.
	if got.Credentials[0].ID != "cred-old" {
		t.Fatalf("expected triggering request to serve stale config, got %q", got.Credentials[0].ID)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if e, ok := svc.l1.Get(hashKey(rawKey)); ok {
			b, _, _ := e.snapshot()
			// The whole Config is refreshed, not just the mirrored Credentials:
			// the top-level Credentials mirror and a non-Credentials Config
			// field (AllowedModels) both reflect the freshly fetched config.
			credRefreshed := len(b.Credentials) == 1 && b.Credentials[0].ID == "cred-new"
			cfgRefreshed := len(b.Config.AllowedModels) == 1 &&
				b.Config.AllowedModels[0] == "anthropic/claude-sonnet-4-5"
			if credRefreshed && cfgRefreshed {
				return // whole config refreshed
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("expected background config refresh to replace credentials and the full config within 2s")
}

func TestResolve_FreshEntry_ConfigTTLDisabled_NeverRefreshes(t *testing.T) {
	fetcher := &fakeConfigFetcher{}
	svc, _ := newService(t, Options{
		Resolver:         &fetcher.fakeResolver,
		ConfigFetcher:    fetcher,
		ConfigTTL:        -1, // disabled
		RefreshThreshold: time.Second,
	})

	rawKey := "vk-lw-cfgttl_002"
	svc.storeL1(hashKey(rawKey), freshBundle("vk_cfg_002", time.Now().Add(1*time.Hour)))
	backdateConfig(t, svc, rawKey, 10*time.Minute)

	if _, err := svc.Resolve(context.Background(), rawKey); err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	if n := fetcher.fetches.Load(); n != 0 {
		t.Fatalf("expected no config fetches with TTL disabled, got %d", n)
	}
}

func TestResolve_FreshEntry_ConfigRefreshFailure_KeepsStaleAndWaitsFullTTL(t *testing.T) {
	fetcher := &fakeConfigFetcher{cfgErr: errors.New("control plane down")}
	svc, _ := newService(t, Options{
		Resolver:         &fetcher.fakeResolver,
		ConfigFetcher:    fetcher,
		ConfigTTL:        60 * time.Second,
		RefreshThreshold: time.Second,
	})

	rawKey := "vk-lw-cfgttl_003"
	bundle := freshBundle("vk_cfg_003", time.Now().Add(1*time.Hour))
	bundle.Credentials = []domain.Credential{{ID: "cred-old"}}
	svc.storeL1(hashKey(rawKey), bundle)
	e := backdateConfig(t, svc, rawKey, 2*time.Minute)

	if _, err := svc.Resolve(context.Background(), rawKey); err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && fetcher.fetches.Load() == 0 {
		time.Sleep(10 * time.Millisecond)
	}
	if fetcher.fetches.Load() == 0 {
		t.Fatal("expected one config fetch attempt")
	}
	// Wait for endConfigRefresh to release the slot and stamp fetchedAt.
	for time.Now().Before(deadline) {
		e.mu.Lock()
		refreshing := e.configRefreshing
		e.mu.Unlock()
		if !refreshing {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Stale config keeps serving and the failed attempt stamped
	// configFetchedAt, so the next request must NOT re-fetch.
	got, err := svc.Resolve(context.Background(), rawKey)
	if err != nil {
		t.Fatalf("Resolve after failure: %v", err)
	}
	if got.Credentials[0].ID != "cred-old" {
		t.Fatalf("expected stale config to keep serving, got %q", got.Credentials[0].ID)
	}
	time.Sleep(50 * time.Millisecond)
	if n := fetcher.fetches.Load(); n != 1 {
		t.Fatalf("expected exactly one fetch until next TTL, got %d", n)
	}
}

// blockingConfigFetcher blocks inside FetchConfig until released, so a test
// can evict or replace the L1 entry while the config fetch is still in flight.
type blockingConfigFetcher struct {
	fakeResolver
	cfg     domain.BundleConfig
	started chan struct{}
	release chan struct{}
	fetches atomic.Int64
}

func (f *blockingConfigFetcher) FetchConfig(_ context.Context, _ string) (domain.BundleConfig, error) {
	f.fetches.Add(1)
	f.started <- struct{}{}
	<-f.release
	return f.cfg, nil
}

// Regression: a background ConfigTTL refresh must not resurrect an entry that
// another path evicted while the config fetch was in flight (e.g. the VK or
// provider binding was revoked via the change feed). Otherwise the gateway
// would keep serving stale or revoked config until the next invalidation. The
// same live-entry guard covers the L2 write.
//
// Spec: specs/ai-gateway/auth-cache.feature
func TestResolve_ConfigRefresh_EvictedMidFetch_NotResurrected(t *testing.T) {
	fetcher := &blockingConfigFetcher{
		cfg:     domain.BundleConfig{Credentials: []domain.Credential{{ID: "cred-new"}}},
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
	svc, _ := newService(t, Options{
		Resolver:         &fetcher.fakeResolver,
		ConfigFetcher:    fetcher,
		ConfigTTL:        60 * time.Second,
		RefreshThreshold: time.Second,
	})

	rawKey := "vk-lw-cfgttl_race"
	h := hashKey(rawKey)
	bundle := freshBundle("vk_cfg_race", time.Now().Add(1*time.Hour))
	bundle.Credentials = []domain.Credential{{ID: "cred-old"}}
	svc.storeL1(h, bundle)
	e := backdateConfig(t, svc, rawKey, 2*time.Minute)

	// Triggering request serves the stale bundle and kicks off the refresh.
	if _, err := svc.Resolve(context.Background(), rawKey); err != nil {
		t.Fatalf("Resolve: %v", err)
	}

	// Once the fetch is in flight, evict the entry mid-fetch (change-feed revoke).
	select {
	case <-fetcher.started:
	case <-time.After(2 * time.Second):
		t.Fatal("background config refresh did not start")
	}
	svc.l1.Remove(h)

	// Release the fetch; the now-stale goroutine must drop its result.
	close(fetcher.release)

	// Wait for the goroutine to finish (endConfigRefresh clears the flag) so
	// the store-or-drop decision is settled before asserting.
	done := false
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		e.mu.Lock()
		done = !e.configRefreshing
		e.mu.Unlock()
		if done {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if !done {
		t.Fatal("config refresh goroutine did not finish")
	}

	if _, ok := svc.l1.Peek(h); ok {
		t.Fatal("evicted entry was resurrected by the stale config-refresh goroutine")
	}
	if n := fetcher.fetches.Load(); n != 1 {
		t.Fatalf("expected exactly one config fetch, got %d", n)
	}
}

// @scenario "A change kind this build does not act on is reported, not dropped"
func TestApplyChange_UnhandledKindIsReported(t *testing.T) {
	resolver := &fakeResolver{}
	svc, logs := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})

	key := hashKey("vk-lw-unhandled-kind")
	svc.storeL1(key, &domain.Bundle{OrganizationID: "org-1"})

	svc.applyChange("org-1", CacheChange{Kind: "SOMETHING_THIS_BUILD_PREDATES"})

	// Not acting on it is fine and often right. Not saying so is how the
	// CACHE_RULE_* kinds stayed unhandled from the day they shipped.
	_, isPresent := svc.l1.Get(key)
	assert.True(t, isPresent, "an unknown kind must not evict anything")

	warnings := logs.FilterMessage("auth_cache_change_unhandled").All()
	assert.Len(t, warnings, 1, "an unhandled kind must be reported once")
	assert.Equal(t, "SOMETHING_THIS_BUILD_PREDATES", warnings[0].ContextMap()["kind"])
}
