// Package authresolver resolves virtual-key bearer tokens into domain.Bundle
// via one in-memory LRU cache (L1) in front of the upstream resolver.
//
// Stale-while-error: when a cached L1 entry crosses its natural JWT expiry
// AND the upstream refresh fails for transport reasons (network error, dial
// timeout, 5xx, connection refused, malformed response, JWT verify failure),
// the entry's soft expiry is bumped by SoftBump and the cached bundle keeps
// serving, up to a hard cap (JWT exp + HardGrace). Any auth-class rejection
// (401/403/404) evicts immediately — bad credentials get no grace window.
// See specs/ai-gateway/auth-cache.feature, Rule "Cached JWT serves
// stale-while-error past natural expiry on transport failure".
//
// A key that carries its own expiration date bounds all of it: both deadlines
// are capped at that instant and an entry past it is refused with
// virtual_key_expired without asking the control plane. Grace covers a control
// plane we cannot reach, and a date it already told us needs no round trip.
// Revoked and disabled keys keep the full window on purpose, since neither is
// knowable in advance.
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

// KeyResolver resolves a raw API key into a Bundle via an upstream source.
type KeyResolver interface {
	ResolveKey(ctx context.Context, rawKey string) (*domain.Bundle, error)
}

// ConfigFetcher retrieves configuration for a virtual key. ifNoneMatch is the
// ETag of the config the caller already holds, so an unchanged key can be
// revalidated rather than materialized again; empty asks for the config
// outright, and only a conditional call may be answered NotModified.
type ConfigFetcher interface {
	FetchConfig(ctx context.Context, vkID, ifNoneMatch string) (domain.ConfigFetchResult, error)
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

// CacheMetrics counts how well the key cache is serving. Declared here
// rather than imported so the resolver stays free of a metrics
// dependency; the gateway's Prometheus recorder satisfies it.
type CacheMetrics interface {
	RecordAuthCacheLookup()
	RecordAuthCacheHit(tier string)
	RecordAuthCacheMiss(tier string)
}

// tierL1 is the cache tier name reported on the auth-cache metrics. The
// gateway caches virtual keys in this node's own memory and nowhere else, so
// the label carries one value; it stays a label because the metric names are
// published and an operator's dashboard should not break to save a string.
const tierL1 = "l1"

// Service is the auth resolver: one in-memory LRU in front of the control
// plane.
type Service struct {
	l1            *lru.Cache[[64]byte, *entry]
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
	// configETag is what the control plane stamped on the config this entry
	// carries. The staleness refresh sends it as If-None-Match so a key
	// nobody changed comes back 304 instead of a re-materialized bundle.
	// Empty means we have no token to revalidate with, and the next refresh
	// goes out unconditional.
	configETag string
}

// currentConfigETag reports the ETag of the config this entry is carrying.
func (e *entry) currentConfigETag() string {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.configETag
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

// entryState is what the cache has decided about an entry it is holding:
// serve it as is, refresh it before serving, or treat it as gone.
type entryState int

const (
	// entryFresh is inside its JWT exp and serves without asking anyone.
	entryFresh entryState = iota
	// entryStale is past its JWT exp but inside the hard cap, so the control
	// plane decides: a rejection evicts, a transport failure serves stale.
	entryStale
	// entryDead is past the hard cap and is not servable at all.
	entryDead
	// entryKeyExpired is past the virtual key's own expiration date. The key
	// has stopped, so no grace window applies and the request is refused with
	// the key's own error rather than an upstream one.
	entryKeyExpired
)

// classifyEntry is the one place that decides which of the four an entry is,
// so every path through the cache reaches the same verdict about the same
// bundle. The order matters twice.
//
// The key's own expiration date is checked FIRST, ahead of every grace path:
// the control plane published that date with the token, so the gateway can
// enforce it alone, and a stale-while-error window that outlives the date
// would let a key keep calling providers after it ran out.
//
// Soft expiry is then checked BEFORE the hard cap, because a negative
// HardGrace deliberately puts the cap earlier than the JWT exp (the
// stale-while-error opt-out, LW_GATEWAY_AUTH_CACHE_HARD_GRACE_SECONDS), and a
// bundle that has not reached its own expiry is servable wherever the cap
// happens to sit. Testing the cap first would throw away perfectly valid
// credentials under that configuration.
func classifyEntry(e *entry) entryState {
	switch {
	case e.keyExpired():
		return entryKeyExpired
	case !e.softExpired():
		return entryFresh
	case !e.hardExpired():
		return entryStale
	default:
		return entryDead
	}
}

// keyExpired reports whether the cached bundle's virtual key has passed its
// own expiration date. A bundle carrying no date never expires, which is what
// keeps every key without one on exactly the behavior it had before.
func (e *entry) keyExpired() bool {
	return e.bundle != nil && e.bundle.KeyExpired(time.Now())
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
	// Every refusal the control plane makes about the key itself belongs
	// here. A disabled or expired key served stale would keep working for
	// the length of the stale window, which is the one thing an operator
	// pressing Disable, and a date passing, both have to stop at once.
	if errors.Is(err, domain.ErrInvalidAPIKey) ||
		errors.Is(err, domain.ErrKeyRevoked) ||
		errors.Is(err, domain.ErrKeyDisabled) ||
		errors.Is(err, domain.ErrKeyExpired) {
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
// Checks L1, then the upstream resolver, caching what the latter answers.
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
			s.recordHit()
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
			s.recordMiss()
			return s.refreshOrServeStale(ctx, rawKey, h, e)

		case entryKeyExpired:
			// The key ran out. Fail closed with the key's own error and skip
			// the control plane: a reachable control plane answers exactly
			// this, and an unreachable one must not turn a finished key into
			// a retryable upstream failure that grace keeps serving through.
			s.recordMiss()
			s.l1.Remove(h)
			s.logger.Error("auth_cache_hard_evict",
				zap.String("vk_id", e.bundle.VirtualKeyID),
				zap.String("reason", "virtual_key_expired"),
			)
			return nil, herr.New(ctx, domain.ErrKeyExpired, herr.M{
				"message": domain.KeyExpiredMessage,
			})

		default:
			// Past hard cap: evict, fall through to fresh resolve.
			s.recordMiss()
			s.l1.Remove(h)
			s.logger.Error("auth_cache_hard_evict",
				zap.String("vk_id", e.bundle.VirtualKeyID),
				zap.String("reason", "hard_cap_exceeded_on_lookup"),
			)
		}
	} else {
		s.recordMiss()
	}

	return s.resolveFresh(ctx, rawKey, h)
}

// CacheLen reports how many virtual keys L1 is currently holding, so the
// gateway can publish it as a gauge.
func (s *Service) CacheLen() int { return s.l1.Len() }

func (s *Service) recordLookup() {
	if s.metrics != nil {
		s.metrics.RecordAuthCacheLookup()
	}
}

// recordHit and recordMiss stamp the one tier this cache has. The published
// metrics keep the label, so an operator dashboard built on them survives a
// second tier arriving; only the call sites are spared repeating it.
func (s *Service) recordHit() {
	if s.metrics != nil {
		s.metrics.RecordAuthCacheHit(tierL1)
	}
}

func (s *Service) recordMiss() {
	if s.metrics != nil {
		s.metrics.RecordAuthCacheMiss(tierL1)
	}
}

// resolveFresh calls the upstream resolver and caches the result.
// Used for cold misses; not on stale-entry refresh paths (those use
// refreshOrServeStale for the served-stale fallback).
func (s *Service) resolveFresh(ctx context.Context, rawKey string, h [64]byte) (*domain.Bundle, error) {
	bundle, err := s.resolver.ResolveKey(ctx, rawKey)
	if err != nil {
		return nil, err
	}
	etag, cfgErr := s.populateConfig(ctx, bundle)
	if cfgErr != nil {
		// Cold miss: no stale entry to fall back on. Cache nothing — a
		// bundle without its config is not a resolution result.
		return nil, errConfigUnavailable(ctx, cfgErr)
	}
	s.storeL1(h, bundle, etag)
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
		etag, cfgErr := s.populateConfig(ctx, bundle)
		if cfgErr != nil {
			// The control plane authenticated the key but could not hand
			// over its provider config. Serving the fresh, config-less
			// bundle would surface as no_provider_configured for an org
			// whose keys are fine — treat it as a transport failure and
			// serve the stale entry's known-good credentials instead.
			return s.serveStaleAfterFailure(ctx, h, stale, staleBundle, vkID, hardExpiresAt, cls, cfgErr)
		}
		s.storeL1(h, bundle, etag)
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
// answer until it expires. Returns the ETag the config was served under, for
// the entry that will carry it.
//
// Unconditional on purpose: this path is materializing config for a bundle
// that has none, so "still current" would be an answer about nothing. The
// conditional request belongs to refreshConfigBackground, which already holds
// a config a 304 can confirm.
func (s *Service) populateConfig(ctx context.Context, bundle *domain.Bundle) (string, error) {
	if bundle == nil {
		return "", nil
	}
	res, err := s.configFetcher.FetchConfig(ctx, bundle.VirtualKeyID, "")
	if err != nil {
		s.logger.Warn("config_fetch_failed", zap.String("vk_id", bundle.VirtualKeyID), zap.Error(err))
		return "", err
	}
	if res.NotModified {
		// Nothing was revalidated, so there is no config behind this answer.
		// Treated as a failed fetch rather than cached as an empty one, which
		// would strip the key of every credential it has.
		err := errors.New("config fetch answered not-modified to an unconditional request")
		s.logger.Warn("config_fetch_failed", zap.String("vk_id", bundle.VirtualKeyID), zap.Error(err))
		return "", err
	}
	bundle.Config = res.Config
	bundle.Credentials = res.Config.Credentials
	return res.ETag, nil
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

// storeL1 caches a bundle whose config was just fetched under configETag, and
// records its org for the change feed. An empty configETag is the honest state
// after a response that carried none: the next staleness refresh asks for the
// config outright rather than revalidating against a token we do not have.
func (s *Service) storeL1(h [64]byte, bundle *domain.Bundle, configETag string) {
	softExpiresAt, hardExpiresAt := entryDeadlines(bundle, s.hardGrace)
	s.l1.Add(h, &entry{
		bundle:          bundle,
		softExpiresAt:   softExpiresAt,
		hardExpiresAt:   hardExpiresAt,
		configFetchedAt: time.Now(),
		configETag:      configETag,
	})
	// Record the bundle's org so the change-feed loop knows which orgs
	// to subscribe to. LoadOrStore is the first-write-wins shape: if
	// the org's already known, the existing cursor is preserved so we
	// don't reset to "0" and re-stream the entire history on every new
	// bundle for an existing org.
	if bundle.OrganizationID != "" {
		s.activeOrgs.LoadOrStore(bundle.OrganizationID, &orgCursor{since: "0"})
	}
}

// entryDeadlines computes the two instants a cached entry lives by: the JWT
// exp it refreshes at, and the hard cap the stale-while-error grace may extend
// it to.
//
// Both are capped at the virtual key's own expiration date when the bundle
// carries one, because the grace window exists to cover an unreachable control
// plane and this date needs no control plane to be true. Without the cap, the
// grace is added to the JWT exp and a key that ran out keeps serving for the
// length of the window. A bundle with no date is left exactly as it was.
func entryDeadlines(bundle *domain.Bundle, hardGrace time.Duration) (soft, hard time.Time) {
	soft = bundle.ExpiresAt
	hard = bundle.ExpiresAt.Add(hardGrace)
	if bundle.VirtualKeyExpiresAt.IsZero() {
		return soft, hard
	}
	if soft.After(bundle.VirtualKeyExpiresAt) {
		soft = bundle.VirtualKeyExpiresAt
	}
	if hard.After(bundle.VirtualKeyExpiresAt) {
		hard = bundle.VirtualKeyExpiresAt
	}
	return soft, hard
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
// matches the predicate. O(N) over LRUSize per call: acceptable for 10k-ish
// caches and the low frequency of admin mutations.
//
// Peek, not Get: the scan reads the whole cache, and Get takes the
// exclusive lock and promotes what it reads. That queues every in-flight
// request behind the scan once per entry, and it drags keys the
// scan merely looked at ahead of keys real traffic touched after the
// Keys() snapshot, so the next size eviction picks the wrong victim. Peek
// takes the shared lock and leaves recency to the request path, the same
// reason refreshConfigBackground uses it.
func (s *Service) evictWhere(match func(*domain.Bundle) bool, reason, target string) {
	evicted := 0
	for _, h := range s.l1.Keys() {
		e, ok := s.l1.Peek(h)
		if !ok {
			continue
		}
		if !match(e.bundle) {
			continue
		}
		s.l1.Remove(h)
		evicted++
	}
	if evicted == 0 {
		return
	}
	s.logger.Info("auth_cache_change_evict",
		zap.String("reason", reason),
		zap.String("target", target),
		zap.Int("evicted", evicted),
	)
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
		etag, cfgErr := s.populateConfig(ctx, bundle)
		if cfgErr != nil {
			// Keep the existing entry serving its known-good credentials.
			// Replacing it with a config-less bundle would proactively
			// poison a perfectly healthy cache entry into answering
			// no_provider_configured until expiry.
			s.bumpEntryAfterTransportFailure(h, cfgErr)
			return
		}
		s.storeL1(h, bundle, etag)
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
//
// This is the safety net rather than the propagation path: the change feed
// already evicts on the mutations that emit events, and this bounds staleness
// for the ones that do not. Which is exactly why it revalidates instead of
// re-downloading. Most of the time it fires, nothing about the key has
// changed, and the conditional request turns a full config materialization
// into a 304 the control plane answers from the key's revision.
func (s *Service) refreshConfigBackground(h [64]byte, e *entry) {
	defer e.endConfigRefresh()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	stale, _, _ := e.snapshot()
	res, err := s.configFetcher.FetchConfig(ctx, stale.VirtualKeyID, e.currentConfigETag())
	if err != nil {
		s.logger.Warn("config_ttl_refresh_failed",
			zap.String("vk_id", stale.VirtualKeyID),
			zap.Error(err),
		)
		return
	}
	if res.NotModified {
		// The config this entry carries is still the current one, so there is
		// nothing to swap in. The deferred endConfigRefresh restarts the
		// staleness clock, which is what a confirmation is worth: the entry
		// was just checked against the control plane, not merely tolerated.
		s.logger.Debug("config_ttl_refresh_not_modified", zap.String("vk_id", stale.VirtualKeyID))
		return
	}

	fresh := *stale
	fresh.Config = res.Config
	fresh.Credentials = res.Config.Credentials

	// Guard against resurrecting an entry that another path evicted or
	// replaced while FetchConfig was in flight: a change-feed eviction
	// (VK/provider updated or revoked), an async auth rejection, or a
	// foreground auth refresh that swapped in a newer bundle. If the live L1
	// entry for h is no longer the one we started from, drop this result
	// instead of writing a stale (possibly revoked) bundle back into L1.
	// Peek avoids perturbing LRU recency from this background goroutine.
	if cur, ok := s.l1.Peek(h); !ok || cur != e {
		s.logger.Debug("config_ttl_refresh_dropped_stale",
			zap.String("vk_id", stale.VirtualKeyID),
		)
		return
	}
	s.storeL1(h, &fresh, res.ETag)
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
