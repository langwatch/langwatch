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
	"os"
	"path/filepath"
	"regexp"
	"strings"
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

func (f *fakeResolver) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	return domain.ConfigFetchResult{}, nil
}

// changeKindEnumRe pulls the body out of the control plane's enum block.
var changeKindEnumRe = regexp.MustCompile(`(?s)enum GatewayChangeEventKind \{(.*?)\}`)

// repoRoot walks up from the test's directory to the module root, so a test
// can read a control-plane file without a relative path that breaks the
// moment either side moves.
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	require.NoError(t, err)
	for {
		if _, statErr := os.Stat(filepath.Join(dir, "go.mod")); statErr == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		require.NotEqual(t, dir, parent, "no go.mod above the test directory")
		dir = parent
	}
}

// changeKindsFromSchema reads GatewayChangeEventKind out of the Prisma schema,
// the only source of truth for what the change feed can emit. Reading the
// schema rather than restating the list here is what makes a kind added
// upstream fail a test instead of arriving as a production warning.
func changeKindsFromSchema(t *testing.T) []string {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(repoRoot(t), "platform", "app", "prisma", "schema.prisma"))
	require.NoError(t, err)
	block := changeKindEnumRe.FindSubmatch(body)
	require.NotNil(t, block, "GatewayChangeEventKind is not in schema.prisma; this test is looking in the wrong place")

	var kinds []string
	for _, line := range strings.Split(string(block[1]), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "//") {
			continue
		}
		kinds = append(kinds, line)
	}
	require.NotEmpty(t, kinds, "the enum parsed to nothing")
	return kinds
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
	svc.storeL1(hashKey(rawKey), freshBundle(vkID, originalExp), "")
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
	}, "")
	svc.storeL1(otherKey, &domain.Bundle{
		VirtualKeyID: "vk-other",
		Config: domain.BundleConfig{Credentials: []domain.Credential{{
			ID:         "model-provider-2",
			ProviderID: domain.ProviderOpenAI,
		}}},
	}, "")

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
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})

	for _, kind := range []string{
		ChangeKindBudgetCreated,
		ChangeKindBudgetUpdated,
		ChangeKindBudgetDeleted,
	} {
		t.Run(kind, func(t *testing.T) {
			matchingKey := hashKey("vk-lw-budget-matching-" + kind)
			otherKey := hashKey("vk-lw-budget-other-" + kind)
			svc.storeL1(matchingKey, &domain.Bundle{OrganizationID: "org-1"}, "")
			svc.storeL1(otherKey, &domain.Bundle{OrganizationID: "org-2"}, "")

			svc.applyChange("org-1", CacheChange{Kind: kind})

			_, isMatchingPresent := svc.l1.Get(matchingKey)
			_, isOtherPresent := svc.l1.Get(otherKey)
			assert.False(t, isMatchingPresent, "budget changes must evict the polled organization")
			assert.True(t, isOtherPresent, "other organizations must remain cached")
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
			svc.storeL1(matchingKey, &domain.Bundle{VirtualKeyID: "vk-flipped"}, "")
			svc.storeL1(otherKey, &domain.Bundle{VirtualKeyID: "vk-untouched"}, "")

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
	svc.storeL1(matchingKey, &domain.Bundle{OrganizationID: "org-1"}, "")
	svc.storeL1(otherKey, &domain.Bundle{OrganizationID: "org-2"}, "")

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
	svc.storeL1(matchingKey, &domain.Bundle{OrganizationID: "org-1"}, "")
	svc.storeL1(otherKey, &domain.Bundle{OrganizationID: "org-2"}, "")

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
			svc.storeL1(matchingKey, &domain.Bundle{OrganizationID: "org-1"}, "")
			svc.storeL1(otherKey, &domain.Bundle{OrganizationID: "org-2"}, "")

			svc.applyChange("org-1", CacheChange{Kind: kind})

			_, isMatchingPresent := svc.l1.Get(matchingKey)
			_, isOtherPresent := svc.l1.Get(otherKey)
			assert.False(t, isMatchingPresent, "a cache-rule mutation must evict the polled organization")
			assert.True(t, isOtherPresent, "other organizations must remain cached")
		})
	}
}

// --- Grace-window classification ---------------------------------------------

