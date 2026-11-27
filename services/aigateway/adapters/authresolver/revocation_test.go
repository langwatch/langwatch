package authresolver

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
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
	mu     sync.Mutex
	bundle *domain.Bundle
	err    error
	during func()
	calls  int
	cfgErr error
}

func (r *hookResolver) ResolveKey(_ context.Context, _ domain.PresentedKey) (*domain.Bundle, error) {
	r.mu.Lock()
	r.calls++
	during := r.during
	r.during = nil
	r.mu.Unlock()
	if during != nil {
		during()
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.bundle, r.err
}

func (r *hookResolver) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	return domain.ConfigFetchResult{}, r.cfgErr
}

// @scenario "a revoked key is refused while the control plane is down"
func TestRevocation_RevokedKeyRefusedWhileControlPlaneDown(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-killed"}
	seedL1(svc, hashKey(key), orgBundle("vk_killed", time.Now().Add(-time.Minute)), "")

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
	seedL1(svc, hashKey(key), orgBundle("vk_paused", time.Now().Add(time.Minute)), "")

	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: "vk_paused"})

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyDisabled) {
		t.Fatalf("want virtual_key_disabled, got %v", err)
	}
	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyDisabled) {
		t.Fatalf("want virtual_key_disabled on the next request, got %v", err)
	}
}

// @scenario "a key re-enabled and re-confirmed keeps serving through a later outage"
func TestRevocation_ReEnabledKeyServesThroughOutage(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_again", time.Now().Add(time.Hour))}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-again"}
	h := hashKey(key)
	seedL1(svc, h, orgBundle("vk_again", time.Now().Add(time.Hour)), "")

	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: "vk_again"})
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyEnabled, VirtualKeyID: "vk_again"})
	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("the re-confirmed key must serve: %v", err)
	}

	res.bundle, res.err = nil, errControlPlaneDown
	if denied := svc.refusalIfDenied(context.Background(), h); denied != nil {
		t.Fatalf("an outage after the re-enable must not answer the old denial: %v", denied)
	}
	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("the re-confirmed key must keep serving through the outage: %v", err)
	}
}

// @scenario "the background recheck lifts the denial when the control plane confirms the key"
func TestRevocation_RecheckClearsDenialAfterInterval(t *testing.T) {
	const interval = 50 * time.Millisecond
	res := &hookResolver{bundle: orgBundle("vk_missed", time.Now().Add(time.Hour))}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, DenialRecheckInterval: interval})
	key := domain.PresentedKey{Token: "vk-lw-missed"}
	h := hashKey(key)
	seedL1(svc, h, orgBundle("vk_missed", time.Now().Add(time.Hour)), "")
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: "vk_missed"})

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyDisabled) {
		t.Fatalf("a denied key must be refused before the interval: %v", err)
	}
	if res.calls != 0 {
		t.Fatalf("a refusal inside the interval must not call the control plane; got %d calls", res.calls)
	}
	time.Sleep(interval + 10*time.Millisecond)
	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyDisabled) {
		t.Fatalf("the request that starts the recheck is still refused locally: %v", err)
	}
	waitForRecheck(t, svc, h)
	if _, ok := svc.denied.Peek("vk_missed"); ok {
		t.Fatal("a recheck the control plane confirmed must lift the denial")
	}
	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("the key must serve after the recheck: %v", err)
	}
	res.bundle, res.err = nil, errControlPlaneDown
	if denied := svc.refusalIfDenied(context.Background(), h); denied != nil {
		t.Fatalf("an outage after the recheck must not answer the old denial: %v", denied)
	}
}

