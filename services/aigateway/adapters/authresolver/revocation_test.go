package authresolver

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

var errControlPlaneDown = errors.New("dial tcp: connection refused")

func orgBundle(vkID string, exp time.Time) *domain.Bundle {
	b := freshBundle(vkID, exp)
	b.OrganizationID = "org_1"
	return b
}

// hookResolver runs during a ResolveKey call, so a test can land a change-feed
// event while a resolve is in flight.
type hookResolver struct {
	bundle *domain.Bundle
	err    error
	during func()
	calls  int
}

func (r *hookResolver) ResolveKey(_ context.Context, _ domain.PresentedKey) (*domain.Bundle, error) {
	r.calls++
	if r.during != nil {
		r.during()
		r.during = nil
	}
	return r.bundle, r.err
}

func (r *hookResolver) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	return domain.ConfigFetchResult{}, nil
}

// @scenario "a revoked key is refused while the control plane is down"
func TestRevocation_RevokedKeyRefusedWhileControlPlaneDown(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-killed"}
	svc.storeL1(hashKey(key), orgBundle("vk_killed", time.Now().Add(-time.Minute)), "")

	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyRevoked, VirtualKeyID: "vk_killed"})

	for i := 0; i < 2; i++ {
		_, err := svc.Resolve(context.Background(), key)
		if !errors.Is(err, domain.ErrKeyRevoked) {
			t.Fatalf("attempt %d: want virtual_key_revoked, got %v", i, err)
		}
	}
}

// @scenario "a disabled key is refused while the control plane is down"
func TestRevocation_DisabledKeyAnswersDisabled(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-paused"}
	svc.storeL1(hashKey(key), orgBundle("vk_paused", time.Now().Add(time.Minute)), "")

	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: "vk_paused"})

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyDisabled) {
		t.Fatalf("want virtual_key_disabled, got %v", err)
	}
	res.calls = 0
	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyDisabled) {
		t.Fatalf("want virtual_key_disabled on the next request, got %v", err)
	}
	if res.calls != 0 {
		t.Fatalf("a denied key must be refused without a control-plane call; got %d calls", res.calls)
	}
}

// @scenario "a resolve that started before the revocation cannot put the key back"
func TestRevocation_InFlightResolveCannotResurrectKey(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_race", time.Now().Add(time.Hour))}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	res.during = func() {
		svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyRevoked, VirtualKeyID: "vk_race"})
	}
	key := domain.PresentedKey{Token: "vk-lw-race"}

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyRevoked) {
		t.Fatalf("want virtual_key_revoked for the racing resolve, got %v", err)
	}
	if svc.l1.Len() != 0 {
		t.Fatalf("the racing answer must not stay cached; L1 holds %d", svc.l1.Len())
	}
}

// @scenario "a key confirmed after its re-enable serves again"
func TestRevocation_KeyConfirmedAfterDenialServes(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_back", time.Now().Add(time.Hour))}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: "vk_back"})
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyEnabled, VirtualKeyID: "vk_back"})

	if _, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: "vk-lw-back"}); err != nil {
		t.Fatalf("a key the control plane confirmed after the denial must serve: %v", err)
	}
}

// @scenario "a normal key keeps serving from cache within the grace window"
func TestRevocation_NormalKeyServesStaleWhileControlPlaneDown(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-normal"}
	svc.storeL1(hashKey(key), orgBundle("vk_normal", time.Now().Add(-time.Minute)), "")
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyRevoked, VirtualKeyID: "vk_other"})

	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("a key nobody revoked must keep serving through the outage: %v", err)
	}
}

// @scenario "fail closed refuses a key nothing re-checked within the limit"
func TestRevocation_FailClosedRefusesUncheckedKey(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, FailClosedAfter: time.Minute})
	key := domain.PresentedKey{Token: "vk-lw-old"}
	h := hashKey(key)
	svc.publishL1(h, svc.newEntry(orgBundle("vk_old", time.Now().Add(time.Hour)), "").authFrom(time.Now().Add(-2*time.Minute)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)

	cursor.polledAt.Store(time.Now().UnixNano())
	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("a live change feed vouches for the key: %v", err)
	}

	cursor.polledAt.Store(time.Now().Add(-2 * time.Minute).UnixNano())
	_, err := svc.Resolve(context.Background(), key)
	if !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("want auth_upstream_unavailable once feed and key are both stale, got %v", err)
	}
	var refusal herr.E
	if !errors.As(err, &refusal) || !refusal.Retryable {
		t.Fatalf("a fail-closed refusal lifts when the control plane answers, so it must be retryable: %v", err)
	}
}

