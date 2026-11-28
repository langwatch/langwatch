package authresolver

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Time is handled the way the rest of this package does it: the key's last
// confirmation and the feed's last answer are stamped two minutes back, past
// the default re-check limit, rather than waited for.

// @scenario "with the change feed down, a disabled or revoked key is refused within a minute"
func TestKeyRecheck_DisabledOrRevokedKeyIsRefusedWithTheFeedDown(t *testing.T) {
	for _, code := range []herr.Code{domain.ErrKeyDisabled, domain.ErrKeyRevoked} {
		t.Run(string(code), func(t *testing.T) {
			res := &hookResolver{bundle: orgBundle("vk_switched_off", time.Now().Add(time.Hour))}
			svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
			key := domain.PresentedKey{Token: "vk-lw-switched-off"}
			staleKeyCheck(t, svc, key, "vk_switched_off")
			res.bundle, res.err = nil, herr.New(context.Background(), code, nil)

			_, err := svc.Resolve(context.Background(), key)

			if !errors.Is(err, code) {
				t.Fatalf("a key switched off while the feed was down must be refused past the limit, got %v", err)
			}
			if res.calls != 1 {
				t.Fatalf("the refusal comes from one key check, got %d", res.calls)
			}
			if _, err := svc.Resolve(context.Background(), key); !errors.Is(err, code) {
				t.Fatalf("the refusal sticks for the next request, got %v", err)
			}
		})
	}
}

// @scenario "with the change feed and the control plane down, a cached key keeps serving"
func TestKeyRecheck_ControlPlaneDownKeepsServing(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-outage"}
	staleKeyCheck(t, svc, key, "vk_outage")

	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("a check that cannot reach the control plane keeps the outage grace: %v", err)
	}
}

// @scenario "a key the change feed vouches for is not re-checked"
func TestKeyRecheck_HealthyFeedAsksNothing(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-fed"}
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle("vk_fed", time.Now().Add(time.Hour)), "", time.Now().Add(-2*time.Minute)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)
	cursor.polledAt.Store(monoStamp(0))

	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("a key under a live feed serves: %v", err)
	}
	if res.calls != 0 {
		t.Fatalf("a live feed adds no key checks, got %d calls", res.calls)
	}
}

// @scenario "a key confirmed within the limit serves from the cache with no key check"
func TestKeyRecheck_RecentlyConfirmedKeyServesWithoutACheck(t *testing.T) {
	res := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-recent"}
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle("vk_recent", time.Now().Add(time.Hour)), "", time.Now()))

	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("a key confirmed just now serves: %v", err)
	}
	if res.calls != 0 {
		t.Fatalf("the request path asks the control plane nothing, got %d calls", res.calls)
	}
}

// @scenario "a negative key re-check limit turns the re-check off"
func TestKeyRecheck_NegativeLimitTurnsItOff(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_opted_out", time.Now().Add(time.Hour))}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, KeyRecheckAfter: -1})
	key := domain.PresentedKey{Token: "vk-lw-opted-out"}
	staleKeyCheck(t, svc, key, "vk_opted_out")
	res.bundle, res.err = nil, herr.New(context.Background(), domain.ErrKeyDisabled, nil)

	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("with the re-check off the cached key serves: %v", err)
	}
	if res.calls != 0 {
		t.Fatalf("with the re-check off nothing is asked, got %d calls", res.calls)
	}
}

// waitingCheck makes the key check block until the test ends, after running
// during; the request gives up through its own context (cancel).
func waitingCheck(t *testing.T, res *hookResolver, during func()) (context.Context, func()) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	res.during = func() {
		during()
		cancel()
		<-release
	}
	return ctx, cancel
}

// @scenario "a disable or revoke that lands while the key check waits is refused"
func TestKeyRecheck_RevokeDuringTheWaitIsRefused(t *testing.T) {
	res := &hookResolver{bundle: orgBundle("vk_mid_wait", time.Now().Add(time.Hour))}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-mid-wait"}
	staleKeyCheck(t, svc, key, "vk_mid_wait")
	ctx, cancel := waitingCheck(t, res, func() { svc.deny("vk_mid_wait", "revoked") })
	defer cancel()

	if _, err := svc.Resolve(ctx, key); !errors.Is(err, domain.ErrKeyRevoked) {
		t.Fatalf("a revoke that landed during the wait must refuse the request, got %v", err)
	}
}