// @scenario "a denial that lands during a recheck is kept"
func TestRevocation_RecheckKeepsDenialThatLandsInFlight(t *testing.T) {
	const interval = 50 * time.Millisecond
	res := &hookResolver{bundle: orgBundle("vk_again", time.Now().Add(time.Hour))}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, DenialRecheckInterval: interval})
	key := domain.PresentedKey{Token: "vk-lw-again"}
	h := hashKey(key)
	seedL1(svc, h, orgBundle("vk_again", time.Now().Add(time.Hour)), "")
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: "vk_again"})
	time.Sleep(interval + 10*time.Millisecond)
	res.during = func() {
		time.Sleep(time.Millisecond)
		svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: "vk_again"})
	}

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyDisabled) {
		t.Fatalf("the request that starts the recheck is refused locally: %v", err)
	}
	waitForRecheck(t, svc, h)
	if res.calls != 1 {
		t.Fatalf("want one recheck call, got %d", res.calls)
	}
	if _, ok := svc.denied.Peek("vk_again"); !ok {
		t.Fatal("a denial newer than the recheck's confirmation must survive it")
	}
	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyDisabled) {
		t.Fatalf("the key stays refused after the recheck: %v", err)
	}
}

// @scenario "a re-enable on the change feed lifts the denial at once"
func TestRevocation_ReEnableClearsDenialAtOnce(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_flip", time.Now().Add(time.Hour))}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, DenialRecheckInterval: time.Hour})
	key := domain.PresentedKey{Token: "vk-lw-flip"}
	seedL1(svc, hashKey(key), orgBundle("vk_flip", time.Now().Add(time.Hour)), "")
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: "vk_flip"})
	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyDisabled) {
		t.Fatalf("want virtual_key_disabled before the re-enable, got %v", err)
	}

	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyEnabled, VirtualKeyID: "vk_flip"})
	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("the re-enabled key must serve at once: %v", err)
	}
}

// heldResolver holds every ResolveKey call until release closes, and counts them.
type heldResolver struct {
	release chan struct{}
	calls   atomic.Int64
}

func (r *heldResolver) ResolveKey(_ context.Context, _ domain.PresentedKey) (*domain.Bundle, error) {
	r.calls.Add(1)
	<-r.release
	return nil, errControlPlaneDown
}

func (r *heldResolver) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	return domain.ConfigFetchResult{}, nil
}

// @scenario "a denied key is refused locally with at most one recheck per interval"
func TestRevocation_DeniedKeyFloodMakesOneControlPlaneCall(t *testing.T) {
	const interval = 50 * time.Millisecond
	res := &heldResolver{release: make(chan struct{})}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, DenialRecheckInterval: interval})
	key := domain.PresentedKey{Token: "vk-lw-leaked"}
	h := hashKey(key)
	seedL1(svc, h, orgBundle("vk_leaked", time.Now().Add(time.Hour)), "")
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyDisabled, VirtualKeyID: "vk_leaked"})
	time.Sleep(interval + 10*time.Millisecond)

	var wg sync.WaitGroup
	var served atomic.Int64
	for i := 0; i < 1000; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyDisabled) {
				served.Add(1)
			}
		}()
	}
	wg.Wait()
	close(res.release)
	waitForRecheck(t, svc, h)
	if n := served.Load(); n != 0 {
		t.Fatalf("every request on the denied key must be refused; %d were not", n)
	}
	if n := res.calls.Load(); n > 1 {
		t.Fatalf("1000 requests in one interval must make at most 1 control-plane call; got %d", n)
	}
	if _, ok := svc.denied.Peek("vk_leaked"); !ok {
		t.Fatal("a failed recheck must keep the denial")
	}
}

func waitForRecheck(t *testing.T, svc *Service, h [64]byte) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		svc.rechecks.mu.Lock()
		st, _ := svc.rechecks.state.Peek(h)
		svc.rechecks.mu.Unlock()
		if !st.last.IsZero() && !st.running {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the denial recheck did not finish")
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
	seedL1(svc, hashKey(key), orgBundle("vk_normal", time.Now().Add(-time.Minute)), "")
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
	svc.publishL1(h, svc.newEntry(orgBundle("vk_old", time.Now().Add(time.Hour)), "", time.Now().Add(-2*time.Minute)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)

	cursor.polledAt.Store(monoStamp(0))
	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("a live change feed vouches for the key: %v", err)
	}

	cursor.polledAt.Store(monoStamp(-2 * time.Minute))
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
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle("vk_default", time.Now().Add(time.Hour)), "", time.Now().Add(-3*time.Hour)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)
	cursor.polledAt.Store(monoStamp(-3 * time.Hour))

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

