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

// Service is the three-tier auth resolver.
type Service struct {
	l1            *lru.Cache[[64]byte, *entry]
	l2            L2Store
	resolver      KeyResolver
	configFetcher ConfigFetcher
	logger        *zap.Logger

	refreshThreshold time.Duration
	softBump         time.Duration
	hardGrace        time.Duration

	mu     sync.Mutex
	maxRev int64
	stopCh chan struct{}
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
	// natural JWT exp. Default 30m. Setting 0 disables stale-while-error
	// entirely (legacy behavior: hard-fail at JWT exp).
	HardGrace     time.Duration
	Logger        *zap.Logger
	L2            L2Store // optional, nil = skip L2
	Resolver      KeyResolver
	ConfigFetcher ConfigFetcher
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
		opts.HardGrace = 30 * time.Minute
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

// KnownRevision returns the max revision observed (for readiness probes).
func (s *Service) KnownRevision() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.maxRev
}

// Start launches the background refresh loop.
func (s *Service) Start(ctx context.Context) {
	go s.loop(ctx)
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
