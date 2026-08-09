// Package authresolver resolves virtual-key bearer tokens into domain.Bundle
// via a three-tier cache (L1 in-memory LRU → L2 optional store → L3 upstream resolver).
//
// Stale-while-error: when a cached L1 entry crosses its natural JWT expiry
// AND the upstream refresh fails for transport reasons (network error, dial
// timeout, 5xx, connection refused, malformed response, JWT verify failure),
// the entry's soft expiry is bumped by SoftBump and the cached bundle keeps
// serving, up to a hard cap (JWT exp + HardGrace). Any auth-class rejection
// (401/403/404) evicts immediately — bad credentials get no grace window.
// See specs/ai-gateway/auth-cache.feature, Rule "Cached JWT serves
// stale-while-error past natural expiry on transport failure".
package authresolver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// CachedBundle is what an L2 store holds: the bundle plus the moment its
// config was fetched from the control plane. The timestamp travels with the
// value because L2 is shared across nodes, and a node rehydrating an entry
// has to inherit the config's real age. Stamping the rehydrate moment
// instead would restart the ConfigTTL clock on every L2 hit.
type CachedBundle struct {
	// Bundle is the cached resolution result.
	Bundle *domain.Bundle
	// ConfigFetchedAt is when the config baked into Bundle was fetched. The
	// zero value means unknown, which every reader must treat as stale now:
	// a value we cannot date is one we cannot vouch for.
	ConfigFetchedAt time.Time
}

// L2Store is an optional second-level cache (e.g., Redis) shared by every
// gateway node. DeleteMany is what makes a change-feed eviction reach the
// other nodes' shared copy; without it an evicted entry is rehydrated from L2
// on the very next request, still carrying the config the event invalidated.
// It takes a batch because an org-wide eviction is thousands of keys, and one
// round trip per key would spend the whole budget on latency.
type L2Store interface {
	Get(ctx context.Context, hash string) (*CachedBundle, error)
	Set(ctx context.Context, hash string, cached CachedBundle)
	DeleteMany(ctx context.Context, hashes []string) error
}

// KeyResolver resolves a raw API key into a Bundle via an upstream source.
type KeyResolver interface {
	ResolveKey(ctx context.Context, rawKey string) (*domain.Bundle, error)
}

// ConfigFetcher retrieves configuration for a virtual key.
type ConfigFetcher interface {
	FetchConfig(ctx context.Context, vkID string) (domain.BundleConfig, error)
}

// ChangeKind discriminates the cache-invalidation triggers the gateway
// listens for. Kept as a sealed string set so callers can switch
// exhaustively without leaking control-plane internals into this package.
const (
	ChangeKindProviderBindingUpdated = "MODEL_PROVIDER_UPDATED"
	ChangeKindBudgetCreated          = "BUDGET_CREATED"
	ChangeKindBudgetUpdated          = "BUDGET_UPDATED"
	ChangeKindBudgetDeleted          = "BUDGET_DELETED"
	ChangeKindVirtualKeyCreated      = "VK_CREATED"
	ChangeKindVirtualKeyConfigUpdate = "VK_CONFIG_UPDATED"
	ChangeKindVirtualKeyRotated      = "VK_ROTATED"
	ChangeKindVirtualKeyRevoked      = "VK_REVOKED"
	ChangeKindVirtualKeyDisabled     = "VK_DISABLED"
	ChangeKindVirtualKeyEnabled      = "VK_ENABLED"
	ChangeKindRoutingPolicyUpdated   = "ROUTING_POLICY_UPDATED"
	ChangeKindRoutingPolicyDeleted   = "ROUTING_POLICY_DELETED"
	ChangeKindCacheRuleCreated       = "CACHE_RULE_CREATED"
	ChangeKindCacheRuleUpdated       = "CACHE_RULE_UPDATED"
	ChangeKindCacheRuleDeleted       = "CACHE_RULE_DELETED"
)

// CacheChange is one cache-invalidation hint surfaced by ChangePoller.
// Mirrors the wire shape from the control plane's /changes endpoint.
type CacheChange struct {
	Kind            string
	VirtualKeyID    string
	BudgetID        string
	ModelProviderID string
	ProjectID       string
	Revision        string
}

// ChangePoller is the upstream that streams cache-invalidation events
// per organization. Returns the events buffered since `since`, the
// org's current revision (caller advances cursor), and any error.
type ChangePoller interface {
	PollChanges(ctx context.Context, organizationID, since string) ([]CacheChange, string, error)
}

// Service is the three-tier auth resolver.
// CacheMetrics counts how well the key cache is serving. Declared here
// rather than imported so the resolver stays free of a metrics
// dependency; the gateway's Prometheus recorder satisfies it.
type CacheMetrics interface {
	RecordAuthCacheLookup()
	RecordAuthCacheHit(tier string)
	RecordAuthCacheMiss(tier string)
}

// Cache tier names reported on the auth-cache metrics.
const (
	tierL1      = "l1"
	tierL2Redis = "l2_redis"
)

// l2DeleteTimeout bounds one chunk of L2 deletions, not the whole batch: a
// budget shared across an org-wide eviction would expire part way through and
// abandon every key after that point, which is the opposite of a safeguard.
// Generous enough for a slow store, short enough that the poll loop keeps
// moving when the store is gone.
const l2DeleteTimeout = 5 * time.Second