/** @scenario "the grace window moves the hard cap, not the bundle's own expiry" */
func TestResolve_HardGrace_MovesTheCapNotTheExpiry(t *testing.T) {
	const cachedCred = "cred-from-cache"
	const freshCred = "cred-from-control-plane"

	cases := []struct {
		name      string
		hardGrace time.Duration
		expiresIn time.Duration
		wantCred  string
		wantCalls int64
	}{
		// A bundle inside its own expiry serves untouched, whatever the cap
		// is doing. The negative case is the one that used to diverge: the
		// cap sits an hour in the PAST, so testing the cap first threw away a
		// credential that had not expired.
		{"a positive grace serves a bundle inside its expiry", time.Hour, 10 * time.Minute, cachedCred, 0},
		{"a zero grace takes the default and serves it", 0, 10 * time.Minute, cachedCred, 0},
		{"a negative grace still serves a bundle inside its expiry", -time.Hour, 10 * time.Minute, cachedCred, 0},
		// Past its own expiry, the control plane decides.
		{"a positive grace refreshes an expired bundle before serving", time.Hour, -30 * time.Second, freshCred, 1},
		{"a negative grace refuses to serve an expired bundle", -time.Hour, -30 * time.Second, freshCred, 1},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			fresh := freshBundle("vk_fresh", time.Now().Add(1*time.Hour))
			fresh.Credentials = []domain.Credential{{ID: freshCred}}
			fetcher := &fakeConfigFetcher{
				cfg: domain.BundleConfig{Credentials: []domain.Credential{{ID: freshCred}}},
			}
			fetcher.returns = []resolverReturn{{bundle: fresh}}
			svc, _ := newService(t, Options{
				Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher,
				HardGrace: tc.hardGrace, RefreshThreshold: time.Second,
			})

			rawKey := "vk-lw-grace-" + tc.name
			cached := freshBundle("vk_cached", time.Now().Add(tc.expiresIn))
			cached.Credentials = []domain.Credential{{ID: cachedCred}}
			svc.storeL1(hashKey(rawKey), cached, "")

			got, err := svc.Resolve(context.Background(), rawKey)

			require.NoError(t, err)
			require.NotNil(t, got)
			assert.Equal(t, tc.wantCred, got.Credentials[0].ID,
				"the grace window must not decide whether a bundle inside its own expiry is servable")
			assert.Equal(t, tc.wantCalls, fetcher.calls.Load(),
				"and must not change how often the control plane is consulted")
		})
	}
}

/** @scenario "every kind the control plane can emit is acted on or ignored on purpose" */
func TestApplyChange_EveryKindTheControlPlaneCanEmitIsAccountedFor(t *testing.T) {
	for _, kind := range changeKindsFromSchema(t) {
		t.Run(kind, func(t *testing.T) {
			core, logs := observer.New(zap.WarnLevel)
			resolver := &fakeResolver{}
			svc, _ := newService(t, Options{
				Resolver: resolver, ConfigFetcher: resolver, Logger: zap.New(core),
			})
			svc.storeL1(hashKey("vk-lw-accounted-"+kind), &domain.Bundle{
				OrganizationID: "org-1",
				VirtualKeyID:   "vk-accounted",
			}, "")

			svc.applyChange("org-1", CacheChange{
				Kind:            kind,
				VirtualKeyID:    "vk-accounted",
				ModelProviderID: "model-provider-1",
			})

			assert.Empty(t, logs.FilterMessage("auth_cache_change_unhandled").All(),
				"a kind the control plane can emit is either acted on or ignored by name; reaching the unknown-kind warn makes a routine event look like an incident")
		})
	}
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
			}, "")

			svc.applyChange("org-1", CacheChange{Kind: tc.kind, VirtualKeyID: "vk-reason"})

			evictions := logs.FilterMessage("auth_cache_change_evict").All()
			require.Len(t, evictions, 1, "the eviction must be logged")
			assert.Equal(t, tc.reason, evictions[0].ContextMap()["reason"],
				"an operator has to be able to tell a delete from an update")
		})
	}
}

// --- Background refresh classification --------------------------------------

func TestRefreshBackground_TransportFailure_BumpsSoft(t *testing.T) {
	transportErr := herr.New(context.Background(), domain.ErrAuthUpstream, nil)
	resolver := &fakeResolver{returns: []resolverReturn{{err: transportErr}}}
	svc, logs := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver, SoftBump: 5 * time.Minute})
	rawKey := "vk-lw-bgtransport"
	// Seed an entry near soft expiry but not past it (so background path is invoked).
	originalExp := time.Now().Add(30 * time.Second)
	svc.storeL1(hashKey(rawKey), freshBundle("vk_bgtransport", originalExp), "")

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
	svc.storeL1(hashKey(rawKey), freshBundle("vk_bgrevoked", originalExp), "")

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

// fakeConfigFetcher returns a programmable config, counting calls. It always
// answers with the config, never a "still current" confirmation; the
// conditional half of the endpoint is exercised by etagConfigFetcher below.
type fakeConfigFetcher struct {
	fakeResolver
	cfg     domain.BundleConfig
	cfgErr  error
	fetches atomic.Int64
}

