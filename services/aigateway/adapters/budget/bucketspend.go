package budget

import (
	"context"
	"sync"
	"time"
)

// BucketSpendFetcher is the control-plane call behind the cached reader.
// The controlplane.Client satisfies it.
type BucketSpendFetcher interface {
	BudgetBucketSpend(ctx context.Context, budgetID, endUserID string) (int64, error)
}

// CachedBucketSpend is the BucketSpendReader the checker enforces
// attributed-user templates through: a short-TTL per-(budget, end user)
// cache over the control plane's bucket-spend read. The TTL bounds the
// enforcement lag the same way the bundle's own spend snapshot does;
// a fetch error reports ok=false and the checker allows, matching the
// permissive-on-error doctrine everywhere else on this path.
type CachedBucketSpend struct {
	fetcher BucketSpendFetcher
	ttl     time.Duration
	timeout time.Duration

	mu      sync.Mutex
	entries map[string]bucketEntry
}

type bucketEntry struct {
	spentMicroUSD int64
	fetchedAt     time.Time
}

const (
	// DefaultBucketSpendTTL bounds how stale a per-user figure can be on
	// the enforcement path. Matches the order of the bundle's own
	// change-event refresh cadence rather than trying to beat it.
	DefaultBucketSpendTTL = 15 * time.Second
	// DefaultBucketFetchTimeout keeps a cold-cache fetch from holding the
	// request hostage: past it the checker allows and the next request
	// finds the figure warm.
	DefaultBucketFetchTimeout = 300 * time.Millisecond
	// maxBucketEntries caps the cache so an adversarial id stream cannot
	// grow it unbounded; eviction is wholesale reset, cheapest correct
	// thing at this size.
	maxBucketEntries = 10_000
)

func NewCachedBucketSpend(fetcher BucketSpendFetcher) *CachedBucketSpend {
	return &CachedBucketSpend{
		fetcher: fetcher,
		ttl:     DefaultBucketSpendTTL,
		timeout: DefaultBucketFetchTimeout,
		entries: map[string]bucketEntry{},
	}
}

func (c *CachedBucketSpend) BucketSpendMicroUSD(
	ctx context.Context,
	budgetID, endUserID string,
) (int64, bool) {
	key := budgetID + "\x00" + endUserID
	now := time.Now()

	c.mu.Lock()
	entry, hit := c.entries[key]
	c.mu.Unlock()
	if hit && now.Sub(entry.fetchedAt) < c.ttl {
		return entry.spentMicroUSD, true
	}

	fetchCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	spent, err := c.fetcher.BudgetBucketSpend(fetchCtx, budgetID, endUserID)
	if err != nil {
		// A stale figure beats no figure: enforce against the expired
		// entry rather than allowing outright when we have one.
		if hit {
			return entry.spentMicroUSD, true
		}
		return 0, false
	}

	c.mu.Lock()
	if len(c.entries) >= maxBucketEntries {
		c.entries = map[string]bucketEntry{}
	}
	c.entries[key] = bucketEntry{spentMicroUSD: spent, fetchedAt: now}
	c.mu.Unlock()
	return spent, true
}