// l2DeleteChunkSize is how many keys go in one DeleteMany call. Big enough
// that an org-wide eviction is a handful of round trips, small enough that one
// command does not block the store's single thread on a huge argument list.
const l2DeleteChunkSize = 256

type Service struct {
	l1            *lru.Cache[[64]byte, *entry]
	l2            L2Store
	resolver      KeyResolver
	configFetcher ConfigFetcher
	changePoller  ChangePoller
	logger        *zap.Logger
	metrics       CacheMetrics

	refreshThreshold time.Duration
	softBump         time.Duration
	hardGrace        time.Duration
	configTTL        time.Duration

	// Active orgs whose bundles are currently in L1. Populated on every
	// storeL1, never cleared explicitly — entries that drop out of L1 via
	// LRU pressure are still safe to poll for; the next request for that
	// org refreshes via the normal resolve path. Used by the change-feed
	// loop to know which org cursors to advance. sync.Map (not a regular
	// map + RWMutex) because polling reads + storeL1 writes interleave.
	activeOrgs sync.Map // key: orgID string, value: *orgCursor

	stopCh chan struct{}
}

// orgCursor holds the change-event revision the loop has caught up to
// for one organization. Mutated only inside the change-feed loop.
type orgCursor struct {
	since string
}

// entry tracks both the natural JWT exp ("soft" expiry, bumpable on
// transport failure) and the absolute hard cap. softExpiresAt is mutable;
// hardExpiresAt is set once at insert time and never changes.
type entry struct {
	mu            sync.Mutex
	bundle        *domain.Bundle
	softExpiresAt time.Time
	hardExpiresAt time.Time
	// configFetchedAt drives the config-staleness refresh: the bundle's
	// auth (JWT exp) can outlive its config (credentials, base URLs,
	// routing chain) by many minutes, and not every config mutation emits
	// a change-feed event (e.g. direct DB writes). configRefreshing is the
	// in-flight guard so at most one background config fetch runs per entry.
	configFetchedAt  time.Time
	configRefreshing bool
}

// configStale reports whether the entry's config is older than ttl.
// ttl <= 0 disables staleness (never stale).
func (e *entry) configStale(ttl time.Duration) bool {
	if ttl <= 0 {
		return false
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	return time.Since(e.configFetchedAt) > ttl
}

// tryBeginConfigRefresh claims the per-entry config-refresh slot.
func (e *entry) tryBeginConfigRefresh() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.configRefreshing {
		return false
	}
	e.configRefreshing = true
	return true
}

// endConfigRefresh releases the slot and stamps configFetchedAt so a
// failed fetch retries only after the next full TTL, not on every request.
func (e *entry) endConfigRefresh() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.configRefreshing = false
	e.configFetchedAt = time.Now()
}

// entryState is what the cache has decided about an entry it is holding, and
// it is the same question on every tier: serve it as is, refresh it before
// serving, or treat it as gone.
type entryState int

const (
	// entryFresh is inside its JWT exp and serves without asking anyone.
	entryFresh entryState = iota
	// entryStale is past its JWT exp but inside the hard cap, so the control
	// plane decides: a rejection evicts, a transport failure serves stale.
	entryStale
	// entryDead is past the hard cap and is not servable at all.
	entryDead
)

// classifyEntry is the one place that decides which of the three an entry is,
// so a warm tier and a cold one cannot answer differently about the same
// bundle. The order is load-bearing: soft expiry is checked BEFORE the hard
// cap, because a negative HardGrace deliberately puts the cap earlier than
// the JWT exp (the stale-while-error opt-out, LW_GATEWAY_AUTH_CACHE_HARD_
// GRACE_SECONDS), and a bundle that has not reached its own expiry is
// servable wherever the cap happens to sit. Testing the cap first would
// throw away perfectly valid credentials under that configuration.
func classifyEntry(e *entry) entryState {
	switch {
	case !e.softExpired():
		return entryFresh
	case !e.hardExpired():
		return entryStale
	default:
		return entryDead
	}
}

func (e *entry) softExpired() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return time.Now().After(e.softExpiresAt)
}

func (e *entry) hardExpired() bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return time.Now().After(e.hardExpiresAt)
}

func (e *entry) nearSoftExpiry(threshold time.Duration) bool {
	e.mu.Lock()
	defer e.mu.Unlock()
	return time.Until(e.softExpiresAt) < threshold
}

// bumpSoft pushes softExpiresAt forward by amount, capped at hardExpiresAt.
// Returns the new soft expiry and whether any bump applied (false when
// the entry was already at or past the hard cap).
func (e *entry) bumpSoft(amount time.Duration) (time.Time, bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	target := time.Now().Add(amount)
	if target.After(e.hardExpiresAt) {
		target = e.hardExpiresAt
	}
	if !target.After(e.softExpiresAt) {
		return e.softExpiresAt, false
	}
	e.softExpiresAt = target
	return e.softExpiresAt, true
}

func (e *entry) snapshot() (bundle *domain.Bundle, soft, hard time.Time) {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.bundle, e.softExpiresAt, e.hardExpiresAt
}

// refreshErrorClass maps an upstream resolver error to an action policy.
// AuthRejection means the control plane explicitly said "this key is not
// valid"; the cached entry must be evicted. TransportFailure means the
// control plane could not give us a useful answer (network, 5xx, parse);
// the cached entry should be preserved and its soft expiry bumped.
type refreshErrorClass int