// @scenario "a key whose expiration date passes while the key check waits is refused as expired"
func TestKeyRecheck_ExpiryDuringTheWaitIsRefused(t *testing.T) {
	expires := time.Now().Add(50 * time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	// Every control-plane call (the key check and any near-expiry refresh)
	// waits out the expiry, lets the request go, then blocks.
	res := &blockingResolver{hook: func() {
		time.Sleep(time.Until(expires) + 10*time.Millisecond)
		cancel()
		<-release
	}}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-expiring"}
	b := orgBundle("vk_expiring", time.Now().Add(time.Hour))
	b.VirtualKeyExpiresAt = expires
	svc.publishL1(hashKey(key), svc.newEntry(b, "", time.Now().Add(-2*time.Minute)))
	staleFeed(svc)

	if _, err := svc.Resolve(ctx, key); !errors.Is(err, domain.ErrKeyExpired) {
		t.Fatalf("a key that expired during the wait must be refused as expired, got %v", err)
	}
}

// @scenario "a previous secret whose grace ends while the key check waits is refused"
func TestKeyRecheck_SecretGraceEndingDuringTheWaitIsRefused(t *testing.T) {
	ends := time.Now().Add(50 * time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	res := &blockingResolver{hook: func() {
		time.Sleep(time.Until(ends) + 10*time.Millisecond)
		cancel()
		<-release
	}}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-rotated"}
	b := orgBundle("vk_rotated", time.Now().Add(time.Hour))
	b.SecretValidUntil = ends
	svc.publishL1(hashKey(key), svc.newEntry(b, "", time.Now().Add(-2*time.Minute)))
	staleFeed(svc)

	if _, err := svc.Resolve(ctx, key); !errors.Is(err, domain.ErrInvalidAPIKey) {
		t.Fatalf("a previous secret whose grace ended during the wait must be refused, got %v", err)
	}
}

// @scenario "a refusal that lands as the key check's wait ends is refused"
func TestKeyRecheck_RefusalReadyAsTheWaitEndsIsRefused(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &hookResolver{}, ConfigFetcher: &hookResolver{}})
	key := domain.PresentedKey{Token: "vk-lw-ready"}
	h := hashKey(key)
	staleKeyCheck(t, svc, key, "vk_ready")
	done := &reconfirmCall{done: make(chan struct{}), err: herr.New(context.Background(), domain.ErrKeyRevoked, nil)}
	close(done.done)
	svc.reconfirms[h] = done
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// The wait's end and the refusal are both ready: the refusal must win every time.
	for i := 0; i < 64; i++ {
		if _, err := svc.Resolve(ctx, key); !errors.Is(err, domain.ErrKeyRevoked) {
			t.Fatalf("attempt %d: a refusal ready as the wait ends must refuse the request, got %v", i, err)
		}
	}
}

// @scenario "a refusal that lands as the key check's wait ends is refused"
func TestKeyRecheck_RefusalRecordedBeforeTheCheckAnswersIsRefused(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &hookResolver{}, ConfigFetcher: &hookResolver{}})
	key := domain.PresentedKey{Token: "vk-lw-fenced"}
	h := hashKey(key)
	staleKeyCheck(t, svc, key, "vk_fenced")
	svc.reconfirms[h] = &reconfirmCall{done: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		time.Sleep(20 * time.Millisecond)
		svc.dropRejected(h, herr.New(context.Background(), domain.ErrKeyRevoked, nil))
		cancel()
	}()

	if _, err := svc.Resolve(ctx, key); !errors.Is(err, domain.ErrInvalidAPIKey) {
		t.Fatalf("a credential the check refused must not serve from the cache, got %v", err)
	}
}

// @scenario "a key check slower than the limit still serves its answer"
func TestKeyRecheck_SlowCheckStillServes(t *testing.T) {
	res := &hookResolver{
		bundle: orgBundle("vk_slow", time.Now().Add(time.Hour)),
		during: func() { time.Sleep(30 * time.Millisecond) },
	}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, KeyRecheckAfter: 10 * time.Millisecond})
	key := domain.PresentedKey{Token: "vk-lw-slow"}
	staleKeyCheck(t, svc, key, "vk_slow")

	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("a key the check just confirmed serves, however long the check took: %v", err)
	}
}

// @scenario "a fetch begun before the control plane refused a key cannot cache it again"
func TestKeyRecheck_RejectionFencesAnInFlightPublish(t *testing.T) {
	res := &hookResolver{}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	key := domain.PresentedKey{Token: "vk-lw-refused"}
	h := hashKey(key)
	staleKeyCheck(t, svc, key, "vk_refused")
	since := svc.fetchGeneration()

	svc.dropRejected(h, herr.New(context.Background(), domain.ErrKeyRevoked, nil))
	published := svc.publishFetched(h, svc.newEntry(orgBundle("vk_refused", time.Now().Add(time.Hour)), "", time.Now()), since)

	if _, cached := svc.l1.Peek(h); published || cached {
		t.Fatalf("a fetch begun before the refusal must not cache the key again")
	}
}

// staleFeed marks org_1's change feed as silent for two minutes.
func staleFeed(svc *Service) {
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)
	cursor.polledAt.Store(monoStamp(-2 * time.Minute))
}