// @scenario "a normal key keeps serving from cache within the grace window"
func TestRevocation_StaleServesAreCountedBySource(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	m := newRevocationMetrics()
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, Metrics: m})

	stale := domain.PresentedKey{Token: "vk-lw-stale-counted"}
	seedL1(svc, hashKey(stale), orgBundle("vk_stale", time.Now().Add(-time.Minute)), "")
	if _, err := svc.Resolve(context.Background(), stale); err != nil {
		t.Fatalf("a stale cached key must serve through the outage: %v", err)
	}

	fallback := domain.PresentedKey{Token: "vk-lw-last-known-counted"}
	svc.lastKnown.Add(hashKey(fallback), svc.newEntry(orgBundle("vk_last_known", time.Now().Add(time.Hour)), "", time.Now()))
	if _, err := svc.Resolve(context.Background(), fallback); err != nil {
		t.Fatalf("a last-known key must serve through the outage: %v", err)
	}

	if m.staleServes["stale_while_error"] != 1 || m.staleServes["last_known"] != 1 {
		t.Fatalf("want one stale_while_error and one last_known serve, got %v", m.staleServes)
	}
}

// @scenario "a revoked key is refused while the control plane is down"
func TestRevocation_RefusalsAreCountedOnEveryPath(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	m := newRevocationMetrics()
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, Metrics: m})
	key := domain.PresentedKey{Token: "vk-lw-counted"}
	seedL1(svc, hashKey(key), orgBundle("vk_counted", time.Now().Add(-time.Minute)), "")
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
	svc.lastKnown.Add(h, svc.newEntry(orgBundle("vk_fallback", time.Now().Add(time.Hour)), "", time.Now()))

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
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle("vk_stale", time.Now().Add(-time.Minute)), "", time.Now().Add(-2*time.Minute)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)
	cursor.polledAt.Store(monoStamp(-2 * time.Minute))

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("want auth_upstream_unavailable, got %v", err)
	}
	if len(m.staleServes) != 0 || m.refusals["fail_closed"] != 1 {
		t.Fatalf("a refused answer counts as a refusal, not a stale serve: stale=%v refusals=%v", m.staleServes, m.refusals)
	}
}

// @scenario "a rotation keeps the old secret valid"
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

// @scenario "a rotation keeps the old secret valid"
func TestRevocation_RotationDuringOutageIsNotADenial(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-rotated-outage"}
	seedL1(svc, hashKey(key), orgBundle("vk_rotated_outage", time.Now().Add(-time.Minute)), "")
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyRotated, VirtualKeyID: "vk_rotated_outage"})

	_, err := svc.Resolve(context.Background(), key)
	if errors.Is(err, domain.ErrKeyRevoked) || errors.Is(err, domain.ErrKeyDisabled) {
		t.Fatalf("a rotation must not answer the old secret with a terminal denial, got %v", err)
	}
	if err == nil || classifyRefreshError(err) != classTransportFailure {
		t.Fatalf("with the control plane down the old secret gets a retryable transport error, got %v", err)
	}
}

// @scenario "fail closed re-checks the key before it refuses"
func TestRevocation_FailClosedRechecksKeyBeforeRefusing(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_live", time.Now().Add(time.Hour))}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, FailClosedAfter: time.Minute})
	key := domain.PresentedKey{Token: "vk-lw-live"}
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle("vk_live", time.Now().Add(time.Hour)), "", time.Now().Add(-2*time.Minute)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)
	cursor.polledAt.Store(monoStamp(-2 * time.Minute))

	for i := 0; i < 3; i++ {
		if _, err := svc.Resolve(context.Background(), key); err != nil {
			t.Fatalf("request %d: a key the control plane just confirmed must serve: %v", i, err)
		}
	}
	if res.calls != 1 {
		t.Fatalf("want one key check, got %d", res.calls)
	}
}