const (
	classNone refreshErrorClass = iota
	classAuthRejection
	classTransportFailure
)

func (c refreshErrorClass) String() string {
	switch c {
	case classNone:
		return "none"
	case classAuthRejection:
		return "auth_rejection"
	case classTransportFailure:
		return "transport"
	default:
		return "unknown"
	}
}

// classifyRefreshError maps an upstream resolver error to a class.
// Conservative on unknown shapes: anything that isn't an explicit
// AuthRejection is treated as transport — we'd rather serve stale on a
// surprising error than evict a good key the operator can't easily
// re-create.
func classifyRefreshError(err error) refreshErrorClass {
	if err == nil {
		return classNone
	}
	if errors.Is(err, domain.ErrInvalidAPIKey) || errors.Is(err, domain.ErrKeyRevoked) {
		return classAuthRejection
	}
	return classTransportFailure
}

// Options configures the auth service.
type Options struct {
	LRUSize          int
	RefreshThreshold time.Duration
	// SoftBump is how much to extend a stale entry's soft expiry on each
	// transport-class refresh failure. Default 5m.
	SoftBump time.Duration
	// HardGrace is the absolute cap on extending a stale entry beyond its
	// natural JWT exp. 0 takes the 6h default; a negative value disables
	// stale-while-error entirely, hard-failing at JWT exp.
	HardGrace     time.Duration
	Logger        *zap.Logger
	L2            L2Store // optional, nil = skip L2
	Resolver      KeyResolver
	ConfigFetcher ConfigFetcher
	// ConfigTTL is the max age of a cached bundle's config (credentials,
	// base URLs, routing chain) before a background re-fetch. The change
	// feed already evicts on admin mutations that emit events, but not
	// every config change does (direct DB writes, mutations without a
	// change-event kind) — this TTL is the safety net that bounds config
	// staleness without a process restart. Default 60s. Negative disables.
	ConfigTTL time.Duration
	// Metrics counts cache lookups, hits and misses. Optional; nil skips
	// the counting entirely.
	Metrics CacheMetrics
	// ChangePoller is the optional control-plane /changes subscriber.
	// When non-nil, the service spawns a per-org poll loop on Start that
	// evicts L1 entries whose cached config has been invalidated by an
	// admin mutation upstream (e.g. a binding cascade-disabled, a budget
	// limit lowered). Nil disables event-driven invalidation, leaving
	// JWT-exp-driven refresh as the only signal — acceptable for tests
	// or single-process dev environments where stale-window-up-to-15min
	// is tolerable.
	ChangePoller ChangePoller
}

// New creates the auth service.
func New(opts Options) (*Service, error) {
	if opts.LRUSize <= 0 {
		opts.LRUSize = 10_000
	}
	if opts.RefreshThreshold == 0 {
		opts.RefreshThreshold = 5 * time.Minute
	}
	if opts.SoftBump == 0 {
		opts.SoftBump = 5 * time.Minute
	}
	// A negative HardGrace is the opt-out: it puts the hard cap before the
	// JWT exp, so an entry is hard-expired by the time it could ever be
	// served stale. Zero means "unset" and takes the default, matching every
	// other field here.
	if opts.HardGrace == 0 {
		opts.HardGrace = 6 * time.Hour
	}
	if opts.ConfigTTL == 0 {
		opts.ConfigTTL = 60 * time.Second
	}
	if opts.ConfigTTL < 0 {
		opts.ConfigTTL = 0 // disabled
	}

	l1, err := lru.New[[64]byte, *entry](opts.LRUSize)
	if err != nil {
		return nil, err
	}

	logger := opts.Logger
	if logger == nil {
		logger = zap.NewNop()
	}

	return &Service{
		l1:               l1,
		l2:               opts.L2,
		resolver:         opts.Resolver,
		configFetcher:    opts.ConfigFetcher,
		changePoller:     opts.ChangePoller,
		logger:           logger,
		metrics:          opts.Metrics,
		refreshThreshold: opts.RefreshThreshold,
		softBump:         opts.SoftBump,
		hardGrace:        opts.HardGrace,
		configTTL:        opts.ConfigTTL,
		stopCh:           make(chan struct{}),
	}, nil
}

