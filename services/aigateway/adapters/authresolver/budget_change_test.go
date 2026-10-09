package authresolver

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/adapters/budget"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// spendControlPlane is a control plane whose resolve-key can be held open and
// whose config reports whatever spend the test last set.
type spendControlPlane struct {
	fakeResolver
	gate    chan struct{}
	entered atomic.Int64

	mu    sync.Mutex
	spent int64
}

func (c *spendControlPlane) ResolveKey(ctx context.Context, key domain.PresentedKey) (*domain.Bundle, error) {
	c.entered.Add(1)
	if c.gate != nil {
		<-c.gate
	}
	return c.fakeResolver.ResolveKey(ctx, key)
}

func (c *spendControlPlane) FetchConfig(_ context.Context, _, _ string) (domain.ConfigFetchResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return domain.ConfigFetchResult{Config: projectBudgetConfig(c.spent)}, nil
}

func (c *spendControlPlane) setSpent(spent int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.spent = spent
}

const budgetLimitMicroUSD = 1_000_000

func projectBudgetConfig(spent int64) domain.BundleConfig {
	return domain.BundleConfig{
		Credentials: []domain.Credential{{ID: "cred-1"}},
		Budget: domain.BudgetConfig{Scopes: []domain.BudgetScope{{
			ID: "budget-1", Scope: "project", ScopeID: "proj-1", Window: "month",
			LimitMicroUSD: budgetLimitMicroUSD, SpentMicroUSD: spent, OnBreach: "block",
		}}},
	}
}

func projectBundle(vkID string) *domain.Bundle {
	b := freshBundle(vkID, time.Now().Add(10*time.Minute))
	b.OrganizationID = "org-1"
	b.ProjectID = "proj-1"
	return b
}

// seedProjectKey caches a key of proj-1 whose budget has spent nothing.
func seedProjectKey(t *testing.T, svc *Service, rawKey string) [64]byte {
	t.Helper()
	h := hashKey(domain.PresentedKey{Token: rawKey})
	b := projectBundle("vk_" + rawKey)
	b.Config = projectBudgetConfig(0)
	b.Credentials = b.Config.Credentials
	svc.storeL1(h, b, "etag-1")
	return h
}

func spentOf(b *domain.Bundle) int64 { return b.Config.Budget.Scopes[0].SpentMicroUSD }

// awaitRefreshed waits for the entry under h to be replaced by one carrying spent.
func awaitRefreshed(t *testing.T, svc *Service, h [64]byte, spent int64) *entry {
	t.Helper()
	var cur *entry
	require.Eventually(t, func() bool {
		e, ok := svc.l1.Peek(h)
		if !ok || spentOf(e.bundle) != spent {
			return false
		}
		cur = e
		return true
	}, 2*time.Second, 2*time.Millisecond)
	return cur
}

// @scenario "a debit's budget update does not hold the next request"
func TestBudgetUpdated_NextRequestServesFromCacheWithoutWaiting(t *testing.T) {
	cp := &spendControlPlane{gate: make(chan struct{})}
	cp.returns = []resolverReturn{{bundle: projectBundle("vk_hold")}}
	svc, _ := newService(t, Options{Resolver: cp, ConfigFetcher: cp, RefreshThreshold: time.Second})
	rawKey := "vk-lw-hold"
	h := seedProjectKey(t, svc, rawKey)
	cached, _ := svc.l1.Peek(h)

	svc.applyChange("org-1", CacheChange{Kind: ChangeKindBudgetUpdated, ProjectID: "proj-1"})
	cur, ok := svc.l1.Peek(h)
	require.True(t, ok, "a budget update keeps the key cached")
	require.Same(t, cached, cur)

	// The control plane is held: a blocking resolve would never return.
	done := make(chan *domain.Bundle, 1)
	go func() {
		got, err := svc.Resolve(context.Background(), domain.PresentedKey{Token: rawKey})
		assert.NoError(t, err)
		done <- got
	}()
	select {
	case got := <-done:
		assert.Same(t, cached.bundle, got, "the cached bundle serves while the refresh runs")
	case <-time.After(time.Second):
		t.Fatal("the request waited on the control plane after a budget update")
	}
	require.Eventually(t, func() bool { return cp.entered.Load() == 1 }, time.Second, 2*time.Millisecond,
		"the request started one background refresh")
	close(cp.gate)
}

// @scenario "the background refresh replaces the bundle with the new spend"
func TestBudgetUpdated_BackgroundRefreshReplacesTheBundle(t *testing.T) {
	cp := &spendControlPlane{}
	cp.returns = []resolverReturn{{bundle: projectBundle("vk_swap")}}
	svc, _ := newService(t, Options{Resolver: cp, ConfigFetcher: cp, RefreshThreshold: time.Second})
	rawKey := "vk-lw-swap"
	key := domain.PresentedKey{Token: rawKey}
	h := seedProjectKey(t, svc, rawKey)

	cp.setSpent(400_000)
	svc.applyChange("org-1", CacheChange{Kind: ChangeKindBudgetUpdated, ProjectID: "proj-1"})
	_, err := svc.Resolve(context.Background(), key)
	require.NoError(t, err)

	fresh := awaitRefreshed(t, svc, h, 400_000)
	assert.Zero(t, fresh.budgetChangeCount(), "the replacement is caught up")

	got, err := svc.Resolve(context.Background(), key)
	require.NoError(t, err)
	assert.Equal(t, int64(400_000), spentOf(got))
	time.Sleep(20 * time.Millisecond)
	assert.Equal(t, int64(1), cp.calls.Load(), "a caught-up entry asks the control plane nothing more")
}

