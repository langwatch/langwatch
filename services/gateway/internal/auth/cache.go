package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/redis/go-redis/v9"
)

// Cache is the three-tier auth cache. L1 = in-mem LRU keyed by SHA-256 of
// the raw virtual key (never the raw key itself, to limit exposure if a heap
// dump leaks). L2 = optional Redis for cross-pod warmup. L3 = background
// refresh loop that re-resolves on a timer and listens to the control-plane
// /changes stream.
type Cache struct {
	l1     *lru.Cache[string, *Bundle]
	l2     redis.UniversalClient
	rv     Resolver
	logger *slog.Logger

	refreshInterval time.Duration
	jwtRefreshThreshold time.Duration

	// onBundleResolved is fired whenever a bundle is resolved fresh OR
	// its config refreshed in-place. Used by main.go to invalidate
	// per-VK rate limit buckets on revision bumps (and previously to
	// wire per-project OTLP endpoints, removed in Lane B iter 25).
	// Hook runs synchronously on the resolve path, so keep it cheap.
	onBundleResolved func(*Bundle)

	mu        sync.Mutex
	maxRev    int64 // global max — used for KnownRevision readiness probe
	// revByOrg tracks the highest revision we've observed PER organization.
	// Contract §4.3 requires /changes polls be scoped to a single org,
	// so we spawn one long-poll goroutine per observed org. A new org
	// that appears via ResolveKey triggers ensureOrgPoller.
	revByOrg     map[string]int64
	activeOrgs   map[string]context.CancelFunc
	changesCtx   context.Context
	stopCh       chan struct{}
	stoppedCh    chan struct{}
}

type CacheOptions struct {
	LRUSize             int
	RefreshInterval     time.Duration
	JWTRefreshThreshold time.Duration
	Redis               redis.UniversalClient
	// OnBundleResolved runs synchronously when a bundle is resolved or
	// its config is refreshed. Optional.
	OnBundleResolved    func(*Bundle)
}

func NewCache(rv Resolver, logger *slog.Logger, opts CacheOptions) (*Cache, error) {
	l1, err := lru.New[string, *Bundle](opts.LRUSize)
	if err != nil {
		return nil, err
	}
	if opts.RefreshInterval == 0 {
		opts.RefreshInterval = 60 * time.Second
	}
	if opts.JWTRefreshThreshold == 0 {
		opts.JWTRefreshThreshold = 5 * time.Minute
	}
	return &Cache{
		l1:                  l1,
		l2:                  opts.Redis,
		rv:                  rv,
		logger:              logger,
		refreshInterval:     opts.RefreshInterval,
		jwtRefreshThreshold: opts.JWTRefreshThreshold,
		onBundleResolved:    opts.OnBundleResolved,
		revByOrg:            make(map[string]int64),
		activeOrgs:          make(map[string]context.CancelFunc),
		stopCh:              make(chan struct{}),
		stoppedCh:           make(chan struct{}),
	}, nil
}

// notifyBundleResolved fires the hook (if any) whenever the cache has
// a bundle with a non-nil Config. Safe on nil hook / nil bundle.
func (c *Cache) notifyBundleResolved(b *Bundle) {
	if c == nil || c.onBundleResolved == nil || b == nil || b.Config == nil {
		return
	}
	c.onBundleResolved(b)
}