// @scenario "fail closed paces its key re-checks during an outage"
func TestRevocation_FailClosedPacesRechecks(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, FailClosedAfter: time.Minute})
	key := domain.PresentedKey{Token: "vk-lw-down"}
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle("vk_down", time.Now().Add(time.Hour)), "", time.Now().Add(-2*time.Minute)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)
	cursor.polledAt.Store(monoStamp(-2 * time.Minute))

	for i := 0; i < 5; i++ {
		if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrAuthUpstream) {
			t.Fatalf("request %d: want auth_upstream_unavailable, got %v", i, err)
		}
	}
	if res.calls != 1 {
		t.Fatalf("want one key check per interval, got %d", res.calls)
	}
}

// @scenario "fail closed covers a key with no organization"
func TestRevocation_FailClosedCoversKeyWithoutOrganization(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, FailClosedAfter: time.Minute})
	key := domain.PresentedKey{Token: "vk-lw-orgless"}
	svc.publishL1(hashKey(key), svc.newEntry(freshBundle("vk_orgless", time.Now().Add(time.Hour)), "", time.Now().Add(-2*time.Minute)))

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("a key with no change feed past the limit must be refused, got %v", err)
	}
}

// staleKeyCheck marks key's cached entry and its org feed as older than the
// fail-closed limit.
func staleKeyCheck(t *testing.T, svc *Service, key domain.PresentedKey, vkID string) {
	t.Helper()
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle(vkID, time.Now().Add(time.Hour)), "", time.Now().Add(-2*time.Minute)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)
	cursor.polledAt.Store(monoStamp(-2 * time.Minute))
}

// @scenario "fail closed keeps the cached config when only the config fetch fails"
func TestRevocation_FailClosedRecheckKeepsCachedConfig(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_cfg", time.Now().Add(time.Hour)), cfgErr: errControlPlaneDown}
	m := newRevocationMetrics()
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, Metrics: m, FailClosedAfter: time.Minute})
	key := domain.PresentedKey{Token: "vk-lw-cfg"}
	staleKeyCheck(t, svc, key, "vk_cfg")
	before, _ := svc.l1.Peek(hashKey(key))

	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("a key the control plane just confirmed must serve its cached config: %v", err)
	}
	if m.refusals["fail_closed"] != 0 {
		t.Fatalf("a served request is no refusal, got %v", m.refusals)
	}
	after, ok := svc.l1.Peek(hashKey(key))
	if !ok || after.hardExpiresAt.After(before.hardExpiresAt) || time.Since(after.authStart()) > time.Minute {
		t.Fatalf("want the cached entry kept within its deadlines with a fresh key check")
	}
}

// @scenario "fail closed evicts a key its re-check rejects"
func TestRevocation_FailClosedRecheckRejectionEvicts(t *testing.T) {
	res := &hookResolver{}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, FailClosedAfter: time.Minute})
	res.err = herr.New(context.Background(), domain.ErrKeyRevoked, nil)
	key := domain.PresentedKey{Token: "vk-lw-rejected"}
	staleKeyCheck(t, svc, key, "vk_rejected")
	svc.lastKnown.Add(hashKey(key), svc.newEntry(orgBundle("vk_rejected", time.Now().Add(time.Hour)), "", time.Now()))

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyRevoked) {
		t.Fatalf("want virtual_key_revoked, got %v", err)
	}
	if _, ok := svc.l1.Peek(hashKey(key)); ok {
		t.Fatal("a rejected key must leave L1")
	}
	if _, ok := svc.lastKnown.Peek(hashKey(key)); ok {
		t.Fatal("a rejected key must leave the last-known store")
	}
}

