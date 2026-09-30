package authresolver

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// seedServedKey caches a key the way a healthy resolve leaves it: a fresh JWT,
// known-good credentials and a config the control plane just confirmed.
func seedServedKey(t *testing.T, svc *Service, rawKey, vkID string) [64]byte {
	t.Helper()
	h := hashKey(domain.PresentedKey{Token: rawKey})
	b := bundleWithCreds(vkID, time.Now().Add(10*time.Minute), "cred-known-good")
	b.OrganizationID = "org-1"
	b.ProjectID = "proj-1"
	svc.storeL1(h, b, "etag-1")
	return h
}

func budgetUpdated(svc *Service) {
	svc.applyChange("org-1", CacheChange{Kind: ChangeKindBudgetUpdated, ProjectID: "proj-1"})
}

// @scenario "a key evicted by a budget change keeps serving when the refetch times out"
func TestResolve_EvictedByBudgetChange_ConfigTimeout_ServesLastKnown(t *testing.T) {
	fetcher := &fakeConfigFetcher{cfgErr: context.DeadlineExceeded}
	fetcher.returns = []resolverReturn{{bundle: freshBundle("vk_busy", time.Now().Add(10*time.Minute))}}
	svc, logs := newService(t, Options{
		Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher, RefreshThreshold: time.Second,
	})
	rawKey := "vk-lw-busy"
	h := seedServedKey(t, svc, rawKey, "vk_busy")

	budgetUpdated(svc)
	_, inL1 := svc.l1.Peek(h)
	require.False(t, inL1, "the budget change still evicts, so the next request sees fresh spend")

	got, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})
	require.NoError(t, err, "a key served a minute ago must not turn into auth_upstream_unavailable")
	require.Len(t, got.Credentials, 1)
	assert.Equal(t, "cred-known-good", got.Credentials[0].ID)

	warns := logs.FilterMessage("auth_cache_serve_last_known").All()
	require.Len(t, warns, 1)
	assert.Equal(t, "vk_busy", warns[0].ContextMap()["vk_id"])

	callsBefore := fetcher.calls.Load()
	fetchesBefore := fetcher.fetches.Load()
	again, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})
	require.NoError(t, err)
	assert.Equal(t, "cred-known-good", again.Credentials[0].ID)
	assert.Equal(t, callsBefore, fetcher.calls.Load(), "the reinstalled entry serves from the cache")
	assert.Equal(t, fetchesBefore, fetcher.fetches.Load(), "without waiting on the control plane")

	e, ok := svc.l1.Peek(h)
	require.True(t, ok)
	assert.Empty(t, e.refreshConfigETag(), "the held config is known outdated, so the next refresh must not revalidate it")
}

// @scenario "the fallback recovers as soon as the control plane answers"
func TestResolve_LastKnown_RecoversOnNextRefresh(t *testing.T) {
	fetcher := &fakeConfigFetcher{cfgErr: errors.New("config fetch returned 503")}
	fetcher.returns = []resolverReturn{{bundle: freshBundle("vk_recover", time.Now().Add(10*time.Minute))}}
	svc, _ := newService(t, Options{
		Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher, RefreshThreshold: time.Second,
	})
	rawKey := "vk-lw-recover"
	h := seedServedKey(t, svc, rawKey, "vk_recover")
	budgetUpdated(svc)
	_, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})
	require.NoError(t, err)

	fetcher.cfgErr = nil
	fetcher.cfg = domain.BundleConfig{Credentials: []domain.Credential{{ID: "cred-fresh"}}}
	e, ok := svc.l1.Peek(h)
	require.True(t, ok)
	require.True(t, e.tryBeginConfigRefresh())
	svc.refreshConfigBackground(h, e)

	cur, ok := svc.l1.Peek(h)
	require.True(t, ok)
	require.Len(t, cur.bundle.Credentials, 1)
	assert.Equal(t, "cred-fresh", cur.bundle.Credentials[0].ID)
}

// @scenario "the last known config expires one hour after it was last confirmed"
func TestResolve_LastKnown_OlderThanMaxAge_FailsRetryable(t *testing.T) {
	fetcher := &fakeConfigFetcher{cfgErr: errors.New("config fetch returned 503")}
	fetcher.returns = []resolverReturn{{bundle: freshBundle("vk_old", time.Now().Add(10*time.Minute))}}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})
	rawKey := "vk-lw-old"
	h := seedServedKey(t, svc, rawKey, "vk_old")
	e, _ := svc.l1.Peek(h)
	e.mu.Lock()
	e.configConfirmedAt = time.Now().Add(-DefaultLastKnownConfigMaxAge - time.Minute)
	e.mu.Unlock()

	budgetUpdated(svc)
	_, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrAuthUpstream), "expected auth_upstream_unavailable, got %v", err)
}

// @scenario "revoking, disabling or rotating a key leaves no fallback behind"
func TestResolve_RevokingChange_LeavesNoFallback(t *testing.T) {
	for _, kind := range []string{
		ChangeKindVirtualKeyRevoked, ChangeKindVirtualKeyDisabled, ChangeKindVirtualKeyRotated,
	} {
		for _, afterBudget := range []bool{false, true} {
			name := kind
			if afterBudget {
				name += "/after a budget eviction"
			}
			t.Run(name, func(t *testing.T) {
				fetcher := &fakeConfigFetcher{}
				fetcher.returns = []resolverReturn{{err: herr.New(context.Background(), domain.ErrAuthUpstream, nil)}}
				svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})
				rawKey := "vk-lw-revoked-" + name
				seedServedKey(t, svc, rawKey, "vk_revoked")
				if afterBudget {
					budgetUpdated(svc)
				}

				svc.applyChange("org-1", CacheChange{Kind: kind, VirtualKeyID: "vk_revoked"})

				_, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})
				require.Error(t, err, "a key the change made unusable must not come back as a fallback")
				assert.Zero(t, svc.lastKnown.Len())
			})
		}
	}
}

// @scenario "a definitive rejection from the control plane is never overridden by the fallback"
func TestResolve_LastKnown_AuthRejectionWins(t *testing.T) {
	fetcher := &fakeConfigFetcher{}
	fetcher.returns = []resolverReturn{{err: herr.New(context.Background(), domain.ErrInvalidAPIKey, nil)}}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})
	rawKey := "vk-lw-rejected"
	seedServedKey(t, svc, rawKey, "vk_rejected")
	budgetUpdated(svc)
	require.Equal(t, 1, svc.lastKnown.Len())

	_, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})
	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrInvalidAPIKey), "expected invalid_api_key, got %v", err)
	assert.Zero(t, svc.lastKnown.Len(), "the rejected key's last known config is discarded")
}