// @scenario "a key the refresh finds past its limit is refused on the next request"
func TestBudgetUpdated_RefreshThatBreachesTheLimitRefusesTheNextRequest(t *testing.T) {
	cp := &spendControlPlane{}
	cp.returns = []resolverReturn{{bundle: projectBundle("vk_breach")}}
	svc, _ := newService(t, Options{Resolver: cp, ConfigFetcher: cp, RefreshThreshold: time.Second})
	rawKey := "vk-lw-breach"
	key := domain.PresentedKey{Token: rawKey}
	h := seedProjectKey(t, svc, rawKey)
	checker := budget.NewChecker(budget.CheckerOptions{})

	cp.setSpent(budgetLimitMicroUSD + 1)
	svc.applyChange("org-1", CacheChange{Kind: ChangeKindBudgetUpdated, ProjectID: "proj-1"})
	served, err := svc.Resolve(context.Background(), key)
	require.NoError(t, err)
	decision, err := checker.Precheck(context.Background(), served)
	require.NoError(t, err)
	assert.Equal(t, domain.BudgetAllow, decision.Verdict, "the request that starts the refresh is judged on the spend it had")

	awaitRefreshed(t, svc, h, budgetLimitMicroUSD+1)
	next, err := svc.Resolve(context.Background(), key)
	require.NoError(t, err)
	decision, err = checker.Precheck(context.Background(), next)
	require.NoError(t, err)
	require.Equal(t, domain.BudgetBlock, decision.Verdict)
	assert.Equal(t, "budget-1", decision.BlockedBy.ID)
}

// @scenario "a budget update that lands while the refresh is running is not lost"
func TestBudgetUpdated_DuringRefresh_MarksTheReplacement(t *testing.T) {
	cp := &spendControlPlane{gate: make(chan struct{})}
	cp.returns = []resolverReturn{{bundle: projectBundle("vk_race")}}
	svc, _ := newService(t, Options{Resolver: cp, ConfigFetcher: cp, RefreshThreshold: time.Second})
	rawKey := "vk-lw-race"
	key := domain.PresentedKey{Token: rawKey}
	h := seedProjectKey(t, svc, rawKey)

	cp.setSpent(100_000)
	svc.applyChange("org-1", CacheChange{Kind: ChangeKindBudgetUpdated, ProjectID: "proj-1"})
	_, err := svc.Resolve(context.Background(), key)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return cp.entered.Load() == 1 }, time.Second, 2*time.Millisecond)

	svc.applyChange("org-1", CacheChange{Kind: ChangeKindBudgetUpdated, ProjectID: "proj-1"})
	close(cp.gate)

	fresh := awaitRefreshed(t, svc, h, 100_000)
	assert.NotZero(t, fresh.budgetChangeCount(), "the second update may postdate what the refresh read")
}

// @scenario "a budget update without a project marks the organization's keys"
func TestBudgetUpdated_WithoutProject_MarksTheOrganizationOnly(t *testing.T) {
	resolver := &fakeResolver{}
	svc, _ := newService(t, Options{Resolver: resolver, ConfigFetcher: resolver})
	sameOrg := hashKey(domain.PresentedKey{Token: "vk-lw-org-1"})
	otherOrg := hashKey(domain.PresentedKey{Token: "vk-lw-org-2"})
	svc.storeL1(sameOrg, &domain.Bundle{OrganizationID: "org-1"}, "")
	svc.storeL1(otherOrg, &domain.Bundle{OrganizationID: "org-2"}, "")

	svc.applyChange("org-1", CacheChange{Kind: ChangeKindBudgetUpdated})

	same, ok := svc.l1.Peek(sameOrg)
	require.True(t, ok, "a budget update evicts nothing")
	other, ok := svc.l1.Peek(otherOrg)
	require.True(t, ok)
	assert.NotZero(t, same.budgetChangeCount())
	assert.Zero(t, other.budgetChangeCount())
}

// @scenario "a budget refresh the control plane cannot answer keeps the key serving"
func TestBudgetUpdated_FailedRefresh_KeepsServingAndRetriesPaced(t *testing.T) {
	cp := &spendControlPlane{}
	cp.returns = []resolverReturn{{err: context.DeadlineExceeded}}
	svc, _ := newService(t, Options{Resolver: cp, ConfigFetcher: cp, RefreshThreshold: time.Second})
	rawKey := "vk-lw-down"
	key := domain.PresentedKey{Token: rawKey}
	h := seedProjectKey(t, svc, rawKey)
	e, _ := svc.l1.Peek(h)

	svc.applyChange("org-1", CacheChange{Kind: ChangeKindBudgetUpdated, ProjectID: "proj-1"})
	_, err := svc.Resolve(context.Background(), key)
	require.NoError(t, err)
	require.Eventually(t, func() bool {
		e.mu.Lock()
		defer e.mu.Unlock()
		return cp.calls.Load() == 1 && !e.authRefreshing
	}, time.Second, 2*time.Millisecond)

	for range 10 {
		got, err := svc.Resolve(context.Background(), key)
		require.NoError(t, err, "the cached bundle keeps serving")
		assert.Equal(t, "cred-1", got.Credentials[0].ID)
	}
	time.Sleep(20 * time.Millisecond)
	assert.Equal(t, int64(1), cp.calls.Load(), "a failed refresh is retried after a pause, not on every request")
	assert.NotZero(t, e.budgetChangeCount(), "the change stays pending until a refresh lands")
}
