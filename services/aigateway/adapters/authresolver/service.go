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
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// L2Store is an optional second-level cache (e.g., Redis).
type L2Store interface {
	Get(ctx context.Context, hash string) (*domain.Bundle, error)
	Set(ctx context.Context, hash string, bundle *domain.Bundle)
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
	ChangeKindProviderBindingUpdated = "PROVIDER_BINDING_UPDATED"
	ChangeKindBudgetUpdated          = "BUDGET_UPDATED"
	ChangeKindVirtualKeyUpdated      = "VIRTUAL_KEY_UPDATED"
)

// CacheChange is one cache-invalidation hint surfaced by ChangePoller.
// Mirrors the wire shape from the control plane's /changes endpoint.
type CacheChange struct {
	Kind                 string
	VirtualKeyID         string
	BudgetID             string
	ProviderCredentialID string
	ProjectID            string
	Revision             string
}

// ChangePoller is the upstream that streams cache-invalidation events
// per organization. Returns the events buffered since `since`, the
// org's current revision (caller advances cursor), and any error.
type ChangePoller interface {
	PollChanges(ctx context.Context, organizationID, since string) ([]CacheChange, string, error)
}

// Service is the three-tier auth resolver.
type Service struct {
	l1            *lru.Cache[[64]byte, *entry]
	l2            L2Store
	resolver      KeyResolver
	configFetcher ConfigFetcher
	changePoller  ChangePoller
	logger        *zap.Logger

	refreshThreshold time.Duration
	softBump         time.Duration
	hardGrace        time.Duration

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
	// natural JWT exp. Default 6h. Setting 0 disables stale-while-error
	// entirely (legacy behavior: hard-fail at JWT exp).
	HardGrace     time.Duration
	Logger        *zap.Logger
	L2            L2Store // optional, nil = skip L2
	Resolver      KeyResolver
	ConfigFetcher ConfigFetcher
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
	// HardGrace == 0 is a documented opt-out (disables stale-while-error).
	// Only fill in the default when the field was unset entirely.
	if opts.HardGrace == 0 {
		opts.HardGrace = 6 * time.Hour
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
		refreshThreshold: opts.RefreshThreshold,
		softBump:         opts.SoftBump,
		hardGrace:        opts.HardGrace,
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

	// L1: in-memory
	if e, ok := s.l1.Get(h); ok {
		switch {
		case !e.softExpired():
			// Fresh: serve, maybe trigger background refresh on near-expiry.
			if e.nearSoftExpiry(s.refreshThreshold) {
				go s.refreshBackground(rawKey, h) //nolint:gosec // G118: intentional fire-and-forget refresh detached from request
			}
			return e.bundle, nil

		case !e.hardExpired():
			// Soft-expired but within hard grace. Try foreground refresh;
			// stale-while-error on transport failure.
			return s.refreshOrServeStale(ctx, rawKey, h, e)

		default:
			// Past hard cap: evict, fall through to fresh resolve.
			s.l1.Remove(h)
			s.logger.Error("auth_cache_hard_evict",
				zap.String("vk_id", e.bundle.VirtualKeyID),
				zap.String("reason", "hard_cap_exceeded_on_lookup"),
			)
		}
	}

	// L2: optional store
	if s.l2 != nil {
		hStr := string(h[:])
		if bundle, err := s.l2.Get(ctx, hStr); err == nil && bundle != nil {
			s.storeL1(h, bundle)
			return bundle, nil
		}
	}

	// L3: upstream resolver
	return s.resolveFresh(ctx, rawKey, h)
}

// resolveFresh calls the upstream resolver and caches the result.
// Used for cold L1+L2 misses; not on stale-entry refresh paths (those
// use refreshOrServeStale for the served-stale fallback).
func (s *Service) resolveFresh(ctx context.Context, rawKey string, h [64]byte) (*domain.Bundle, error) {
	bundle, err := s.resolver.ResolveKey(ctx, rawKey)
	if err != nil {
		return nil, err
	}
	s.populateConfig(ctx, bundle)
	s.storeL1(h, bundle)
	if s.l2 != nil {
		s.l2.Set(ctx, string(h[:]), bundle)
	}
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
		s.populateConfig(ctx, bundle)
		s.storeL1(h, bundle)
		if s.l2 != nil {
			s.l2.Set(ctx, string(h[:]), bundle)
		}
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
		newSoft, bumped := stale.bumpSoft(s.softBump)
		if !bumped {
			s.l1.Remove(h)
			s.logger.Error("auth_cache_hard_evict",
				zap.String("vk_id", vkID),
				zap.String("reason", "hard_cap_exceeded"),
				zap.Error(err),
			)
			return nil, err
		}
		s.logger.Warn("auth_cache_refresh_transport_failure",
			zap.String("vk_id", vkID),
			zap.Time("new_soft_expires_at", newSoft),
			zap.Duration("hard_grace_remaining", time.Until(hardExpiresAt)),
			zap.Error(err),
		)
		s.logger.Info("auth_cache_serve_stale",
			zap.String("vk_id", vkID),
			zap.Duration("stale_for", time.Since(staleBundle.ExpiresAt)),
			zap.Duration("hard_grace_remaining", time.Until(hardExpiresAt)),
			zap.String("refresh_error_class", cls.String()),
		)
		return staleBundle, nil
	}
}