// @scenario "fail closed is off by default"
func TestRevocation_FailClosedOffByDefault(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-default"}
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle("vk_default", time.Now().Add(time.Hour)), "").authFrom(time.Now().Add(-3*time.Hour)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)
	cursor.polledAt.Store(time.Now().Add(-3 * time.Hour).UnixNano())

	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("with fail closed off the cached key serves: %v", err)
	}
}

type revocationMetrics struct {
	refusals    map[string]int
	staleServes map[string]int
}

func newRevocationMetrics() *revocationMetrics {
	return &revocationMetrics{refusals: map[string]int{}, staleServes: map[string]int{}}
}

func (m *revocationMetrics) RecordAuthCacheLookup()                  {}
func (m *revocationMetrics) RecordAuthCacheHit(string)               {}
func (m *revocationMetrics) RecordAuthCacheMiss(string)              {}
func (m *revocationMetrics) RecordAuthCacheRefusal(reason string)    { m.refusals[reason]++ }
func (m *revocationMetrics) RecordAuthCacheStaleServe(source string) { m.staleServes[source]++ }

// @scenario "a revoked key is refused while the control plane is down"
func TestRevocation_RefusalsAreCountedOnEveryPath(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	m := newRevocationMetrics()
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, Metrics: m})
	key := domain.PresentedKey{Token: "vk-lw-counted"}
	svc.storeL1(hashKey(key), orgBundle("vk_counted", time.Now().Add(-time.Minute)), "")
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyRevoked, VirtualKeyID: "vk_counted"})

	for i := 0; i < 2; i++ {
		if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyRevoked) {
			t.Fatalf("attempt %d: want virtual_key_revoked, got %v", i, err)
		}
	}
	if got := m.refusals["denied_vk_revoked"]; got != 2 {
		t.Fatalf("want 2 counted refusals, got %d (%v)", got, m.refusals)
	}
}

// @scenario "a revoked key is refused while the control plane is down"
func TestRevocation_LastKnownCredentialIsDenied(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-fallback"}
	h := hashKey(key)
	svc.lastKnown.Add(h, svc.newEntry(orgBundle("vk_fallback", time.Now().Add(time.Hour)), "").authFrom(time.Now()))

	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyRevoked, VirtualKeyID: "vk_fallback"})

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyRevoked) {
		t.Fatalf("a credential held only as an outage fallback must answer virtual_key_revoked, got %v", err)
	}
}

// @scenario "fail closed refuses a key nothing re-checked within the limit"
func TestRevocation_GateUsesTheAnswersOwnConfirmation(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &hookResolver{}, ConfigFetcher: &hookResolver{}, FailClosedAfter: time.Minute})
	b := orgBundle("vk_evicted", time.Now().Add(time.Hour))
	h := hashKey(domain.PresentedKey{Token: "vk-lw-evicted"})
	_, err := svc.admit(context.Background(), h, served{bundle: b, authStart: time.Now().Add(-2 * time.Minute)})
	if !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("an answer confirmed 2 minutes ago with a silent feed must be refused even with no L1 entry, got %v", err)
	}
}

// @scenario "fail closed refuses a key nothing re-checked within the limit"
func TestRevocation_RefusedStaleAnswerIsNotCountedAsServed(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	m := newRevocationMetrics()
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, Metrics: m, FailClosedAfter: time.Minute})
	key := domain.PresentedKey{Token: "vk-lw-stale"}
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle("vk_stale", time.Now().Add(-time.Minute)), "").authFrom(time.Now().Add(-2*time.Minute)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)
	cursor.polledAt.Store(time.Now().Add(-2 * time.Minute).UnixNano())

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("want auth_upstream_unavailable, got %v", err)
	}
	if len(m.staleServes) != 0 || m.refusals["fail_closed"] != 1 {
		t.Fatalf("a refused answer counts as a refusal, not a stale serve: stale=%v refusals=%v", m.staleServes, m.refusals)
	}
}

// @scenario "a key confirmed after its re-enable serves again"
func TestRevocation_RotationKeepsTheOldSecretValid(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_rotated", time.Now().Add(time.Hour))}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	res.during = func() {
		svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyRotated, VirtualKeyID: "vk_rotated"})
	}

	if _, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: "vk-lw-old-secret"}); err != nil {
		t.Fatalf("the old secret stays valid through the rotation grace: %v", err)
	}
}