// keyHash hashes a raw api key — the cache never stores raw keys. 32 bytes
// hex-encoded.
func keyHash(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// Resolve returns a Bundle for the raw api key, hitting L1/L2/L3 in order.
// Misses trigger a resolve-key round trip.
func (c *Cache) Resolve(ctx context.Context, rawKey string) (*Bundle, error) {
	if rawKey == "" {
		return nil, ErrInvalidKey
	}
	h := keyHash(rawKey)
	if b, ok := c.l1.Get(h); ok && !b.Expired() {
		// Proactive background refresh if JWT is close to expiring.
		if b.NeedsRefresh(c.jwtRefreshThreshold) {
			go c.refreshInBackground(rawKey)
		}
		return b, nil
	}
	if c.l2 != nil {
		if b, err := c.readL2(ctx, h); err == nil && b != nil && !b.Expired() {
			c.l1.Add(h, b)
			return b, nil
		}
	}
	b, err := c.rv.ResolveKey(ctx, rawKey)
	if err != nil {
		return nil, err
	}
	c.l1.Add(h, b)
	if c.l2 != nil {
		_ = c.writeL2(ctx, h, b)
	}
	c.trackRevision(b.JWTClaims.OrganizationID, b.JWTClaims.Revision)
	c.ensureOrgPoller(b.JWTClaims.OrganizationID)
	c.notifyBundleResolved(b)
	return b, nil
}

// Invalidate removes a specific key from L1 and L2.
func (c *Cache) Invalidate(ctx context.Context, rawKey string) {
	h := keyHash(rawKey)
	c.l1.Remove(h)
	if c.l2 != nil {
		_ = c.l2.Del(ctx, "gw:auth:"+h).Err()
	}
}

// InvalidateByVirtualKeyID removes every L1 entry whose bundle matches the
// given vk_id. L2 is a content-addressed cache so we can't target it by vk;
// entries fall out on expiry.
func (c *Cache) InvalidateByVirtualKeyID(vkID string) {
	for _, h := range c.l1.Keys() {
		if b, ok := c.l1.Peek(h); ok && b.JWTClaims.VirtualKeyID == vkID {
			c.l1.Remove(h)
		}
	}
}

// Start launches the background refresh loop. Blocks until Stop is called.
// The /changes long-poll is NOT started here — it spins up a goroutine
// per organization lazily, triggered by the first ResolveKey for that
// org. This keeps idle gateways silent and lets us scope each long-poll
// to one org per contract §4.3.
func (c *Cache) Start(ctx context.Context) {
	c.changesCtx = ctx
	go c.refreshLoop(ctx)
	// Signal the "done" channel on ctx cancellation so Stop() unblocks.
	go func() {
		select {
		case <-ctx.Done():
		case <-c.stopCh:
		}
		close(c.stoppedCh)
	}()
}

// Stop signals the background loops to exit and waits briefly.
func (c *Cache) Stop() {
	close(c.stopCh)
	select {
	case <-c.stoppedCh:
	case <-time.After(2 * time.Second):
	}
}

func (c *Cache) refreshLoop(ctx context.Context) {
	t := time.NewTicker(c.refreshInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopCh:
			return
		case <-t.C:
			c.refreshAll(ctx)
		}
	}
}

// ensureOrgPoller spins up one long-poll goroutine per organization
// the gateway has observed a VK for. Idempotent — calling it with an
// org that's already being polled is a no-op. The goroutine's ctx is
// a child of c.changesCtx so Stop() cascades.
func (c *Cache) ensureOrgPoller(orgID string) {
	if orgID == "" || c.changesCtx == nil {
		return
	}
	c.mu.Lock()
	if _, running := c.activeOrgs[orgID]; running {
		c.mu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(c.changesCtx)
	c.activeOrgs[orgID] = cancel
	c.mu.Unlock()
	go c.orgChangesLoop(ctx, orgID)
}

func (c *Cache) orgChangesLoop(ctx context.Context, orgID string) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopCh:
			return
		default:
		}
		sinceRev := c.revisionForOrg(orgID)
		events, err := c.rv.WaitForChanges(ctx, orgID, sinceRev, 25*time.Second)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			c.logger.Warn("changes long-poll error",
				"org_id", orgID, "err", err, "since", sinceRev)
			time.Sleep(2 * time.Second)
			continue
		}
		for _, ev := range events {
			c.logger.Info("change event",
				"org_id", orgID, "vk_id", ev.VirtualKeyID,
				"revision", ev.NewRevision, "kind", ev.Kind)
			c.InvalidateByVirtualKeyID(ev.VirtualKeyID)
			c.trackRevision(orgID, ev.NewRevision)
		}
	}
}