// Resolve returns a Bundle for the raw bearer token.
// Checks L1 → L2 → upstream resolver, caching at each tier.
//
// On L1 hit past softExpiresAt but within hardExpiresAt, attempts a
// foreground refresh; on transport-class failure serves the stale bundle
// and bumps soft expiry. On auth-class failure evicts and rejects.
func (s *Service) Resolve(ctx context.Context, rawKey string) (*domain.Bundle, error) {
	if rawKey == "" {
		return nil, herr.New(ctx, domain.ErrInvalidAPIKey, nil)
	}

	h := hashKey(rawKey)
	s.recordLookup()

	// L1: in-memory
	if e, ok := s.l1.Get(h); ok {
		switch classifyEntry(e) {
		case entryFresh:
			// Serve, maybe trigger background refresh on near-expiry.
			s.recordHit(tierL1)
			if e.nearSoftExpiry(s.refreshThreshold) {
				go s.refreshBackground(rawKey, h) //nolint:gosec // G118: intentional fire-and-forget refresh detached from request
			} else if e.configStale(s.configTTL) && e.tryBeginConfigRefresh() {
				go s.refreshConfigBackground(h, e) //nolint:gosec // G118: intentional fire-and-forget refresh detached from request
			}
			return e.bundle, nil

		case entryStale:
			// Soft-expired but within hard grace. A foreground refresh is
			// needed before the entry can serve, so it counts as a miss
			// even when stale-while-error ends up serving the old bundle.
			s.recordMiss(tierL1)
			return s.refreshOrServeStale(ctx, rawKey, h, e)

		default:
			// Past hard cap: evict, fall through to fresh resolve.
			s.recordMiss(tierL1)
			s.l1.Remove(h)
			s.logger.Error("auth_cache_hard_evict",
				zap.String("vk_id", e.bundle.VirtualKeyID),
				zap.String("reason", "hard_cap_exceeded_on_lookup"),
			)
		}
	} else {
		s.recordMiss(tierL1)
	}

	// L2: optional store
	if bundle, l2Err := s.serveFromL2(ctx, rawKey, h); bundle != nil || l2Err != nil {
		return bundle, l2Err
	}

	// L3: upstream resolver
	return s.resolveFresh(ctx, rawKey, h)
}

// serveFromL2 answers from the shared store when it holds a bundle this node
// may serve, rehydrating L1 on the way. A miss is (nil, nil), leaving the
// caller to resolve upstream.
//
// A rehydrated entry gets exactly the treatment an L1 entry in the same state
// would get, because a node with a cold L1 must not be a weaker door than a
// warm one. That is the whole reason this reaches into the refresh path
// instead of just returning what the store handed over.
func (s *Service) serveFromL2(ctx context.Context, rawKey string, h [64]byte) (*domain.Bundle, error) {
	if s.l2 == nil {
		return nil, nil
	}
	cached, err := s.l2.Get(ctx, string(h[:]))
	if err != nil {
		s.recordMiss(tierL2Redis)
		return nil, nil //nolint:nilerr // a shared cache that cannot answer is a miss, not a failed request: the resolve falls through to the tier that decides whether the key is good
	}
	if cached == nil || cached.Bundle == nil {
		s.recordMiss(tierL2Redis)
		return nil, nil
	}
	// Build the entry before deciding anything, so this tier asks
	// classifyEntry the same question L1 asks about an entry it already
	// holds, from the same fields. A store is not required to filter what it
	// hands back, and the answer must not depend on which tier the bundle
	// arrived from. The config-fetch time is the one L2 carries, never now:
	// stamping now would restart the ConfigTTL clock on every hit, so an
	// entry 50 seconds into a 60 second TTL would come back with a fresh 60.
	e := s.newEntry(cached.Bundle, cached.ConfigFetchedAt)

	switch classifyEntry(e) {
	case entryDead:
		// Past the hard cap and not servable, so it never enters L1: the
		// request resolves fresh rather than running on credentials nothing
		// has re-checked in hours.
		s.recordMiss(tierL2Redis)
		return nil, nil

	case entryStale:
		// Past its JWT exp and inside the hard cap: ask the control plane
		// before serving, exactly as an L1 entry in this state does. A key
		// revoked during the grace window is rejected here rather than
		// serving one more request first, and a control plane that is merely
		// unreachable still gets the stale bundle served. Counted a miss for
		// the same reason the L1 path counts one: the request paid a
		// foreground refresh, whatever it ends up being answered with.
		s.storeL1Entry(h, e)
		s.recordMiss(tierL2Redis)
		return s.refreshOrServeStale(ctx, rawKey, h, e)

	default:
		s.storeL1Entry(h, e)
		s.recordHit(tierL2Redis)
		// An entry that arrives already past its config TTL refreshes here
		// rather than waiting for a second request to notice.
		if e.configStale(s.configTTL) && e.tryBeginConfigRefresh() {
			go s.refreshConfigBackground(h, e) //nolint:gosec // G118: intentional fire-and-forget refresh detached from request
		}
		return cached.Bundle, nil
	}
}

// CacheLen reports how many virtual keys L1 is currently holding, so the
// gateway can publish it as a gauge.
func (s *Service) CacheLen() int { return s.l1.Len() }

func (s *Service) recordLookup() {
	if s.metrics != nil {
		s.metrics.RecordAuthCacheLookup()
	}
}

func (s *Service) recordHit(tier string) {
	if s.metrics != nil {
		s.metrics.RecordAuthCacheHit(tier)
	}
}

func (s *Service) recordMiss(tier string) {
	if s.metrics != nil {
		s.metrics.RecordAuthCacheMiss(tier)
	}
}

// resolveFresh calls the upstream resolver and caches the result.
// Used for cold L1+L2 misses; not on stale-entry refresh paths (those
// use refreshOrServeStale for the served-stale fallback).
func (s *Service) resolveFresh(ctx context.Context, rawKey string, h [64]byte) (*domain.Bundle, error) {
	bundle, err := s.resolver.ResolveKey(ctx, rawKey)
	if err != nil {
		return nil, err
	}
	if cfgErr := s.populateConfig(ctx, bundle); cfgErr != nil {
		// Cold miss: no stale entry to fall back on. Cache nothing — a
		// bundle without its config is not a resolution result.
		return nil, errConfigUnavailable(ctx, cfgErr)
	}
	s.storeL1(h, bundle)
	s.setL2(ctx, h, bundle)
	return bundle, nil
}