// blockingResolver runs hook on every control-plane call, then reports the
// control plane down.
type blockingResolver struct{ hook func() }

func (r *blockingResolver) ResolveKey(context.Context, domain.PresentedKey) (*domain.Bundle, error) {
	r.hook()
	return nil, errControlPlaneDown
}

func (r *blockingResolver) FetchConfig(context.Context, string, string) (domain.ConfigFetchResult, error) {
	r.hook()
	return domain.ConfigFetchResult{}, errControlPlaneDown
}

// @scenario "a refusal recorded after a request read its cached key is refused"
func TestKeyRecheck_RefusalRecordedAfterTheCachedReadIsRefused(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &hookResolver{}, ConfigFetcher: &hookResolver{}})
	key := domain.PresentedKey{Token: "vk-lw-read-then-refused"}
	h := hashKey(key)
	staleKeyCheck(t, svc, key, "vk_read_then_refused")
	readAt := svc.fetchGeneration()
	e, _ := svc.l1.Peek(h)
	cached := served{bundle: e.bundle, authStart: e.authStart()}

	// Another request's check refuses the key and evicts it: none is left to join.
	svc.dropRejected(h, herr.New(context.Background(), domain.ErrKeyRevoked, nil))

	if _, err := svc.recheckKey(context.Background(), presentedKey{key: key, h: h, readAt: readAt}, cached); !errors.Is(err, domain.ErrInvalidAPIKey) {
		t.Fatalf("a refusal recorded after the cached answer was read must refuse it, got %v", err)
	}
}

// @scenario "a refusal recorded after a request read its cached key is refused"
func TestKeyRecheck_RefusalPushedOutOfTheStampsIsNotServedAsValid(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &hookResolver{}, ConfigFetcher: &hookResolver{}, LRUSize: 2})
	key := domain.PresentedKey{Token: "vk-lw-refusal-pushed-out"}
	h := hashKey(key)
	staleKeyCheck(t, svc, key, "vk_refusal_pushed_out")
	readAt := svc.fetchGeneration()
	e, _ := svc.l1.Peek(h)
	cached := served{bundle: e.bundle, authStart: e.authStart()}

	svc.dropRejected(h, herr.New(context.Background(), domain.ErrKeyRevoked, nil))
	// Unrelated changes push the refusal's stamp out of the bounded set.
	for _, id := range []string{"vk_other_1", "vk_other_2", "vk_other_3"} {
		svc.recordInvalidation(invalidation{keys: []string{keyScope(id)}}, func() {})
	}

	_, err := svc.recheckKey(context.Background(), presentedKey{key: key, h: h, readAt: readAt}, cached)
	if err == nil {
		t.Fatalf("a refusal whose stamp was pushed out must not let the cached answer serve")
	}
	if errors.Is(err, domain.ErrInvalidAPIKey) {
		t.Fatalf("an unknown refusal must not be reported as an invalid key, got %v", err)
	}
}

// @scenario "with the change feed and the control plane down, a cached key keeps serving"
func TestKeyRecheck_UnrelatedChangesKeepTheCachedAnswer(t *testing.T) {
	down := &hookResolver{err: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: down, ConfigFetcher: down, LRUSize: 2})
	key := domain.PresentedKey{Token: "vk-lw-unrelated-changes"}
	h := hashKey(key)
	staleKeyCheck(t, svc, key, "vk_unrelated_changes")
	readAt := svc.fetchGeneration()
	e, _ := svc.l1.Peek(h)
	cached := served{bundle: e.bundle, authStart: e.authStart()}

	for _, id := range []string{"vk_other_1", "vk_other_2"} {
		svc.recordInvalidation(invalidation{keys: []string{keyScope(id)}}, func() {})
	}

	if _, err := svc.recheckKey(context.Background(), presentedKey{key: key, h: h, readAt: readAt}, cached); err != nil {
		t.Fatalf("changes that never touched this key must keep its cached answer, got %v", err)
	}
}

// @scenario "a cached key whose hard cap passes while the key check waits is not served"
func TestKeyRecheck_AnswerPastItsHardCapDuringTheWaitIsNotServed(t *testing.T) {
	expires := time.Now().Add(50 * time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	res := &blockingResolver{hook: func() {
		time.Sleep(time.Until(expires) + 10*time.Millisecond)
		cancel()
		<-release
	}}
	// A negative grace puts the cap before the JWT expiry: fresh at the read,
	// past both once the wait ends.
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, HardGrace: -time.Second})
	key := domain.PresentedKey{Token: "vk-lw-past-cap"}
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle("vk_past_cap", expires), "", time.Now().Add(-2*time.Minute)))
	staleFeed(svc)

	if _, err := svc.Resolve(ctx, key); !errors.Is(err, domain.ErrAuthUpstream) {
		t.Fatalf("an answer past its expiry and hard cap after the wait must not serve, got %v", err)
	}
}
