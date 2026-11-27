package authresolver

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// slowResolver answers after a delay and is safe to call from many goroutines.
type slowResolver struct {
	bundle *domain.Bundle
	delay  time.Duration
	down   atomic.Bool
	calls  atomic.Int32
}

func (r *slowResolver) ResolveKey(ctx context.Context, _ domain.PresentedKey) (*domain.Bundle, error) {
	r.calls.Add(1)
	select {
	case <-time.After(r.delay):
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	if r.down.Load() {
		return nil, errControlPlaneDown
	}
	b := *r.bundle
	return &b, nil
}

func (r *slowResolver) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	if r.down.Load() {
		return domain.ConfigFetchResult{}, errControlPlaneDown
	}
	return domain.ConfigFetchResult{}, nil
}

func failClosedService(t *testing.T, res *slowResolver, key domain.PresentedKey, vkID string) *Service {
	t.Helper()
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res, FailClosedAfter: time.Minute})
	svc.publishL1(hashKey(key), svc.newEntry(orgBundle(vkID, time.Now().Add(time.Hour)), "", time.Now().Add(-2*time.Minute)))
	cur, _ := svc.activeOrgs.Load("org_1")
	cursor, _ := cur.(*orgCursor)
	cursor.polledAt.Store(monoStamp(-2 * time.Minute))
	return svc
}

// @scenario "concurrent requests wait for the fail closed key re-check"
func TestRevocation_FailClosedConcurrentRequestsShareOneRecheck(t *testing.T) {
	res := &slowResolver{bundle: orgBundle("vk_busy", time.Now().Add(time.Hour)), delay: 50 * time.Millisecond}
	key := domain.PresentedKey{Token: "vk-lw-busy"}
	svc := failClosedService(t, res, key, "vk_busy")

	var wg sync.WaitGroup
	var refused atomic.Int32
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.Resolve(context.Background(), key); err != nil {
				refused.Add(1)
			}
		}()
	}
	wg.Wait()
	if refused.Load() != 0 {
		t.Fatalf("a healthy control plane must serve every request, %d of 20 refused", refused.Load())
	}
	if res.calls.Load() != 1 {
		t.Fatalf("want one key check, got %d", res.calls.Load())
	}
}

// @scenario "a fail closed key re-check outlives the request that started it"
func TestRevocation_FailClosedRecheckOutlivesCancelledClient(t *testing.T) {
	res := &slowResolver{bundle: orgBundle("vk_gone_client", time.Now().Add(time.Hour)), delay: 30 * time.Millisecond}
	key := domain.PresentedKey{Token: "vk-lw-gone-client"}
	svc := failClosedService(t, res, key, "vk_gone_client")

	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(5*time.Millisecond, cancel)
	_, _ = svc.Resolve(ctx, key)
	time.Sleep(60 * time.Millisecond)

	if _, err := svc.Resolve(context.Background(), key); err != nil {
		t.Fatalf("the re-check finished after its client left and must serve the next request: %v", err)
	}
	if res.calls.Load() != 1 {
		t.Fatalf("want one key check, got %d", res.calls.Load())
	}
}

// @scenario "concurrent requests never serve a key after its revocation"
func TestRevocation_ConcurrentRevokeNeverServes(t *testing.T) {
	for round := 0; round < 20; round++ {
		res := &slowResolver{bundle: orgBundle("vk_race", time.Now().Add(time.Hour)), delay: time.Millisecond}
		svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
		key := domain.PresentedKey{Token: "vk-lw-race"}
		if _, err := svc.Resolve(context.Background(), key); err != nil {
			t.Fatalf("warm up: %v", err)
		}
		var revoked atomic.Bool
		var served atomic.Int32
		var wg sync.WaitGroup
		stop := make(chan struct{})
		for w := 0; w < 8; w++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for {
					select {
					case <-stop:
						return
					default:
					}
					after := revoked.Load()
					if _, err := svc.Resolve(context.Background(), key); err == nil && after {
						served.Add(1)
					}
				}
			}()
		}
		time.Sleep(2 * time.Millisecond)
		svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyRevoked, VirtualKeyID: "vk_race"})
		res.down.Store(true)
		revoked.Store(true)
		time.Sleep(10 * time.Millisecond)
		close(stop)
		wg.Wait()
		if served.Load() != 0 {
			t.Fatalf("round %d: %d requests that began after the revoke were served", round, served.Load())
		}
		svc.Stop()
	}
}

// @scenario "a held session ends on a denied key while the control plane is down"
func TestReadHeldKey_DeniedKeyReadsRevokedDuringOutage(t *testing.T) {
	res := &hookResolver{cfgErr: errControlPlaneDown}
	svc, _ := newService(t, Options{Resolver: res, ConfigFetcher: res})
	held := orgBundle("vk_voice", time.Now().Add(time.Hour))

	if _, err := svc.ReadHeldKey(context.Background(), held, ""); err == nil {
		t.Fatal("a key nobody denied must surface the outage, not a verdict")
	}
	svc.deny("vk_voice", ChangeKindVirtualKeyRevoked)
	got, err := svc.ReadHeldKey(context.Background(), held, "")
	if err != nil || !got.Revoked {
		t.Fatalf("a denied key must read as revoked during an outage, got revoked=%v err=%v", got.Revoked, err)
	}
}

// @scenario "a denial that lands during a confirmation is kept"
func TestRevocation_DenialDuringConfirmationIsKept(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &hookResolver{}, ConfigFetcher: &hookResolver{}})
	svc.deny("vk_twice", ChangeKindVirtualKeyRevoked)
	confirmationStart := time.Now()
	time.Sleep(time.Millisecond)
	svc.deny("vk_twice", ChangeKindVirtualKeyDisabled)

	d, kept := svc.liftDenialBefore("vk_twice", confirmationStart, "confirmation")
	if !kept || d.kind != ChangeKindVirtualKeyDisabled {
		t.Fatalf("the newer denial must survive, got kept=%v kind=%q", kept, d.kind)
	}
	if _, ok := svc.denied.Peek("vk_twice"); !ok {
		t.Fatal("the denial must still be listed")
	}
}

// @scenario "re-enabling a key forgets only its own denied credentials"
func TestRevocation_ReEnableForgetsOnlyItsCredentials(t *testing.T) {
	svc, _ := newService(t, Options{Resolver: &hookResolver{}, ConfigFetcher: &hookResolver{}})
	a, b := hashKey(domain.PresentedKey{Token: "vk-lw-a"}), hashKey(domain.PresentedKey{Token: "vk-lw-b"})
	svc.deny("vk_a", ChangeKindVirtualKeyDisabled)
	svc.deny("vk_b", ChangeKindVirtualKeyDisabled)
	svc.rememberDenied("vk_a", a)
	svc.rememberDenied("vk_b", b)

	svc.applyChange("org_1", CacheChange{Kind: ChangeKindVirtualKeyEnabled, VirtualKeyID: "vk_a"})

	if _, ok := svc.deniedKeys.Peek(a); ok {
		t.Fatal("vk_a's credential must be forgotten")
	}
	if _, ok := svc.deniedKeys.Peek(b); !ok {
		t.Fatal("vk_b's credential must stay denied")
	}
	if _, ok := svc.deniedByVK["vk_a"]; ok {
		t.Fatal("the index must drop vk_a")
	}
}
