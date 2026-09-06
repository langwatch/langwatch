// Tests for the budget-period half of the config staleness refresh.
// Spec: specs/ai-gateway/auth-cache.feature, Rule "A budget period that ends
// invalidates the spend the gateway is holding".
package authresolver

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// budgetConfigFetcher answers with a config whose one budget carries `spent`
// and whose period ends at `validUntil`, recording the If-None-Match every
// fetch offered. Unlike etagConfigFetcher it keeps a budget on the config it
// returns, so a refresh does not silently clear the boundary under test.
type budgetConfigFetcher struct {
	fakeResolver

	mu         sync.Mutex
	etag       string
	spent      int64
	validUntil time.Time
	conds      []string
}

func (f *budgetConfigFetcher) FetchConfig(_ context.Context, _, ifNoneMatch string) (domain.ConfigFetchResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.conds = append(f.conds, ifNoneMatch)
	if ifNoneMatch != "" && ifNoneMatch == f.etag {
		return domain.ConfigFetchResult{ETag: f.etag, NotModified: true}, nil
	}
	return domain.ConfigFetchResult{
		ETag:   f.etag,
		Config: budgetConfig(f.spent, f.validUntil),
	}, nil
}

func (f *budgetConfigFetcher) conditionals() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.conds...)
}

// budgetConfig is a config carrying one blocking $5 budget.
func budgetConfig(spentMicroUSD int64, validUntil time.Time) domain.BundleConfig {
	return domain.BundleConfig{
		Budget: domain.BudgetConfig{
			Scopes: []domain.BudgetScope{{
				ID:            "budget_day",
				Scope:         "virtual_key",
				Window:        "day",
				LimitMicroUSD: 5_000_000,
				SpentMicroUSD: spentMicroUSD,
				OnBreach:      "block",
			}},
			ValidUntil: validUntil,
		},
	}
}

// seedBudgetEntry warms L1 with an exhausted budget whose period ends at
// validUntil, fetched a minute inside that period — the state a real entry is
// in when its period ends underneath it.
//
// The fetch instant matters: an entry already fetched past its boundary has
// asked its question, and the whole point of the one-shot rule is that it does
// not ask again. Stamping it here rather than leaving storeL1's `now` is what
// separates "the period ended after we read it" from "the boundary was already
// behind us". Never later than now, so a period still running does not leave
// the entry claiming a fetch in the future.
func seedBudgetEntry(t *testing.T, svc *Service, rawKey string, validUntil time.Time, etag string) *entry {
	t.Helper()
	bundle := freshBundle("vk_budget", time.Now().Add(1*time.Hour))
	bundle.Config = budgetConfig(5_000_000, validUntil)
	svc.storeL1(hashKey(rawKey), bundle, etag)
	e, ok := svc.l1.Peek(hashKey(rawKey))
	require.True(t, ok, "the seeded entry must be in L1")

	fetchedAt := validUntil.Add(-time.Minute)
	if now := time.Now(); fetchedAt.After(now) {
		fetchedAt = now
	}
	e.mu.Lock()
	e.configFetchedAt = fetchedAt
	e.mu.Unlock()
	return e
}

func newBudgetService(t *testing.T, fetcher *budgetConfigFetcher) *Service {
	t.Helper()
	svc, _ := newService(t, Options{
		Resolver:         &fetcher.fakeResolver,
		ConfigFetcher:    fetcher,
		ConfigTTL:        60 * time.Second,
		RefreshThreshold: time.Second, // keep the near-soft-expiry path out of the way
	})
	return svc
}

