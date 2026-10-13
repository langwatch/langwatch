package authresolver

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// refreshCurrent runs the background auth refresh for the entry L1 holds now.
func refreshCurrent(svc *Service, key domain.PresentedKey, h [64]byte) {
	e, _ := svc.l1.Peek(h)
	svc.refreshBackground(key, h, e)
}

// gatedResolver holds every ResolveKey until release is closed and runs
// during (when set) while the call is in flight.
type gatedResolver struct {
	fakeResolver
	release chan struct{}
	during  func()
}

func (g *gatedResolver) ResolveKey(ctx context.Context, key domain.PresentedKey) (*domain.Bundle, error) {
	if g.during != nil {
		g.during()
	}
	<-g.release
	return g.fakeResolver.ResolveKey(ctx, key)
}

func TestNearExpiryCacheHits_StartOneBackgroundRefresh(t *testing.T) {
	r := &gatedResolver{release: make(chan struct{})}
	r.returns = []resolverReturn{{bundle: freshBundle("vk_hot", time.Now().Add(10*time.Minute))}}
	svc, _ := newService(t, Options{Resolver: r, ConfigFetcher: r})
	key := domain.PresentedKey{Token: "vk-lw-hot"}
	svc.storeL1(hashKey(key), freshBundle("vk_hot", time.Now().Add(30*time.Second)), "")

	for range 20 {
		_, err := svc.Resolve(context.Background(), key)
		require.NoError(t, err)
	}
	close(r.release)

	require.Eventually(t, func() bool { return r.calls.Load() >= 1 }, time.Second, 5*time.Millisecond)
	time.Sleep(50 * time.Millisecond)
	assert.Equal(t, int64(1), r.calls.Load(), "hot key hits share one in-flight refresh")
}

func TestBackgroundRefresh_KeepsAKeyEvictedMidRefreshEvicted(t *testing.T) {
	r := &gatedResolver{release: make(chan struct{})}
	close(r.release)
	r.returns = []resolverReturn{{bundle: freshBundle("vk_rev", time.Now().Add(10*time.Minute))}}
	svc, _ := newService(t, Options{Resolver: r, ConfigFetcher: r})
	key := domain.PresentedKey{Token: "vk-lw-rev"}
	h := hashKey(key)
	svc.storeL1(h, freshBundle("vk_rev", time.Now().Add(30*time.Second)), "")
	r.during = func() { svc.l1.Remove(h) }

	refreshCurrent(svc, key, h)

	_, ok := svc.l1.Peek(h)
	assert.False(t, ok, "a key revoked while its refresh was in flight stays out of the cache")
}

// stalledPoller never answers for org "slow" and answers at once for "fast".
type stalledPoller struct{ fastPolls atomic.Int64 }

func (p *stalledPoller) PollChanges(ctx context.Context, orgID, _ string) ([]CacheChange, string, error) {
	if orgID == "slow" {
		<-ctx.Done()
		return nil, "", ctx.Err()
	}
	p.fastPolls.Add(1)
	time.Sleep(5 * time.Millisecond)
	return nil, "1", nil
}

func TestChangeFeed_OneSlowOrgDoesNotDelayAnother(t *testing.T) {
	poller := &stalledPoller{}
	svc, _ := newService(t, Options{Resolver: &fakeResolver{}, ConfigFetcher: &fakeResolver{}, ChangePoller: poller})
	svc.activeOrgs.Store("slow", &orgCursor{since: "0"})
	svc.activeOrgs.Store("fast", &orgCursor{since: "0"})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go svc.changeFeedLoop(ctx)

	assert.Eventually(t, func() bool { return poller.fastPolls.Load() >= 3 }, 3*time.Second, 10*time.Millisecond,
		"each org's feed is polled on its own")
}
