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
	require.ErrorIs(t, err, domain.ErrAuthUpstream)
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
	invalid := herr.New(context.Background(), domain.ErrInvalidAPIKey, nil)
	for _, tc := range []struct {
		name    string
		resolve resolverReturn
		cfgErr  error
	}{
		{"resolve-key rejects the key", resolverReturn{err: invalid}, nil},
		{"the config fetch finds the key deleted", resolverReturn{bundle: freshBundle("vk_rejected", time.Now().Add(10*time.Minute))}, invalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fetcher := &fakeConfigFetcher{cfgErr: tc.cfgErr}
			fetcher.returns = []resolverReturn{tc.resolve}
			svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})
			rawKey := "vk-lw-rejected"
			seedServedKey(t, svc, rawKey, "vk_rejected")
			budgetUpdated(svc)
			require.Equal(t, 1, svc.lastKnown.Len())

			_, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})
			require.ErrorIs(t, err, domain.ErrInvalidAPIKey)
			assert.Zero(t, svc.lastKnown.Len(), "the rejected key's last known config is discarded")
		})
	}
}

// @scenario "the fallback never outlives the key's own expiration date"
func TestResolve_LastKnown_KeepsTheFreshTokensExpiry(t *testing.T) {
	expiresAt := time.Now().Add(20 * time.Minute)
	fresh := freshBundle("vk_dated", time.Now().Add(10*time.Minute))
	fresh.VirtualKeyExpiresAt = expiresAt
	fetcher := &fakeConfigFetcher{cfgErr: context.DeadlineExceeded}
	fetcher.returns = []resolverReturn{{bundle: fresh}}
	svc, _ := newService(t, Options{
		Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher, RefreshThreshold: time.Second,
	})
	rawKey := "vk-lw-dated"
	h := seedServedKey(t, svc, rawKey, "vk_dated")
	budgetUpdated(svc)

	got, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})
	require.NoError(t, err)
	assert.Equal(t, "cred-known-good", got.Credentials[0].ID, "the config comes from the last known entry")
	assert.True(t, got.VirtualKeyExpiresAt.Equal(expiresAt), "the expiry comes from the fresh resolution")
	e, ok := svc.l1.Peek(h)
	require.True(t, ok)
	assert.False(t, e.hardExpiresAt.After(expiresAt), "the fallback stops at the key's own expiration date")
}

// @scenario "the fallback never outlives the key's own expiration date"
func TestResolve_LastKnown_FreshResolutionAlreadyExpired_Refuses(t *testing.T) {
	fresh := freshBundle("vk_ended", time.Now().Add(10*time.Minute))
	fresh.VirtualKeyExpiresAt = time.Now().Add(-time.Second)
	fetcher := &fakeConfigFetcher{cfgErr: context.DeadlineExceeded}
	fetcher.returns = []resolverReturn{{bundle: fresh}}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})
	rawKey := "vk-lw-ended"
	seedServedKey(t, svc, rawKey, "vk_ended")
	budgetUpdated(svc)

	_, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})
	require.ErrorIs(t, err, domain.ErrKeyExpired)
}

// @scenario "the last known config expires one hour after it was last confirmed"
func TestServeLastKnown_EntryThatLapsedDuringTheFetch_IsNotServed(t *testing.T) {
	fetcher := &fakeConfigFetcher{}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})
	rawKey := "vk-lw-lapsed"
	h := seedServedKey(t, svc, rawKey, "vk_lapsed")
	budgetUpdated(svc)
	e := svc.lastKnownFor(h)
	require.NotNil(t, e)

	e.mu.Lock()
	e.configConfirmedAt = time.Now().Add(-DefaultLastKnownConfigMaxAge - time.Second)
	e.mu.Unlock()

	assert.Nil(t, svc.serveLastKnown(h, lastKnownServe{old: e, cause: context.DeadlineExceeded}))
	_, inL1 := svc.l1.Peek(h)
	assert.False(t, inL1)
}

