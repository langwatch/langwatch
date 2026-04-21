// Package authresolver resolves virtual-key bearer tokens into domain.Bundle
// via a three-tier cache (L1 in-memory LRU → L2 optional store → L3 upstream resolver).
package authresolver

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
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
	l1            *lru.Cache[string, *entry]
	l2            L2Store
	resolver      KeyResolver
	configFetcher ConfigFetcher
	logger        *zap.Logger

	refreshThreshold time.Duration

	mu     sync.Mutex
	maxRev int64
	stopCh chan struct{}
}

type entry struct {
	bundle    *domain.Bundle
	expiresAt time.Time
}

func (e *entry) expired() bool                           { return time.Now().After(e.expiresAt) }
func (e *entry) nearExpiry(threshold time.Duration) bool { return time.Until(e.expiresAt) < threshold }

// Options configures the auth service.
type Options struct {
	LRUSize          int
	RefreshThreshold time.Duration
	Logger           *zap.Logger
	L2               L2Store // optional, nil = skip L2
	Resolver         KeyResolver
	ConfigFetcher    ConfigFetcher
}

// New creates the auth service.
func New(opts Options) (*Service, error) {
	if opts.LRUSize <= 0 {
		opts.LRUSize = 10_000
	}
	if opts.RefreshThreshold == 0 {
		opts.RefreshThreshold = 5 * time.Minute
	}

	l1, err := lru.New[string, *entry](opts.LRUSize)
	if err != nil {
		return nil, err
	}

	return &Service{
		l1:               l1,
		l2:               opts.L2,
		resolver:         opts.Resolver,
		configFetcher:    opts.ConfigFetcher,
		logger:           opts.Logger,
		refreshThreshold: opts.RefreshThreshold,
		stopCh:           make(chan struct{}),
	}, nil
}

// Resolve returns a Bundle for the raw bearer token.
// Checks L1 → L2 → upstream resolver, caching at each tier.
func (s *Service) Resolve(ctx context.Context, rawKey string) (*domain.Bundle, error) {
	if rawKey == "" {
		return nil, herr.New(ctx, domain.ErrInvalidAPIKey, nil)
	}

	h := hashKey(rawKey)

	// L1: in-memory
	if e, ok := s.l1.Get(h); ok && !e.expired() {
		if e.nearExpiry(s.refreshThreshold) {
			go s.refreshBackground(rawKey) //nolint:gosec // G118: intentional fire-and-forget refresh detached from request
		}
		return e.bundle, nil
	}

	// L2: optional store
	if s.l2 != nil {
		if bundle, err := s.l2.Get(ctx, h); err == nil && bundle != nil {
			s.storeL1(h, bundle)
			return bundle, nil
		}
	}

	// L3: upstream resolver
	bundle, err := s.resolver.ResolveKey(ctx, rawKey)
	if err != nil {
		return nil, err
	}

	// Eagerly fetch config
	if config, cfgErr := s.configFetcher.FetchConfig(ctx, bundle.VirtualKeyID); cfgErr == nil {
		bundle.Config = config
		bundle.Credentials = config.Credentials
	} else {
		s.logger.Warn("config_fetch_failed", zap.String("vk_id", bundle.VirtualKeyID), zap.Error(cfgErr))
	}

	s.storeL1(h, bundle)
	if s.l2 != nil {
		s.l2.Set(ctx, h, bundle)
	}

	return bundle, nil
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

func (s *Service) storeL1(h string, bundle *domain.Bundle) {
	s.l1.Add(h, &entry{bundle: bundle, expiresAt: bundle.ExpiresAt})
}

func (s *Service) refreshBackground(rawKey string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	bundle, err := s.resolver.ResolveKey(ctx, rawKey)
	if err != nil {
		s.logger.Debug("background_refresh_failed", zap.Error(err))
		return
	}
	s.storeL1(hashKey(rawKey), bundle)
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

func hashKey(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}