func (f *fakeConfigFetcher) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	f.fetches.Add(1)
	if f.cfgErr != nil {
		return domain.ConfigFetchResult{}, f.cfgErr
	}
	return domain.ConfigFetchResult{Config: f.cfg}, nil
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
	svc.storeL1(hashKey(rawKey), bundle, "")
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
	svc.storeL1(hashKey(rawKey), freshBundle("vk_cfg_002", time.Now().Add(1*time.Hour)), "")
	backdateConfig(t, svc, rawKey, 10*time.Minute)

	if _, err := svc.Resolve(context.Background(), rawKey); err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	time.Sleep(50 * time.Millisecond)
	if n := fetcher.fetches.Load(); n != 0 {
		t.Fatalf("expected no config fetches with TTL disabled, got %d", n)
	}
}

/** @scenario "a refresh the control plane cannot answer leaves the cached config serving" */
func TestResolve_FreshEntry_ConfigRefreshFailure_KeepsStaleAndWaitsFullTTL(t *testing.T) {
	fetcher := &fakeConfigFetcher{cfgErr: errors.New("control plane down")}
	svc, logs := newService(t, Options{
		Resolver:         &fetcher.fakeResolver,
		ConfigFetcher:    fetcher,
		ConfigTTL:        60 * time.Second,
		RefreshThreshold: time.Second,
	})

	rawKey := "vk-lw-cfgttl_003"
	bundle := freshBundle("vk_cfg_003", time.Now().Add(1*time.Hour))
	bundle.Credentials = []domain.Credential{{ID: "cred-old"}}
	svc.storeL1(hashKey(rawKey), bundle, "")
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
	// A safety net that quietly stops working is worse than one that fails
	// loudly: the config keeps serving either way, and the warn is the only
	// thing telling an operator the staleness bound is no longer held.
	assert.Len(t, logs.FilterMessage("config_ttl_refresh_failed").All(), 1,
		"a refresh the control plane could not answer must be reported")
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

func (f *blockingConfigFetcher) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	f.fetches.Add(1)
	f.started <- struct{}{}
	<-f.release
	return domain.ConfigFetchResult{Config: f.cfg}, nil
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
	svc.storeL1(h, bundle, "")
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
	svc.storeL1(key, &domain.Bundle{OrganizationID: "org-1"}, "")

	svc.applyChange("org-1", CacheChange{Kind: "SOMETHING_THIS_BUILD_PREDATES"})

	// Not acting on it is fine and often right. Not saying so is how the
	// CACHE_RULE_* kinds stayed unhandled from the day they shipped.
	_, isPresent := svc.l1.Get(key)
	assert.True(t, isPresent, "an unknown kind must not evict anything")

	warnings := logs.FilterMessage("auth_cache_change_unhandled").All()
	assert.Len(t, warnings, 1, "an unhandled kind must be reported once")
	assert.Equal(t, "SOMETHING_THIS_BUILD_PREDATES", warnings[0].ContextMap()["kind"])
}

// --- Conditional config refresh -----------------------------------------------

// etagConfigFetcher answers the config endpoint the way the control plane
// does (contract §4.2): an If-None-Match that matches the key's current
// revision is confirmed without a body, anything else gets the config and the
// revision it was materialized at. The revision moves through edit(), so a
// test can change a key between refreshes. Locked because the staleness
// refresh runs on its own goroutine.
type etagConfigFetcher struct {
	fakeResolver

	mu       sync.Mutex
	revision string
	cred     string
	// dropETag models a response that carries no ETag header, which leaves
	// the caller with no token to revalidate against next time.
	dropETag bool
	conds    []string
}

func (f *etagConfigFetcher) FetchConfig(_ context.Context, _, ifNoneMatch string) (domain.ConfigFetchResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.conds = append(f.conds, ifNoneMatch)
	if ifNoneMatch != "" && ifNoneMatch == f.revision {
		return domain.ConfigFetchResult{ETag: f.revision, NotModified: true}, nil
	}
	res := domain.ConfigFetchResult{
		Config: domain.BundleConfig{Credentials: []domain.Credential{{ID: f.cred}}},
	}
	if !f.dropETag {
		res.ETag = f.revision
	}
	return res, nil
}

// edit moves the key to a new revision carrying a new credential, the way an
// admin mutation on the control plane does.
func (f *etagConfigFetcher) edit(revision, cred string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.revision, f.cred = revision, cred
}

// conditionals reports the If-None-Match each fetch carried, in order.
func (f *etagConfigFetcher) conditionals() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.conds...)
}

// awaitConfigRefresh blocks until the background config refresh the last
// Resolve kicked off has finished. tryBeginConfigRefresh claims the slot
// before the goroutine starts, so the flag is already set by the time Resolve
// returns, and clearing it is the goroutine's last act.
func awaitConfigRefresh(t *testing.T, e *entry) {
	t.Helper()
	require.Eventually(t, func() bool {
		e.mu.Lock()
		defer e.mu.Unlock()
		return !e.configRefreshing
	}, 2*time.Second, 5*time.Millisecond, "the background config refresh never finished")
}

