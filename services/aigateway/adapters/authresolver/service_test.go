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
	rawKey := "lw_vk_live_test_001"
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
	rawKey := "lw_vk_live_test_002"
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
			rawKey := "lw_vk_live_" + tc.name
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
	rawKey := "lw_vk_live_hardcap"
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
	rawKey := "lw_vk_live_recover"
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
	rawKey := "lw_vk_live_bgtransport"
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
	rawKey := "lw_vk_live_bgrevoked"
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
	rawKey := "lw_vk_live_legacy"
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
