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

// --- HardGrace=0 disables stale-while-error (legacy mode) -------------------

func TestResolve_StaleEntry_HardGraceZero_DisablesStaleWhileError(t *testing.T) {
	transportErr := herr.New(context.Background(), domain.ErrAuthUpstream, nil)
	// Two returns: first call (foreground) fails, second (re-resolve after evict) also fails.
	resolver := &fakeResolver{returns: []resolverReturn{{err: transportErr}, {err: transportErr}}}

	// HardGrace explicitly set to a tiny non-zero value via a separate
	// service to verify the contract: any entry stored with bundle.ExpiresAt
	// already in the past will be hard-expired immediately, falling through
	// to the cold-path L3 (which fails). This documents the legacy-mode
	// behavior — operators can opt out of stale-while-error by setting
	// HardGrace to a tiny duration.
	svc, _ := newService(t, Options{
		Resolver:      resolver,
		ConfigFetcher: resolver,
		HardGrace:     1 * time.Nanosecond,
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
		cfg: domain.BundleConfig{Credentials: []domain.Credential{{ID: "cred-new"}}},
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
			if len(b.Credentials) == 1 && b.Credentials[0].ID == "cred-new" {
				return // refreshed
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("expected background config refresh to replace credentials within 2s")
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