// refreshOrServeStale tries to resolve fresh against the control plane.
// On success replaces the L1 entry. On transport-class failure bumps the
// stale entry's soft expiry by SoftBump and serves the stale bundle. On
// auth-class failure evicts the entry and returns the rejection.
func (s *Service) refreshOrServeStale(ctx context.Context, rawKey string, h [64]byte, stale *entry) (*domain.Bundle, error) {
	bundle, err := s.resolver.ResolveKey(ctx, rawKey)
	cls := classifyRefreshError(err)

	staleBundle, _, hardExpiresAt := stale.snapshot()
	vkID := staleBundle.VirtualKeyID

	switch cls {
	case classNone:
		if cfgErr := s.populateConfig(ctx, bundle); cfgErr != nil {
			// The control plane authenticated the key but could not hand
			// over its provider config. Serving the fresh, config-less
			// bundle would surface as no_provider_configured for an org
			// whose keys are fine — treat it as a transport failure and
			// serve the stale entry's known-good credentials instead.
			return s.serveStaleAfterFailure(ctx, h, stale, staleBundle, vkID, hardExpiresAt, cls, cfgErr)
		}
		s.storeL1(h, bundle)
		s.setL2(ctx, h, bundle)
		return bundle, nil

	case classAuthRejection:
		s.l1.Remove(h)
		s.logger.Error("auth_cache_hard_evict",
			zap.String("vk_id", vkID),
			zap.String("reason", "auth_rejection"),
			zap.Error(err),
		)
		return nil, err

	default:
		return s.serveStaleAfterFailure(ctx, h, stale, staleBundle, vkID, hardExpiresAt, cls, err)
	}
}

// serveStaleAfterFailure is the transport-failure tail of refreshOrServeStale:
// bump the stale entry's soft expiry and keep serving it, or evict and fail
// once the hard grace cap is exhausted. `cause` is what stopped the refresh —
// a ResolveKey transport error or a config fetch failure after a good auth.
func (s *Service) serveStaleAfterFailure(ctx context.Context, h [64]byte, stale *entry, staleBundle *domain.Bundle, vkID string, hardExpiresAt time.Time, cls refreshErrorClass, cause error) (*domain.Bundle, error) {
	newSoft, bumped := stale.bumpSoft(s.softBump)
	if !bumped {
		s.l1.Remove(h)
		s.logger.Error("auth_cache_hard_evict",
			zap.String("vk_id", vkID),
			zap.String("reason", "hard_cap_exceeded"),
			zap.Error(cause),
		)
		if cls == classNone {
			return nil, errConfigUnavailable(ctx, cause)
		}
		return nil, cause
	}
	// classNone here means the auth succeeded and the CONFIG fetch failed;
	// log that instead of a misleading "none" error class.
	classLabel := cls.String()
	if cls == classNone {
		classLabel = "config_fetch_failed"
	}
	s.logger.Warn("auth_cache_refresh_transport_failure",
		zap.String("vk_id", vkID),
		zap.Time("new_soft_expires_at", newSoft),
		zap.Duration("hard_grace_remaining", time.Until(hardExpiresAt)),
		zap.Error(cause),
	)
	s.logger.Info("auth_cache_serve_stale",
		zap.String("vk_id", vkID),
		zap.Duration("stale_for", time.Since(staleBundle.ExpiresAt)),
		zap.Duration("hard_grace_remaining", time.Until(hardExpiresAt)),
		zap.String("refresh_error_class", classLabel),
	)
	return staleBundle, nil
}

// populateConfig eagerly fetches the bundle's config and merges it into the
// bundle. A failure leaves the bundle without credentials, so callers must
// not cache or serve the bundle as-is: dispatch would answer the terminal
// no_provider_configured ("add a provider API key in Settings") for an org
// whose keys are fine, and a cached config-less bundle keeps giving that
// answer until it expires — on every node that shares the L2 cache.
func (s *Service) populateConfig(ctx context.Context, bundle *domain.Bundle) error {
	if bundle == nil {
		return nil
	}
	cfg, err := s.configFetcher.FetchConfig(ctx, bundle.VirtualKeyID)
	if err != nil {
		s.logger.Warn("config_fetch_failed", zap.String("vk_id", bundle.VirtualKeyID), zap.Error(err))
		return err
	}
	bundle.Config = cfg
	bundle.Credentials = cfg.Credentials
	return nil
}

// errConfigUnavailable is the fail-closed answer when the control plane
// authenticated the key but could not hand over its provider config and no
// stale entry exists to serve instead. Transport-class on purpose: the
// client should retry, not go check its provider settings.
func errConfigUnavailable(ctx context.Context, err error) error {
	return herr.New(ctx, domain.ErrAuthUpstream, herr.M{
		"message": "control plane unavailable while loading this key's provider configuration — retry shortly",
	}, err)
}

// Start launches the background refresh loop and (when configured) the
// per-org change-feed loops that drive cache invalidation off the
// control plane's /changes stream.
func (s *Service) Start(ctx context.Context) {
	go s.loop(ctx)
	if s.changePoller != nil {
		go s.changeFeedLoop(ctx)
	}
}