// notModifiedFetcher confirms every conditional refresh and times out every
// unconditional one: a control plane that answers 304s from the key's
// revision but cannot materialize a full config.
type notModifiedFetcher struct {
	fakeResolver
}

func (f *notModifiedFetcher) FetchConfig(_ context.Context, _, ifNoneMatch string) (domain.ConfigFetchResult, error) {
	if ifNoneMatch != "" {
		return domain.ConfigFetchResult{NotModified: true}, nil
	}
	return domain.ConfigFetchResult{}, context.DeadlineExceeded
}

// @scenario "a not-modified answer counts as a confirmation of the last known config"
func TestResolve_LastKnown_WindowMeasuredFromLatest304(t *testing.T) {
	fetcher := &notModifiedFetcher{}
	fetcher.returns = []resolverReturn{{bundle: freshBundle("vk_confirmed", time.Now().Add(10*time.Minute))}}
	svc, _ := newService(t, Options{
		Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher, RefreshThreshold: time.Second,
	})
	rawKey := "vk-lw-confirmed"
	h := seedServedKey(t, svc, rawKey, "vk_confirmed")
	e, _ := svc.l1.Peek(h)
	e.mu.Lock()
	e.configConfirmedAt = time.Now().Add(-DefaultLastKnownConfigMaxAge - time.Minute)
	e.mu.Unlock()

	require.True(t, e.tryBeginConfigRefresh())
	svc.refreshConfigBackground(h, e)
	e.mu.Lock()
	confirmedAt := e.configConfirmedAt
	e.mu.Unlock()
	require.WithinDuration(t, time.Now(), confirmedAt, time.Second, "a 304 is a confirmation from the control plane")

	budgetUpdated(svc)
	got, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})
	require.NoError(t, err, "the fallback window is measured from the 304, not from the last full fetch")
	assert.Equal(t, "cred-known-good", got.Credentials[0].ID)

	cur, ok := svc.l1.Peek(h)
	require.True(t, ok)
	assert.WithinDuration(t, confirmedAt.Add(DefaultLastKnownConfigMaxAge), cur.hardExpiresAt, time.Second)
}

// @scenario "a definitive rejection from the control plane is never overridden by the fallback"
func TestRefresh_ConfigFetchFindsKeyDeleted_EvictsAtOnce(t *testing.T) {
	invalid := herr.New(context.Background(), domain.ErrInvalidAPIKey, nil)
	t.Run("foreground refresh of a stale entry", func(t *testing.T) {
		fetcher := &fakeConfigFetcher{cfgErr: invalid}
		fetcher.returns = []resolverReturn{{bundle: freshBundle("vk_gone", time.Now().Add(10*time.Minute))}}
		svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})
		rawKey := "vk-lw-gone-fg"
		svc.storeL1(hashKey(domain.PresentedKey{Token: rawKey}), bundleWithCreds("vk_gone", time.Now().Add(-30*time.Second), "cred-old"), "")

		_, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})

		require.ErrorIs(t, err, domain.ErrInvalidAPIKey)
		assert.Zero(t, svc.l1.Len(), "a deleted key gets no soft bump")
	})
	t.Run("proactive background refresh", func(t *testing.T) {
		fetcher := &fakeConfigFetcher{cfgErr: invalid}
		fetcher.returns = []resolverReturn{{bundle: freshBundle("vk_gone", time.Now().Add(10*time.Minute))}}
		svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})
		rawKey := "vk-lw-gone-bg"
		h := hashKey(domain.PresentedKey{Token: rawKey})
		svc.storeL1(h, bundleWithCreds("vk_gone", time.Now().Add(2*time.Minute), "cred-old"), "")

		svc.refreshBackground(domain.PresentedKey{Token: rawKey}, h)

		_, ok := svc.l1.Peek(h)
		assert.False(t, ok, "a deleted key is evicted by the background refresh too")
	})
}
