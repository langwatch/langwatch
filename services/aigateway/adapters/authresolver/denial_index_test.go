package authresolver

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// tokenResolver answers each presented secret with its own bundle, the way
// resolve-key signs the current and the previous secret of a rotated key.
type tokenResolver struct {
	bundles map[string]*domain.Bundle
	down    atomic.Bool
}

func (r *tokenResolver) ResolveKey(_ context.Context, key domain.PresentedKey) (*domain.Bundle, error) {
	if r.down.Load() {
		return nil, errControlPlaneDown
	}
	b := *r.bundles[key.Token]
	return &b, nil
}

func (r *tokenResolver) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	return domain.ConfigFetchResult{}, nil
}

// @scenario "The current secret keeps its own expiry during a rotation grace"
func TestRevocation_CurrentSecretOutlivesTheRotationGrace(t *testing.T) {
	graceEnd := time.Now().Add(80 * time.Millisecond)
	old := orgBundle("vk_rot", time.Now().Add(time.Hour))
	old.VirtualKeyExpiresAt = graceEnd
	current := orgBundle("vk_rot", time.Now().Add(time.Hour))
	res := &tokenResolver{bundles: map[string]*domain.Bundle{"vk-lw-old": old, "vk-lw-new": current}}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	for _, tok := range []string{"vk-lw-old", "vk-lw-new"} {
		if _, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: tok}); err != nil {
			t.Fatalf("%s must serve inside the grace: %v", tok, err)
		}
	}
	time.Sleep(time.Until(graceEnd) + 20*time.Millisecond)
	res.down.Store(true)

	if _, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: "vk-lw-new"}); err != nil {
		t.Fatalf("the current secret must keep serving after the grace ends, got %v", err)
	}
	if _, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: "vk-lw-old"}); !errors.Is(err, domain.ErrKeyExpired) {
		t.Fatalf("the old secret must end with the grace, got %v", err)
	}
}

// @scenario "a flood of credentials on a denied key keeps the denied list bounded"
func TestRevocation_DeniedFloodKeepsOneEntryPerCredential(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-leaked"}
	h := hashKey(key)
	seedL1(svc, h, orgBundle("vk_leaked", time.Now().Add(time.Hour)), "")
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyRevoked, VirtualKeyID: "vk_leaked"})

	for i := 0; i < 5000; i++ {
		if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyRevoked) {
			t.Fatalf("request %d on the revoked key must be refused, got %v", i, err)
		}
		svc.dropAndCountDenied(h, "vk_leaked", "revoked")
	}
	for i := 0; i < 5000; i++ {
		svc.rememberDenied("vk_leaked", hashKey(domain.PresentedKey{Token: fmt.Sprintf("vk-lw-%d", i)}))
	}
	svc.denyMu.Lock()
	n := len(svc.deniedByVK["vk_leaked"])
	svc.denyMu.Unlock()
	if n > maxDeniedCredentialsPerKey {
		t.Fatalf("a flood must not grow the denied credential index past %d, got %d", maxDeniedCredentialsPerKey, n)
	}
	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyRevoked) {
		t.Fatalf("the first credential stays denied after the flood, got %v", err)
	}
}

// @scenario "a re-enable on the change feed lifts the denial at once"
func TestRevocation_EveryLiftLogsDenialCleared(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_back", time.Now().Add(time.Hour))}
	core, logs := observer.New(zap.InfoLevel)
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, Logger: zap.New(core)})
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: "vk_back"})
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyEnabled, VirtualKeyID: "vk_back"})
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: "vk_back"})
	if _, kept := svc.liftDenialBefore("vk_back", time.Now().Add(time.Second), "confirmation"); kept {
		t.Fatal("a confirmation after the denial must lift it")
	}
	got := map[string]bool{}
	for _, e := range logs.FilterMessage("auth_cache_denial_cleared").All() {
		got[fmt.Sprint(e.ContextMap()["source"])] = true
	}
	if !got["re_enable"] || !got["confirmation"] {
		t.Fatalf("both lifts must log auth_cache_denial_cleared, got sources %v", got)
	}
}