// Stop signals background goroutines to exit.
func (s *Service) Stop() {
	select {
	case <-s.stopCh:
	default:
		close(s.stopCh)
	}
}

// --- Internal ---

// storeL1 caches a bundle whose config was just fetched.
func (s *Service) storeL1(h [64]byte, bundle *domain.Bundle) {
	s.storeL1Fetched(h, bundle, time.Now())
}

// storeL1Fetched caches a bundle whose config was fetched at a known moment,
// which is not always now: an L2 rehydrate inherits the age the shared store
// recorded, so the ConfigTTL clock keeps running across nodes.
func (s *Service) storeL1Fetched(h [64]byte, bundle *domain.Bundle, configFetchedAt time.Time) *entry {
	e := s.newEntry(bundle, configFetchedAt)
	s.storeL1Entry(h, e)
	return e
}

// newEntry builds a cache entry without publishing it. Separate from the
// store so a caller can classify a bundle first and decline to cache one it
// would refuse to serve.
func (s *Service) newEntry(bundle *domain.Bundle, configFetchedAt time.Time) *entry {
	return &entry{
		bundle:          bundle,
		softExpiresAt:   bundle.ExpiresAt,
		hardExpiresAt:   bundle.ExpiresAt.Add(s.hardGrace),
		configFetchedAt: configFetchedAt,
	}
}

// storeL1Entry publishes an entry to L1 and records its org for the change feed.
func (s *Service) storeL1Entry(h [64]byte, e *entry) {
	bundle := e.bundle
	s.l1.Add(h, e)
	// Record the bundle's org so the change-feed loop knows which orgs
	// to subscribe to. LoadOrStore is the first-write-wins shape: if
	// the org's already known, the existing cursor is preserved so we
	// don't reset to "0" and re-stream the entire history on every new
	// bundle for an existing org.
	if bundle.OrganizationID != "" {
		s.activeOrgs.LoadOrStore(bundle.OrganizationID, &orgCursor{since: "0"})
	}
}

// setL2 mirrors a bundle into the shared store. Only called right after a
// successful config fetch, so now is the config's fetch time.
func (s *Service) setL2(ctx context.Context, h [64]byte, bundle *domain.Bundle) {
	if s.l2 == nil {
		return
	}
	s.l2.Set(ctx, string(h[:]), CachedBundle{Bundle: bundle, ConfigFetchedAt: time.Now()})
}

// changeFeedLoop drives the per-org cache invalidation: long-polls the
// control plane's /changes endpoint for each known org, then evicts
// affected L1 entries on each event kind.
//
// Errors are logged and the loop continues; the long poll already
// embeds its own short pause server-side so a transient control-plane
// blip just produces a few quick retry passes here, not a tight spin.
func (s *Service) changeFeedLoop(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.stopCh:
			return
		default:
		}
		s.activeOrgs.Range(func(key, value any) bool {
			orgID, _ := key.(string)
			cursor, _ := value.(*orgCursor)
			changes, nextRev, err := s.changePoller.PollChanges(ctx, orgID, cursor.since)
			if err != nil {
				s.logger.Warn("change_feed_poll_failed",
					zap.String("organization_id", orgID),
					zap.Error(err),
				)
				// Tiny pause so a tight error loop doesn't burn CPU
				// when the control plane is down. Server long-poll is
				// the primary brake for the success path.
				time.Sleep(2 * time.Second)
				return true
			}
			for _, ch := range changes {
				s.applyChange(orgID, ch)
			}
			if nextRev != "" {
				cursor.since = nextRev
			}
			return true
		})
		// If no orgs are active yet (first request hasn't landed), back
		// off briefly so we don't spin on Range() over an empty map.
		empty := true
		s.activeOrgs.Range(func(_, _ any) bool {
			empty = false
			return false
		})
		if empty {
			select {
			case <-ctx.Done():
				return
			case <-s.stopCh:
				return
			case <-time.After(5 * time.Second):
			}
		}
	}
}

