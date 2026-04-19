package auth

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// newMiniredisCache spins up an in-memory redis-compatible server
// and a Cache wired to it, so we can assert the L2 round-trip works
// against real RESP semantics (not a handwritten mock).
func newMiniredisCache(t *testing.T) (*Cache, *miniredis.Miniredis) {
	t.Helper()
	s := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: s.Addr()})
	c, err := NewCache(nil, slog.New(slog.NewTextHandler(io.Discard, nil)), CacheOptions{
		LRUSize: 1024,
		Redis:   client,
	})
	if err != nil {
		t.Fatal(err)
	}
	return c, s
}

func TestL2RoundTrip(t *testing.T) {
	c, _ := newMiniredisCache(t)
	ctx := context.Background()
	b := &Bundle{
		JWT: "jwt.token.here",
		JWTClaims: JWTClaims{
			VirtualKeyID: "vk_01", ProjectID: "proj_01", TeamID: "team_01",
			OrganizationID: "org_01", PrincipalID: "user_01",
			Revision: 7, ExpiresAt: time.Now().Add(10 * time.Minute).Unix(),
		},
		Config: &Config{
			VirtualKeyID:  "vk_01",
			Revision:      7,
			ModelsAllowed: []string{"gpt-5-mini"},
		},
		JWTExpiresAt:  time.Now().Add(10 * time.Minute),
		ResolvedAt:    time.Now(),
		DisplayPrefix: "lw_vk_live_01HZXABCD",
	}
	if err := c.writeL2(ctx, "deadbeef", b); err != nil {
		t.Fatalf("write: %v", err)
	}
	got, err := c.readL2(ctx, "deadbeef")
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if got == nil {
		t.Fatal("read returned nil")
	}
	if got.JWT != b.JWT || got.JWTClaims.VirtualKeyID != "vk_01" || got.DisplayPrefix != b.DisplayPrefix {
		t.Errorf("round-trip corrupted: %+v", got)
	}
	if got.Config == nil || got.Config.Revision != 7 {
		t.Errorf("config round-trip lost fields: %+v", got.Config)
	}
}

func TestL2MissReturnsNil(t *testing.T) {
	c, _ := newMiniredisCache(t)
	got, err := c.readL2(context.Background(), "no-such-key")
	if err != nil {
		t.Fatalf("miss must not error: %v", err)
	}
	if got != nil {
		t.Errorf("miss must return nil bundle, got %+v", got)
	}
}

func TestL2CorruptEntryGetsDropped(t *testing.T) {
	c, s := newMiniredisCache(t)
	// Write garbage directly to the backing store.
	if err := s.Set(l2Prefix+"bad", "not json"); err != nil {
		t.Fatal(err)
	}
	got, err := c.readL2(context.Background(), "bad")
	if err != nil || got != nil {
		t.Errorf("corrupt entry should return (nil, nil); got (%v, %v)", got, err)
	}
	if s.Exists(l2Prefix + "bad") {
		t.Error("corrupt entry should have been DEL'd")
	}
}

func TestL2TTLHonorsMinimum(t *testing.T) {
	c, s := newMiniredisCache(t)
	// JWT expires in 1s — TTL should clamp to l2MinTTL (30s) so the
	// caller can actually read it back.
	b := &Bundle{
		JWTClaims:    JWTClaims{VirtualKeyID: "vk_01"},
		JWTExpiresAt: time.Now().Add(1 * time.Second),
	}
	if err := c.writeL2(context.Background(), "short", b); err != nil {
		t.Fatal(err)
	}
	ttl := s.TTL(l2Prefix + "short")
	if ttl < 25*time.Second {
		t.Errorf("TTL floor should apply, got %s", ttl)
	}
}
