package auth

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"
)

type fakeResolver struct {
	resolveCalls atomic.Int32
	configCalls  atomic.Int32
	bundleFn     func(rawKey string) (*Bundle, error)
	configFn     func(vkID string, rev int64) (*Config, bool, error)
}

func (f *fakeResolver) ResolveKey(_ context.Context, rawKey string) (*Bundle, error) {
	f.resolveCalls.Add(1)
	if f.bundleFn != nil {
		return f.bundleFn(rawKey)
	}
	return &Bundle{
		JWT: "stub",
		JWTClaims: JWTClaims{
			VirtualKeyID: "vk_1", ProjectID: "p", TeamID: "t", OrganizationID: "o",
			Revision: 1, ExpiresAt: time.Now().Add(15 * time.Minute).Unix(),
		},
		Config:       &Config{VirtualKeyID: "vk_1", Revision: 1},
		JWTExpiresAt: time.Now().Add(15 * time.Minute),
		ResolvedAt:   time.Now(),
	}, nil
}
func (f *fakeResolver) FetchConfig(_ context.Context, vkID string, rev int64) (*Config, bool, error) {
	f.configCalls.Add(1)
	if f.configFn != nil {
		return f.configFn(vkID, rev)
	}
	return nil, false, nil
}
func (f *fakeResolver) WaitForChanges(_ context.Context, _ string, _ int64, _ time.Duration) ([]ChangeEvent, error) {
	return nil, nil
}
func (f *fakeResolver) VerifyJWT(_ string) (*JWTClaims, error) {
	return &JWTClaims{VirtualKeyID: "vk_1", ProjectID: "p", ExpiresAt: time.Now().Add(time.Minute).Unix()}, nil
}

func quietLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestCacheHitSkipsResolver(t *testing.T) {
	fr := &fakeResolver{}
	c, err := NewCache(fr, quietLogger(), CacheOptions{LRUSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Resolve(context.Background(), "lw_vk_live_foo"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Resolve(context.Background(), "lw_vk_live_foo"); err != nil {
		t.Fatal(err)
	}
	if got := fr.resolveCalls.Load(); got != 1 {
		t.Errorf("expected 1 resolve call, got %d", got)
	}
}

func TestCacheExpiredBundleTriggersResolve(t *testing.T) {
	fr := &fakeResolver{bundleFn: func(_ string) (*Bundle, error) {
		return &Bundle{
			JWTClaims: JWTClaims{
				VirtualKeyID: "vk_1", ProjectID: "p", Revision: 1,
				ExpiresAt: time.Now().Add(-time.Second).Unix(),
			},
			JWTExpiresAt: time.Now().Add(-time.Second),
			ResolvedAt:   time.Now(),
		}, nil
	}}
	c, _ := NewCache(fr, quietLogger(), CacheOptions{LRUSize: 10})
	_, _ = c.Resolve(context.Background(), "lw_vk_live_foo")
	_, _ = c.Resolve(context.Background(), "lw_vk_live_foo")
	if got := fr.resolveCalls.Load(); got != 2 {
		t.Errorf("expected expired bundle to re-resolve; got %d calls", got)
	}
}

func TestInvalidateByVirtualKeyID(t *testing.T) {
	fr := &fakeResolver{}
	c, _ := NewCache(fr, quietLogger(), CacheOptions{LRUSize: 10})
	_, _ = c.Resolve(context.Background(), "lw_vk_live_foo")
	c.InvalidateByVirtualKeyID("vk_1")
	_, _ = c.Resolve(context.Background(), "lw_vk_live_foo")
	if got := fr.resolveCalls.Load(); got != 2 {
		t.Errorf("expected invalidate to force re-resolve; got %d calls", got)
	}
}

func TestKnownRevisionTrackedOnResolve(t *testing.T) {
	fr := &fakeResolver{}
	c, _ := NewCache(fr, quietLogger(), CacheOptions{LRUSize: 10})
	if c.KnownRevision() != 0 {
		t.Fatalf("initial: %d", c.KnownRevision())
	}
	_, _ = c.Resolve(context.Background(), "lw_vk_live_foo")
	if c.KnownRevision() != 1 {
		t.Fatalf("after resolve: %d", c.KnownRevision())
	}
}

// newConfigNilBundle returns a bundle with Config=nil, matching real
// ResolveKey behavior (config is fetched separately via /config/:vk_id).
func newConfigNilBundle() *Bundle {
	return &Bundle{
		JWT: "stub",
		JWTClaims: JWTClaims{
			VirtualKeyID: "vk_1", ProjectID: "p", TeamID: "t", OrganizationID: "o",
			Revision: 1, ExpiresAt: time.Now().Add(15 * time.Minute).Unix(),
		},
		Config:       nil,
		JWTExpiresAt: time.Now().Add(15 * time.Minute),
		ResolvedAt:   time.Now(),
	}
}

func TestResolve_L1HitConfigNil_SelfHeals(t *testing.T) {
	configCallCount := atomic.Int32{}
	fr := &fakeResolver{
		bundleFn: func(_ string) (*Bundle, error) {
			return newConfigNilBundle(), nil
		},
		configFn: func(_ string, _ int64) (*Config, bool, error) {
			n := configCallCount.Add(1)
			if n == 1 {
				// First FetchConfig (eager on cold resolve) fails.
				return nil, false, errors.New("control plane unavailable")
			}
			// Second call (self-heal on L1 hit) succeeds.
			return &Config{VirtualKeyID: "vk_1", Revision: 1}, true, nil
		},
	}
	c, _ := NewCache(fr, quietLogger(), CacheOptions{LRUSize: 10})

	// First resolve fails because eager FetchConfig errors.
	_, err := c.Resolve(context.Background(), "lw_vk_live_foo")
	if err == nil {
		t.Fatal("expected error when eager config fetch fails")
	}

	// Second resolve: cold miss (nothing cached) → ResolveKey + FetchConfig succeeds.
	b, err := c.Resolve(context.Background(), "lw_vk_live_foo")
	if err != nil {
		t.Fatalf("second resolve should succeed: %v", err)
	}
	if b.Config == nil {
		t.Fatal("expected Config to be populated after self-heal")
	}
}

func TestResolve_ColdPath_ConfigFetchFailure_NotCached(t *testing.T) {
	fr := &fakeResolver{
		bundleFn: func(_ string) (*Bundle, error) {
			return newConfigNilBundle(), nil
		},
		configFn: func(_ string, _ int64) (*Config, bool, error) {
			return nil, false, errors.New("timeout")
		},
	}
	c, _ := NewCache(fr, quietLogger(), CacheOptions{LRUSize: 10})

	// Each resolve should re-attempt ResolveKey because Config=nil
	// bundles are not cached.
	_, _ = c.Resolve(context.Background(), "lw_vk_live_foo")
	_, _ = c.Resolve(context.Background(), "lw_vk_live_foo")

	if got := fr.resolveCalls.Load(); got != 2 {
		t.Errorf("expected 2 resolve calls (not cached); got %d", got)
	}
}

func TestRefreshInBackground_FetchesConfig(t *testing.T) {
	fr := &fakeResolver{
		// ResolveKey returns Config=nil (like the real resolver).
		bundleFn: func(_ string) (*Bundle, error) {
			return newConfigNilBundle(), nil
		},
		configFn: func(_ string, _ int64) (*Config, bool, error) {
			return &Config{VirtualKeyID: "vk_1", Revision: 2}, true, nil
		},
	}
	c, _ := NewCache(fr, quietLogger(), CacheOptions{LRUSize: 10})

	c.refreshInBackground("lw_vk_live_foo")

	// Verify the L1 entry has Config populated.
	h := keyHash("lw_vk_live_foo")
	b, ok := c.l1.Peek(h)
	if !ok {
		t.Fatal("expected L1 entry after refreshInBackground")
	}
	if b.Config == nil {
		t.Fatal("refreshInBackground must populate Config via FetchConfig")
	}
	if b.Config.Revision != 2 {
		t.Errorf("expected config revision 2, got %d", b.Config.Revision)
	}
}

func TestRefreshInBackground_CarriesForwardOldConfig(t *testing.T) {
	fr := &fakeResolver{
		bundleFn: func(_ string) (*Bundle, error) {
			return newConfigNilBundle(), nil
		},
		configFn: func(_ string, _ int64) (*Config, bool, error) {
			return nil, false, errors.New("timeout")
		},
	}
	c, _ := NewCache(fr, quietLogger(), CacheOptions{LRUSize: 10})

	// Pre-populate L1 with a bundle that has Config.
	h := keyHash("lw_vk_live_foo")
	oldConfig := &Config{VirtualKeyID: "vk_1", Revision: 5}
	c.l1.Add(h, &Bundle{
		JWTClaims:    JWTClaims{VirtualKeyID: "vk_1", ProjectID: "p", OrganizationID: "o", Revision: 1},
		Config:       oldConfig,
		JWTExpiresAt: time.Now().Add(15 * time.Minute),
	})

	c.refreshInBackground("lw_vk_live_foo")

	// Despite FetchConfig failing, the new bundle should carry forward
	// the old config instead of clobbering with nil.
	b, ok := c.l1.Peek(h)
	if !ok {
		t.Fatal("expected L1 entry")
	}
	if b.Config == nil {
		t.Fatal("refreshInBackground must carry forward old Config on fetch failure")
	}
	if b.Config.Revision != 5 {
		t.Errorf("expected carried-forward config revision 5, got %d", b.Config.Revision)
	}
}