// applyChange is the cache-invalidation switchboard. Each kind walks L1
// once with a kind-specific predicate and removes matching entries; the
// next request for those VKs takes a cold miss and re-resolves with the
// fresh control-plane state.
//
// The evict reason is the lowercased change kind, so an operator reading
// auth_cache_change_evict sees which mutation caused it. Hardcoding one
// label per branch collapsed distinct kinds onto one word, and a delete
// that logs "updated" is worse than no label at all.
func (s *Service) applyChange(organizationID string, ch CacheChange) {
	switch ch.Kind {
	case ChangeKindProviderBindingUpdated:
		// The control plane emits ModelProvider.id. Config materialization puts
		// that same ID in Credential.ID; ProviderID is only the provider type
		// (for example "openai") and is not a cache invalidation join key.
		if ch.ModelProviderID == "" {
			return
		}
		s.evictWhere(func(b *domain.Bundle) bool {
			for _, c := range b.Config.Credentials {
				if c.ID == ch.ModelProviderID {
					return true
				}
			}
			return false
		}, evictReason(ch.Kind), ch.ModelProviderID)
	case ChangeKindBudgetCreated, ChangeKindBudgetUpdated, ChangeKindBudgetDeleted:
		// Only PROJECT-scoped creates carry project_id. Updates, deletes, and
		// every other scope omit it, so invalidate the polled organization in
		// those cases rather than leaving a stale budget enforced until TTL.
		if ch.ProjectID != "" {
			s.evictWhere(func(b *domain.Bundle) bool {
				return b.ProjectID == ch.ProjectID
			}, evictReason(ch.Kind), ch.ProjectID)
			return
		}
		s.evictWhere(func(b *domain.Bundle) bool {
			return b.OrganizationID == organizationID
		}, evictReason(ch.Kind), organizationID)
	case ChangeKindVirtualKeyConfigUpdate, ChangeKindVirtualKeyRotated, ChangeKindVirtualKeyRevoked,
		ChangeKindVirtualKeyDisabled, ChangeKindVirtualKeyEnabled:
		if ch.VirtualKeyID == "" {
			return
		}
		s.evictWhere(func(b *domain.Bundle) bool {
			return b.VirtualKeyID == ch.VirtualKeyID
		}, evictReason(ch.Kind), ch.VirtualKeyID)
	case ChangeKindRoutingPolicyUpdated, ChangeKindRoutingPolicyDeleted:
		// A bundle carries the resolved routing mode and chain, not the id
		// of the policy they came from, so there is nothing finer than the
		// organization to key on. Same shape as a budget change with no
		// project.
		s.evictWhere(func(b *domain.Bundle) bool {
			return b.OrganizationID == organizationID
		}, evictReason(ch.Kind), organizationID)
	case ChangeKindCacheRuleCreated, ChangeKindCacheRuleUpdated, ChangeKindCacheRuleDeleted:
		// Cache rules are org-scoped and baked into every bundle as a
		// pre-sorted array, with no rule id left on the bundle to join on.
		s.evictWhere(func(b *domain.Bundle) bool {
			return b.OrganizationID == organizationID
		}, evictReason(ch.Kind), organizationID)
	case ChangeKindVirtualKeyCreated:
		// Nothing to evict: a key nobody has resolved yet is in no cache, on
		// this node or any other. Named rather than left to the default so a
		// routine event does not arrive as a warning and bury the kinds an
		// operator actually needs to see.
	default:
		// The cases above are every kind this build knows about, acted on or
		// deliberately ignored, and the control plane is free to emit others.
		// Dropping one is often correct, but dropping one silently is how
		// CACHE_RULE_* went unhandled from the day it shipped: the control
		// plane emitted it, nothing here named it, and the documented
		// behavior simply did not happen. Saying so leaves the next one an
		// hour of log reading rather than a bug report about staleness.
		s.logger.Warn("auth_cache_change_unhandled",
			zap.String("kind", ch.Kind),
			zap.String("organization_id", organizationID),
		)
	}
}

// evictReason turns a change kind into the label its eviction is logged
// under. One transformation in one place, so every kind reads the same way in
// auth_cache_change_evict and none of them can drift into a hand-written word
// that no longer matches the event.
func evictReason(kind string) string {
	return strings.ToLower(kind)
}

// evictWhere walks the L1 LRU once and removes every entry whose bundle
// matches the predicate, then drops the same entries from L2. Evicting only
// L1 would be undone by the next request, which finds the invalidated bundle
// in the shared store and rehydrates it. O(N) over LRUSize per call:
// acceptable for 10k-ish caches and the low frequency of admin mutations.
//
// Peek, not Get: the scan reads the whole cache, and Get takes the
// exclusive lock and promotes what it reads. That queues every in-flight
// request behind the scan once per entry, and it drags keys the
// scan merely looked at ahead of keys real traffic touched after the
// Keys() snapshot, so the next size eviction picks the wrong victim. Peek
// takes the shared lock and leaves recency to the request path, the same
// reason refreshConfigBackground uses it.
func (s *Service) evictWhere(match func(*domain.Bundle) bool, reason, target string) {
	keys := s.l1.Keys()
	evicted := make([]string, 0, len(keys))
	for _, h := range keys {
		e, ok := s.l1.Peek(h)
		if !ok {
			continue
		}
		if !match(e.bundle) {
			continue
		}
		s.l1.Remove(h)
		evicted = append(evicted, string(h[:]))
	}
	if len(evicted) == 0 {
		return
	}
	s.logger.Info("auth_cache_change_evict",
		zap.String("reason", reason),
		zap.String("target", target),
		zap.Int("evicted", len(evicted)),
	)
	s.deleteL2(evicted, reason, target)
}

// deleteL2 drops evicted hashes from the shared store, after the L1 walk so
// no store round trip sits inside it. Best effort: keys it cannot delete are
// left to the ConfigTTL refresh, which is the same bound the gateway had
// before the change feed existed, and the L1 eviction still stands either way.
//
// It runs synchronously in the change-feed loop, which is off the request
// path. Chunked, because an org-wide eviction is thousands of keys and a
// failing chunk must not take the rest of the batch down with it: each chunk
// is one round trip on its own budget, so a slow or dead store costs a bounded
// wait per chunk instead of silently abandoning every key after the first
// timeout.
func (s *Service) deleteL2(hashes []string, reason, target string) {
	if s.l2 == nil || len(hashes) == 0 {
		return
	}
	failed := 0
	var lastErr error
	for start := 0; start < len(hashes); start += l2DeleteChunkSize {
		end := min(start+l2DeleteChunkSize, len(hashes))
		if err := s.deleteL2Chunk(hashes[start:end]); err != nil {
			failed += end - start
			lastErr = err
		}
	}
	if failed > 0 {
		s.logger.Warn("auth_cache_l2_delete_failed",
			zap.String("reason", reason),
			zap.String("target", target),
			zap.Int("failed", failed),
			zap.Int("total", len(hashes)),
			zap.Error(lastErr),
		)
	}
}

