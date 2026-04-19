package auth

import (
	"context"
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
func (f *fakeResolver) FetchConfig(_ context.Context, _ string, _ int64) (*Config, bool, error) {
	f.configCalls.Add(1)
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