// @scenario "the old secret ends when the control plane refuses it after the grace"
func TestRevocation_OldSecretEndsWhenGraceEnds(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_rot", time.Now().Add(time.Hour))}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-old-secret"}
	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyRotated, VirtualKeyID: "vk_rot"})
	seedL1(svc, hashKey(key), orgBundle("vk_rot", time.Now().Add(-time.Minute)), "")
	res.bundle, res.err = nil, herr.New(context.Background(), domain.ErrInvalidAPIKey, nil)

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrInvalidAPIKey) {
		t.Fatalf("the old secret past its grace must be refused, got %v", err)
	}
	if _, ok := svc.l1.Peek(hashKey(key)); ok {
		t.Fatal("the refused old secret must leave the cache")
	}
}

// @scenario "fail closed refuses a key that expired during its re-check"
func TestRevocation_FailClosedRecheckRefusesExpiredKey(t *testing.T) {
	expired := orgBundle("vk_exp", time.Now().Add(time.Hour))
	expired.VirtualKeyExpiresAt = time.Now().Add(-time.Millisecond)
	res := &hookResolver{bundle: expired, cfgErr: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, FailClosedAfter: time.Minute})
	key := domain.PresentedKey{Token: "vk-lw-exp"}
	staleKeyCheck(t, svc, key, "vk_exp")

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrKeyExpired) {
		t.Fatalf("want virtual_key_expired, got %v", err)
	}
}

// @scenario "fail closed does not serve cached config past its hard cap"
func TestRevocation_FailClosedRecheckSkipsDeadEntry(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_dead", time.Now().Add(time.Hour)), cfgErr: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, FailClosedAfter: time.Minute})
	key := domain.PresentedKey{Token: "vk-lw-dead"}
	staleKeyCheck(t, svc, key, "vk_dead")
	res.during = func() {
		dead := svc.newEntry(orgBundle("vk_dead", time.Now().Add(-time.Hour)), "", time.Now())
		dead.hardExpiresAt = time.Now().Add(-time.Second)
		svc.publishL1(hashKey(key), dead)
	}

	if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("an entry past its hard cap must not serve, got %v", err)
	}
}

// @scenario "fail closed refuses a key nothing re-checked within the limit"
func TestRevocation_FailClosedTreatsNeverPolledFeedAsSilent(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, FailClosedAfter: time.Minute})
	recent := domain.PresentedKey{Token: "vk-lw-recent"}
	old := domain.PresentedKey{Token: "vk-lw-unpolled"}
	svc.publishL1(hashKey(recent), svc.newEntry(orgBundle("vk_recent", time.Now().Add(time.Hour)), "", time.Now()))
	svc.publishL1(hashKey(old), svc.newEntry(orgBundle("vk_unpolled", time.Now().Add(time.Hour)), "", time.Now().Add(-2*time.Minute)))

	if _, err := svc.Resolve(context.Background(), recent); err != nil {
		t.Fatalf("a key confirmed within the limit serves before the first poll: %v", err)
	}
	if _, err := svc.Resolve(context.Background(), old); !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("a feed that never answered vouches for nothing, want auth_upstream_unavailable, got %v", err)
	}
}

// @scenario "a stale config serve counts the refresh as the fail closed key check"
func TestRevocation_ConfigFailureStaleServeKeepsFreshKeyCheck(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_stalecfg", time.Now().Add(time.Hour)), cfgErr: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, FailClosedAfter: time.Minute})
	key := domain.PresentedKey{Token: "vk-lw-stalecfg"}
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle("vk_stalecfg", time.Now().Add(-time.Second)), "", time.Now().Add(-2*time.Minute)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)
	cursor.polledAt.Store(monoStamp(-2 * time.Minute))

	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("a key the control plane just confirmed serves its stale config: %v", err)
	}
	if res.calls != 1 {
		t.Fatalf("the refresh confirmed the key, so admission needs no second check, got %d calls", res.calls)
	}
}