// newETagService wires a service around an etagConfigFetcher whose key starts
// at the given revision, and warms one cache entry through the cold path so
// the entry carries whatever ETag that fetch came back with.
func newETagService(t *testing.T, fetcher *etagConfigFetcher, rawKey string) (*Service, *entry) {
	t.Helper()
	fetcher.returns = []resolverReturn{{bundle: freshBundle("vk_etag", time.Now().Add(1*time.Hour))}}
	svc, _ := newService(t, Options{
		Resolver:         &fetcher.fakeResolver,
		ConfigFetcher:    fetcher,
		ConfigTTL:        60 * time.Second,
		RefreshThreshold: time.Second,
	})
	_, err := svc.Resolve(context.Background(), rawKey)
	require.NoError(t, err)
	e, ok := svc.l1.Peek(hashKey(rawKey))
	require.True(t, ok, "the cold resolve must leave an entry behind")
	return svc, e
}

/** @scenario "the staleness refresh revalidates instead of re-downloading" */
func TestResolve_ConfigTTLRefresh_IsConditional(t *testing.T) {
	t.Run("when nothing about the key changed", func(t *testing.T) {
		fetcher := &etagConfigFetcher{revision: "42", cred: "cred-current"}
		rawKey := "vk-lw-etag-unchanged"
		svc, e := newETagService(t, fetcher, rawKey)

		backdateConfig(t, svc, rawKey, 2*time.Minute)
		got, err := svc.Resolve(context.Background(), rawKey)
		require.NoError(t, err)
		awaitConfigRefresh(t, e)

		assert.Equal(t, []string{"", "42"}, fetcher.conditionals(),
			"the cold fetch has nothing to offer; the safety-net refresh offers the revision that fetch came back with")
		assert.Equal(t, "cred-current", got.Credentials[0].ID)
		live, ok := svc.l1.Peek(hashKey(rawKey))
		require.True(t, ok)
		assert.Same(t, e, live, "a confirmation replaces nothing; the entry that was serving keeps serving")
		assert.Equal(t, "cred-current", live.bundle.Credentials[0].ID)
		// The clock restarts on a confirmation, not just on a download: the
		// config was checked against the control plane and found current, so
		// re-asking on the very next request would spend a round trip to
		// learn the same thing.
		assert.False(t, live.configStale(60*time.Second),
			"a confirmed config is as fresh as a downloaded one")
	})

	t.Run("when the key's config changed", func(t *testing.T) {
		fetcher := &etagConfigFetcher{revision: "42", cred: "cred-old"}
		rawKey := "vk-lw-etag-changed"
		svc, e := newETagService(t, fetcher, rawKey)

		fetcher.edit("43", "cred-new")
		backdateConfig(t, svc, rawKey, 2*time.Minute)
		_, err := svc.Resolve(context.Background(), rawKey)
		require.NoError(t, err)
		awaitConfigRefresh(t, e)

		live, ok := svc.l1.Peek(hashKey(rawKey))
		require.True(t, ok)
		assert.Equal(t, "cred-new", live.bundle.Credentials[0].ID,
			"a revision the control plane has moved past must bring the new config in")
		assert.Equal(t, "43", live.currentConfigETag(),
			"and the entry must carry the new revision, or the next refresh revalidates against a dead one")

		// Third pass: the new revision is what gets offered from here on.
		backdateConfig(t, svc, rawKey, 2*time.Minute)
		_, err = svc.Resolve(context.Background(), rawKey)
		require.NoError(t, err)
		awaitConfigRefresh(t, live)
		assert.Equal(t, []string{"", "42", "43"}, fetcher.conditionals())
	})

	t.Run("when the control plane sent no version token", func(t *testing.T) {
		fetcher := &etagConfigFetcher{revision: "42", cred: "cred-current", dropETag: true}
		rawKey := "vk-lw-etag-absent"
		svc, e := newETagService(t, fetcher, rawKey)

		assert.Empty(t, e.currentConfigETag(), "there is no token to remember")

		backdateConfig(t, svc, rawKey, 2*time.Minute)
		_, err := svc.Resolve(context.Background(), rawKey)
		require.NoError(t, err)
		awaitConfigRefresh(t, e)

		assert.Equal(t, []string{"", ""}, fetcher.conditionals(),
			"with no token to offer, the refresh goes out unconditional rather than inventing one")
		live, ok := svc.l1.Peek(hashKey(rawKey))
		require.True(t, ok)
		assert.Equal(t, "cred-current", live.bundle.Credentials[0].ID,
			"and it comes back with the config, so the entry is never left without one")
	})
}