// populateConfig eagerly fetches the bundle's config and merges it into the
// bundle. Failure here is non-fatal — the bundle still serves with empty
// config.Credentials, and downstream resolution will surface its own error.
func (s *Service) populateConfig(ctx context.Context, bundle *domain.Bundle) {
	if bundle == nil {
		return
	}
	cfg, err := s.configFetcher.FetchConfig(ctx, bundle.VirtualKeyID)
	if err != nil {
		s.logger.Warn("config_fetch_failed", zap.String("vk_id", bundle.VirtualKeyID), zap.Error(err))
		return
	}
	bundle.Config = cfg
	bundle.Credentials = cfg.Credentials
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

func (s *Service) storeL1(h [64]byte, bundle *domain.Bundle) {
	s.l1.Add(h, &entry{
		bundle:        bundle,
		softExpiresAt: bundle.ExpiresAt,
		hardExpiresAt: bundle.ExpiresAt.Add(s.hardGrace),
	})
	// Record the bundle's org so the change-feed loop knows which orgs
	// to subscribe to. LoadOrStore is the first-write-wins shape — if
	// the org's already known, the existing cursor is preserved so we
	// don't reset to "0" and re-stream the entire history on every new
	// bundle for an existing org.
	if bundle.OrganizationID != "" {
		s.activeOrgs.LoadOrStore(bundle.OrganizationID, &orgCursor{since: "0"})
	}
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
				s.applyChange(ch)
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
func (s *Service) applyChange(ch CacheChange) {
	switch ch.Kind {
	case ChangeKindProviderBindingUpdated:
		if ch.ProviderCredentialID == "" {
			return
		}
		s.evictWhere(func(b *domain.Bundle) bool {
			for _, c := range b.Config.Credentials {
				if c.ID == ch.ProviderCredentialID {
					return true
				}
			}
			return false
		}, "provider_binding_updated", ch.ProviderCredentialID)
	case ChangeKindBudgetUpdated:
		// BUDGET_UPDATED's project_id is the only stable join key
		// (budget_id alone doesn't appear in the bundle; budgets nest
		// under scopes). Evicting all bundles for the affected project
		// is conservative but correct — the next request re-fetches
		// the fresh limit/spent pair from the control plane.
		if ch.ProjectID == "" {
			return
		}
		s.evictWhere(func(b *domain.Bundle) bool {
			return b.ProjectID == ch.ProjectID
		}, "budget_updated", ch.ProjectID)
	case ChangeKindVirtualKeyUpdated:
		if ch.VirtualKeyID == "" {
			return
		}
		s.evictWhere(func(b *domain.Bundle) bool {
			return b.VirtualKeyID == ch.VirtualKeyID
		}, "virtual_key_updated", ch.VirtualKeyID)
	}
}

// evictWhere walks the L1 LRU once and removes every entry whose bundle
// matches the predicate. O(N) over LRUSize per call — acceptable for
// 10k-ish caches and the low frequency of admin mutations.
func (s *Service) evictWhere(match func(*domain.Bundle) bool, reason, target string) {
	keys := s.l1.Keys()
	evicted := 0
	for _, h := range keys {
		e, ok := s.l1.Get(h)
		if !ok {
			continue
		}
		if !match(e.bundle) {
			continue
		}
		s.l1.Remove(h)
		evicted++
	}
	if evicted > 0 {
		s.logger.Info("auth_cache_change_evict",
			zap.String("reason", reason),
			zap.String("target", target),
			zap.Int("evicted", evicted),
		)
	}
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
		s.populateConfig(ctx, bundle)
		s.storeL1(h, bundle)
		if s.l2 != nil {
			s.l2.Set(ctx, string(h[:]), bundle)
		}
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
			zap.Error(err),
		)
	}
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