func (c *Cache) refreshAll(ctx context.Context) {
	// For each cached bundle close to expiry, re-resolve. We store by hash,
	// so we need to refresh via FetchConfig using vk_id + revision. Hot
	// bundles with fresh JWT are skipped.
	for _, h := range c.l1.Keys() {
		b, ok := c.l1.Peek(h)
		if !ok {
			continue
		}
		if !b.NeedsRefresh(c.jwtRefreshThreshold) {
			continue
		}
		// We don't have the raw key to re-resolve; the only path open is
		// waiting for the next inbound request on that key, which will hit
		// the miss path and re-resolve. We can however refresh the *config*
		// half proactively so when the next request arrives, config is up
		// to date.
		newCfg, changed, err := c.rv.FetchConfig(ctx, b.JWTClaims.VirtualKeyID, b.JWTClaims.Revision)
		if err != nil {
			c.logger.Debug("config refresh error", "vk_id", b.JWTClaims.VirtualKeyID, "err", err)
			continue
		}
		if changed && newCfg != nil {
			b.Config = newCfg
			c.l1.Add(h, b)
			c.trackRevision(b.JWTClaims.OrganizationID, newCfg.Revision)
			c.notifyBundleResolved(b)
		}
	}
}

func (c *Cache) refreshInBackground(rawKey string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	b, err := c.rv.ResolveKey(ctx, rawKey)
	if err != nil {
		c.logger.Debug("background refresh error", "err", err)
		return
	}
	h := keyHash(rawKey)
	c.l1.Add(h, b)
	if c.l2 != nil {
		_ = c.writeL2(ctx, h, b)
	}
	c.trackRevision(b.JWTClaims.OrganizationID, b.JWTClaims.Revision)
	c.ensureOrgPoller(b.JWTClaims.OrganizationID)
}

// trackRevision bumps the per-org cursor AND the global maxRev (the
// latter still powers the KnownRevision readiness check). orgID may
// be empty for the bootstrap path where we've observed a revision
// but not yet the org it belongs to — the global maxRev still ticks.
func (c *Cache) trackRevision(orgID string, rev int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if rev > c.maxRev {
		c.maxRev = rev
	}
	if orgID != "" {
		if rev > c.revByOrg[orgID] {
			c.revByOrg[orgID] = rev
		}
	}
}

func (c *Cache) revisionForOrg(orgID string) int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.revByOrg[orgID]
}

func (c *Cache) snapshotMaxRev() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.maxRev
}

// --- L2 (Redis) helpers. Serialized as JSON with a TTL matching JWT exp.

const l2Prefix = "gw:auth:"

// l2MinTTL is the floor we apply to Redis TTLs so a bundle about to
// expire doesn't land with a ~0s TTL and get deleted before the
// caller can read it back.
const l2MinTTL = 30 * time.Second

func (c *Cache) readL2(ctx context.Context, h string) (*Bundle, error) {
	if c.l2 == nil {
		return nil, nil
	}
	raw, err := c.l2.Get(ctx, l2Prefix+h).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}
	b := &Bundle{}
	if err := json.Unmarshal(raw, b); err != nil {
		// Corrupt entry; don't fail the resolve, just drop it and
		// the next writeL2 will overwrite with a fresh bundle.
		c.logger.Warn("l2_decode_failed", "key_hash", h, "err", err.Error())
		_ = c.l2.Del(ctx, l2Prefix+h).Err()
		return nil, nil
	}
	return b, nil
}

func (c *Cache) writeL2(ctx context.Context, h string, b *Bundle) error {
	if c.l2 == nil || b == nil {
		return nil
	}
	ttl := time.Until(b.JWTExpiresAt)
	if ttl < l2MinTTL {
		ttl = l2MinTTL
	}
	raw, err := json.Marshal(b)
	if err != nil {
		return err
	}
	return c.l2.Set(ctx, l2Prefix+h, raw, ttl).Err()
}

// KnownRevision exposes the highest revision the cache has observed — used
// by readiness probes to confirm we've made at least one round trip.
func (c *Cache) KnownRevision() int64 {
	return c.snapshotMaxRev()
}
