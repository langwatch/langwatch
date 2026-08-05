package authresolver

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// bundleWithCreds builds a bundle carrying one credential, the shape a
// healthy org resolves to.
func bundleWithCreds(vkID string, exp time.Time, credID string) *domain.Bundle {
	b := freshBundle(vkID, exp)
	b.Credentials = []domain.Credential{{ID: credID}}
	return b
}

// @scenario "config fetch fails on a cold miss -> retryable error, nothing cached"
func TestResolve_ColdMiss_ConfigFetchFailure_FailsClosedAndCachesNothing(t *testing.T) {
	fetcher := &fakeConfigFetcher{
		cfg:    domain.BundleConfig{Credentials: []domain.Credential{{ID: "cred-good"}}},
		cfgErr: errors.New("config fetch returned 502"),
	}
	fetcher.returns = []resolverReturn{
		{bundle: freshBundle("vk_cold", time.Now().Add(10*time.Minute))},
	}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})

	_, err := svc.Resolve(context.Background(), "vk-lw-cold")
	if err == nil {
		t.Fatal("expected a failure when the config fetch fails on a cold miss")
	}
	if !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("expected auth_upstream_unavailable (retryable), got %v", err)
	}
	if svc.l1.Len() != 0 {
		t.Fatalf("a config-less bundle must not be cached; L1 holds %d entries", svc.l1.Len())
	}

	// Control plane recovers: the retry succeeds and serves real credentials.
	fetcher.cfgErr = nil
	bundle, err := svc.Resolve(context.Background(), "vk-lw-cold")
	if err != nil {
		t.Fatalf("expected recovery once the config fetch works: %v", err)
	}
	if len(bundle.Credentials) != 1 || bundle.Credentials[0].ID != "cred-good" {
		t.Fatalf("expected the recovered bundle to carry credentials, got %+v", bundle.Credentials)
	}
}

// @scenario "config fetch succeeds with zero credentials -> the real no-provider answer stands"
func TestResolve_ColdMiss_EmptyCredentialsFromControlPlane_IsCachedAndServed(t *testing.T) {
	fetcher := &fakeConfigFetcher{cfg: domain.BundleConfig{}}
	fetcher.returns = []resolverReturn{
		{bundle: freshBundle("vk_noprov", time.Now().Add(10*time.Minute))},
	}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})

	bundle, err := svc.Resolve(context.Background(), "vk-lw-noprov")
	if err != nil {
		t.Fatalf("a successfully fetched empty config is a valid resolution: %v", err)
	}
	if len(bundle.Credentials) != 0 {
		t.Fatalf("expected zero credentials, got %+v", bundle.Credentials)
	}
	if svc.l1.Len() != 1 {
		t.Fatalf("the legitimately empty bundle should be cached; L1 holds %d entries", svc.l1.Len())
	}
}

// @scenario "config fetch fails during a stale-entry refresh -> stale credentials keep serving"
func TestResolve_StaleEntry_ConfigFetchFailure_ServesStaleCredentials(t *testing.T) {
	fetcher := &fakeConfigFetcher{
		cfgErr: errors.New("config fetch returned 503"),
	}
	fetcher.returns = []resolverReturn{
		{bundle: freshBundle("vk_stale", time.Now().Add(10*time.Minute))},
	}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})

	rawKey := "vk-lw-stale"
	h := hashKey(rawKey)
	svc.storeL1(h, bundleWithCreds("vk_stale", time.Now().Add(-30*time.Second), "cred-old"))

	bundle, err := svc.Resolve(context.Background(), rawKey)
	if err != nil {
		t.Fatalf("expected the stale bundle to serve: %v", err)
	}
	if len(bundle.Credentials) != 1 || bundle.Credentials[0].ID != "cred-old" {
		t.Fatalf("expected the stale credentials to keep serving, got %+v", bundle.Credentials)
	}

	e, ok := svc.l1.Get(h)
	if !ok {
		t.Fatal("expected the stale entry to remain in L1")
	}
	if len(e.bundle.Credentials) != 1 || e.bundle.Credentials[0].ID != "cred-old" {
		t.Fatalf("the config-less fresh bundle must not replace the entry; L1 now holds %+v", e.bundle.Credentials)
	}
}

// The hard-cap tail of the stale-refresh path: when the stale entry has
// burnt its whole grace window and the config fetch still fails, the
// caller gets the retryable auth_upstream_unavailable, not the ResolveKey
// nil error. Unbound on purpose: the bound scenario above describes the
// keep-serving outcome, and this test asserts the opposite tail of it.
func TestResolve_StaleEntryAtHardCap_ConfigFetchFailure_FailsRetryable(t *testing.T) {
	fetcher := &fakeConfigFetcher{
		cfgErr: errors.New("config fetch returned 503"),
	}
	fetcher.returns = []resolverReturn{
		{bundle: freshBundle("vk_capped", time.Now().Add(10*time.Minute))},
	}
	svc, _ := newService(t, Options{
		Resolver:      &fetcher.fakeResolver,
		ConfigFetcher: fetcher,
		HardGrace:     1 * time.Nanosecond,
	})

	rawKey := "vk-lw-capped"
	seedExpiredEntry(t, svc, rawKey, "vk_capped", 30*time.Second)

	_, err := svc.Resolve(context.Background(), rawKey)
	if err == nil {
		t.Fatal("expected a failure once the hard grace cap is exhausted")
	}
	if !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("expected auth_upstream_unavailable (retryable), got %v", err)
	}
}

// @scenario "config fetch fails during a proactive background refresh -> the healthy entry survives"
func TestRefreshBackground_ConfigFetchFailure_KeepsExistingEntry(t *testing.T) {
	fetcher := &fakeConfigFetcher{
		cfg:    domain.BundleConfig{Credentials: []domain.Credential{{ID: "cred-new"}}},
		cfgErr: errors.New("config fetch timed out"),
	}
	fetcher.returns = []resolverReturn{
		{bundle: freshBundle("vk_bg", time.Now().Add(10*time.Minute))},
	}
	svc, _ := newService(t, Options{Resolver: &fetcher.fakeResolver, ConfigFetcher: fetcher})

	rawKey := "vk-lw-bg"
	h := hashKey(rawKey)
	svc.storeL1(h, bundleWithCreds("vk_bg", time.Now().Add(5*time.Minute), "cred-old"))

	svc.refreshBackground(rawKey, h)

	e, ok := svc.l1.Get(h)
	if !ok {
		t.Fatal("expected the healthy entry to survive the failed refresh")
	}
	if len(e.bundle.Credentials) != 1 || e.bundle.Credentials[0].ID != "cred-old" {
		t.Fatalf("the config-less bundle must not replace the healthy entry, got %+v", e.bundle.Credentials)
	}

	// Control plane recovers: the next refresh replaces the entry for real.
	fetcher.cfgErr = nil
	svc.refreshBackground(rawKey, h)
	e, ok = svc.l1.Get(h)
	if !ok {
		t.Fatal("expected the refreshed entry in L1")
	}
	if len(e.bundle.Credentials) != 1 || e.bundle.Credentials[0].ID != "cred-new" {
		t.Fatalf("expected the recovered refresh to install fresh credentials, got %+v", e.bundle.Credentials)
	}
}