// deleteL2Chunk is one batch delete on its own timeout. Separate function so
// each chunk's context is released as soon as that chunk is done, rather than
// piling up until the whole batch finishes.
func (s *Service) deleteL2Chunk(hashes []string) error {
	ctx, cancel := context.WithTimeout(context.Background(), l2DeleteTimeout)
	defer cancel()
	return s.l2.DeleteMany(ctx, hashes)
}

// refreshBackground is the near-soft-expiry proactive refresh: fires
// fire-and-forget when the entry has less than RefreshThreshold left
// before softExpiresAt. Same classification as foreground:
// AuthRejection evicts; TransportFailure bumps the existing entry.
func (s *Service) refreshBackground(rawKey string, h [64]byte) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	bundle, err := s.resolver.ResolveKey(ctx, rawKey)
	cls := classifyRefreshError(err)

	switch cls {
	case classNone:
		if cfgErr := s.populateConfig(ctx, bundle); cfgErr != nil {
			// Keep the existing entry serving its known-good credentials.
			// Replacing it with a config-less bundle would proactively
			// poison a perfectly healthy cache entry into answering
			// no_provider_configured until expiry.
			s.bumpEntryAfterTransportFailure(h, cfgErr)
			return
		}
		s.storeL1(h, bundle)
		s.setL2(ctx, h, bundle)
		s.logger.Debug("auth_cache_refresh_success", zap.String("vk_id", bundle.VirtualKeyID))

	case classAuthRejection:
		var vkID string
		if e, ok := s.l1.Get(h); ok {
			vkID = e.bundle.VirtualKeyID
		}
		s.l1.Remove(h)
		s.logger.Error("auth_cache_hard_evict",
			zap.String("vk_id", vkID),
			zap.String("reason", "auth_rejection_async"),
			zap.Error(err),
		)

	default:
		s.bumpEntryAfterTransportFailure(h, err)
	}
}

// bumpEntryAfterTransportFailure extends the soft expiry of an existing L1
// entry after a background refresh failed for transport-class reasons (the
// resolve call itself, or the config fetch after a good auth), keeping the
// entry serving instead of letting it lapse.
func (s *Service) bumpEntryAfterTransportFailure(h [64]byte, cause error) {
	e, ok := s.l1.Get(h)
	if !ok {
		return
	}
	newSoft, bumped := e.bumpSoft(s.softBump)
	if !bumped {
		return
	}
	_, _, hardExpiresAt := e.snapshot()
	s.logger.Warn("auth_cache_refresh_transport_failure",
		zap.String("vk_id", e.bundle.VirtualKeyID),
		zap.Time("new_soft_expires_at", newSoft),
		zap.Duration("hard_grace_remaining", time.Until(hardExpiresAt)),
		zap.Error(cause),
	)
}

// refreshConfigBackground re-fetches only the bundle's config (not auth)
// when it crosses ConfigTTL. On success the entry is replaced with a
// shallow bundle copy carrying the fresh config — the entry's bundle
// pointer stays immutable, so in-flight requests holding the old bundle
// are unaffected. On failure the stale config keeps serving and the next
// attempt waits a full TTL (endConfigRefresh stamps configFetchedAt).
func (s *Service) refreshConfigBackground(h [64]byte, e *entry) {
	defer e.endConfigRefresh()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	stale, _, _ := e.snapshot()
	cfg, err := s.configFetcher.FetchConfig(ctx, stale.VirtualKeyID)
	if err != nil {
		s.logger.Warn("config_ttl_refresh_failed",
			zap.String("vk_id", stale.VirtualKeyID),
			zap.Error(err),
		)
		return
	}

	fresh := *stale
	fresh.Config = cfg
	fresh.Credentials = cfg.Credentials

	// Guard against resurrecting an entry that another path evicted or
	// replaced while FetchConfig was in flight: a change-feed eviction
	// (VK/provider updated or revoked), an async auth rejection, or a
	// foreground auth refresh that swapped in a newer bundle. If the live L1
	// entry for h is no longer the one we started from, drop this result
	// instead of writing a stale (possibly revoked) bundle back into L1/L2.
	// Peek avoids perturbing LRU recency from this background goroutine.
	if cur, ok := s.l1.Peek(h); !ok || cur != e {
		s.logger.Debug("config_ttl_refresh_dropped_stale",
			zap.String("vk_id", stale.VirtualKeyID),
		)
		return
	}
	s.storeL1(h, &fresh)
	s.setL2(ctx, h, &fresh)
	s.logger.Debug("config_ttl_refresh_success", zap.String("vk_id", stale.VirtualKeyID))
}

func (s *Service) loop(ctx context.Context) {
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.stopCh:
			return
		case <-t.C:
			// Entries near expiry refresh on next request hit
		}
	}
}

func hashKey(raw string) [64]byte {
	sum := sha256.Sum256([]byte(raw))
	var dst [64]byte
	hex.Encode(dst[:], sum[:])
	return dst
}
