// Package authcache resolves virtual-key bearer tokens into domain.Bundle
// via a three-tier cache (L1 in-memory LRU → L2 Redis → L3 control plane).
// Implements app.AuthResolver.
package authcache

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Cache is the three-tier auth resolver.
type Cache struct {
	l1     *lru.Cache[string, *entry]
	l2     *redisStore
	cp     *ControlPlaneClient
	logger *zap.Logger

	refreshThreshold time.Duration
	onResolved       func(*domain.Bundle)

	mu     sync.Mutex
	maxRev int64
	stopCh chan struct{}
}

type entry struct {
	bundle    *domain.Bundle
	expiresAt time.Time
}

func (e *entry) expired() bool                   { return time.Now().After(e.expiresAt) }
func (e *entry) nearExpiry(threshold time.Duration) bool { return time.Until(e.expiresAt) < threshold }

// Options configures the auth cache.
type Options struct {
	BaseURL           string
	InternalSecret    string
	JWTSecret         string
	JWTSecretPrevious string
	NodeID            string
	LRUSize           int
	Redis             redis.UniversalClient
	RefreshThreshold  time.Duration
	Logger            *zap.Logger
	OnResolved        func(*domain.Bundle)
}

// New creates the auth cache.
func New(opts Options) (*Cache, error) {
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

	signer := NewSigner(opts.InternalSecret, opts.NodeID)
	verifier := NewJWTVerifier(opts.JWTSecret, opts.JWTSecretPrevious)
	cp := NewControlPlaneClient(opts.BaseURL, signer, verifier, &http.Client{Timeout: 2 * time.Second})

	var l2 *redisStore
	if opts.Redis != nil {
		l2 = newRedisStore(opts.Redis)
	}

	return &Cache{
		l1:               l1,
		l2:               l2,
		cp:               cp,
		logger:           opts.Logger,
		refreshThreshold: opts.RefreshThreshold,
		onResolved:       opts.OnResolved,
		stopCh:           make(chan struct{}),
	}, nil
}

// Resolve returns a Bundle for the raw bearer token.
// Checks L1 → L2 → control plane, caching at each tier.
func (c *Cache) Resolve(ctx context.Context, rawKey string) (*domain.Bundle, error) {
	if rawKey == "" {
		return nil, herr.New(ctx, ErrInvalidKey, nil)
	}

	h := hashKey(rawKey)

	// L1: in-memory
	if e, ok := c.l1.Get(h); ok && !e.expired() {
		if e.nearExpiry(c.refreshThreshold) {
			go c.refreshBackground(rawKey)
		}
		return e.bundle, nil
	}

	// L2: Redis
	if c.l2 != nil {
		if bundle, err := c.l2.Get(ctx, h); err == nil && bundle != nil {
			c.storeL1(h, bundle)
			return bundle, nil
		}
	}

	// L3: control plane
	bundle, err := c.cp.ResolveKey(ctx, rawKey)
	if err != nil {
		return nil, err
	}

	// Eagerly fetch config
	if config, cfgErr := c.cp.FetchConfig(ctx, bundle.VirtualKeyID); cfgErr == nil {
		bundle.Config = config
	} else {
		c.logger.Warn("config_fetch_failed", zap.String("vk_id", bundle.VirtualKeyID), zap.Error(cfgErr))
	}

	c.storeL1(h, bundle)
	if c.l2 != nil {
		c.l2.Set(ctx, h, bundle)
	}
	if c.onResolved != nil {
		c.onResolved(bundle)
	}

	return bundle, nil
}

// KnownRevision returns the max revision observed (for readiness probes).
func (c *Cache) KnownRevision() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.maxRev
}

// Start launches the background refresh loop.
func (c *Cache) Start(ctx context.Context) {
	go c.loop(ctx)
}

// Stop signals background goroutines to exit.
func (c *Cache) Stop() {
	select {
	case <-c.stopCh:
	default:
		close(c.stopCh)
	}
}

// SignRequest delegates to the underlying signer (used by budget/guardrails).
func (c *Cache) SignRequest(req *http.Request, body []byte) {
	c.cp.signer.Sign(req, body)
}

// --- Internal ---

func (c *Cache) storeL1(h string, bundle *domain.Bundle) {
	c.l1.Add(h, &entry{bundle: bundle, expiresAt: bundle.ExpiresAt})
}

func (c *Cache) refreshBackground(rawKey string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	bundle, err := c.cp.ResolveKey(ctx, rawKey)
	if err != nil {
		c.logger.Debug("background_refresh_failed", zap.Error(err))
		return
	}
	c.storeL1(hashKey(rawKey), bundle)
}

func (c *Cache) loop(ctx context.Context) {
	t := time.NewTicker(60 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.stopCh:
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