/** @scenario "the refresh at a period boundary asks for the config instead of confirming it" */
func TestResolve_BudgetPeriodRolled_RefreshesUnconditionally(t *testing.T) {
	tomorrow := time.Now().Add(24 * time.Hour)
	fetcher := &budgetConfigFetcher{etag: "42", spent: 0, validUntil: tomorrow}
	svc := newBudgetService(t, fetcher)

	rawKey := "vk-lw-budget-rolled"
	// Yesterday's period, spent up to the limit: the state a key is left in
	// by the block that stopped its last request.
	e := seedBudgetEntry(t, svc, rawKey, time.Now().Add(-time.Second), "42")

	_, err := svc.Resolve(context.Background(), rawKey)
	require.NoError(t, err)
	awaitConfigRefresh(t, e)

	assert.Equal(t, []string{""}, fetcher.conditionals(),
		"the token is built from the key's revision and providers, so offering it here would be answered 304 and pin yesterday's spend")

	live, ok := svc.l1.Peek(hashKey(rawKey))
	require.True(t, ok)
	assert.Equal(t, int64(0), live.bundle.Config.Budget.Scopes[0].SpentMicroUSD,
		"the new period's spend has to replace the old period's, or the key stays blocked on money it did not spend today")
	assert.Equal(t, tomorrow.Unix(), live.bundle.Config.Budget.ValidUntil.Unix(),
		"and the boundary has to move with it")
	assert.False(t, live.configStale(60*time.Second),
		"a config read inside the current period is not stale")
}

/** @scenario "a period still running is revalidated the ordinary way" */
func TestResolve_BudgetPeriodRunning_DoesNotForceRefresh(t *testing.T) {
	fetcher := &budgetConfigFetcher{etag: "42", spent: 0, validUntil: time.Now().Add(24 * time.Hour)}
	svc := newBudgetService(t, fetcher)

	rawKey := "vk-lw-budget-running"
	e := seedBudgetEntry(t, svc, rawKey, time.Now().Add(1*time.Hour), "42")

	// The claim is that the boundary alone triggers nothing, so the other half
	// of the staleness check has to be out of the way: assert the config is
	// inside its TTL rather than assume it.
	require.False(t, e.configStale(60*time.Second),
		"the entry must start fresh, or this proves nothing about the boundary")

	got, err := svc.Resolve(context.Background(), rawKey)
	require.NoError(t, err)

	assert.Empty(t, fetcher.conditionals(),
		"an exhausted budget inside its own period is a correct block, not a stale one: nothing to re-read")
	assert.Equal(t, int64(5_000_000), got.Config.Budget.Scopes[0].SpentMicroUSD)
}

/** @scenario "a boundary that is already behind the gateway is asked about once" */
func TestResolve_BudgetBoundaryLongPast_RefreshesOnce(t *testing.T) {
	// The refresh answers with the same past boundary, modeling a budget
	// whose stored instant simply never moves (a MANUAL window, a skewed
	// clock). Without the one-shot rule this is a fetch on every request for
	// as long as the entry lives.
	past := time.Now().Add(-72 * time.Hour)
	fetcher := &budgetConfigFetcher{etag: "42", spent: 0, validUntil: past}
	svc := newBudgetService(t, fetcher)

	rawKey := "vk-lw-budget-frozen"
	e := seedBudgetEntry(t, svc, rawKey, past, "42")

	for range 3 {
		_, err := svc.Resolve(context.Background(), rawKey)
		require.NoError(t, err)
		awaitConfigRefresh(t, e)
		live, ok := svc.l1.Peek(hashKey(rawKey))
		require.True(t, ok)
		e = live
	}

	assert.Equal(t, []string{""}, fetcher.conditionals(),
		"the first request re-reads the config; after that the entry has been fetched past the boundary and the ordinary clock takes over")
}

/** @scenario "a bundle with no budgets keeps the ordinary staleness clock" */
func TestResolve_NoBudgetBoundary_KeepsConditionalRefresh(t *testing.T) {
	fetcher := &budgetConfigFetcher{etag: "42", spent: 0}
	svc := newBudgetService(t, fetcher)

	rawKey := "vk-lw-budget-none"
	bundle := freshBundle("vk_nobudget", time.Now().Add(1*time.Hour))
	svc.storeL1(hashKey(rawKey), bundle, "42")

	_, err := svc.Resolve(context.Background(), rawKey)
	require.NoError(t, err)
	assert.Empty(t, fetcher.conditionals(), "a fresh config with no boundary is not stale")

	e := backdateConfig(t, svc, rawKey, 2*time.Minute)
	_, err = svc.Resolve(context.Background(), rawKey)
	require.NoError(t, err)
	awaitConfigRefresh(t, e)

	assert.Equal(t, []string{"42"}, fetcher.conditionals(),
		"past the TTL it still revalidates, so a key with no budget costs no extra materialization")
}
