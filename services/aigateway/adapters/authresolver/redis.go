package authresolver

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// keyPrefix carries a version because the stored value's shape is part of the
// contract between nodes. v2 wraps the bundle in an envelope that dates its
// config; a v1 value cannot be dated, and a node that read one would have to
// guess an age. Bumping the prefix retires those values instead of guessing:
// they stop being read and expire on their existing TTL.
const keyPrefix = "gw:auth:v2:"
const minTTL = 30 * time.Second

// cachedBundleEnvelope is the stored shape of an L2 value: CachedBundle with
// the JSON names pinned, so the wire contract between nodes lives here rather
// than riding on the domain type. The bundle is nested rather than
// inlined so the envelope can carry metadata about it without colliding with
// the bundle's own fields. Layout must match CachedBundle, which the
// conversions below enforce at compile time.
type cachedBundleEnvelope struct {
	Bundle          *domain.Bundle `json:"bundle"`
	ConfigFetchedAt time.Time      `json:"config_fetched_at"`
}

// RedisStore is the L2 cache backed by Redis. Implements L2Store.
type RedisStore struct {
	client redis.UniversalClient
}

// NewRedisStore creates a Redis L2 store.
func NewRedisStore(client redis.UniversalClient) *RedisStore {
	return &RedisStore{client: client}
}

// Get retrieves a bundle from Redis by key hash.
func (s *RedisStore) Get(ctx context.Context, hash string) (*CachedBundle, error) {
	raw, err := s.client.Get(ctx, keyPrefix+hash).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}
	var env cachedBundleEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		_ = s.client.Del(ctx, keyPrefix+hash).Err()
		return nil, nil //nolint:nilerr // corrupted cache entry, treat as miss
	}
	if env.Bundle == nil {
		// Well-formed JSON that carries no bundle is nothing we can serve.
		_ = s.client.Del(ctx, keyPrefix+hash).Err()
		return nil, nil
	}
	if time.Now().After(env.Bundle.ExpiresAt) {
		return nil, nil
	}
	// A missing ConfigFetchedAt stays zero, which every reader treats as
	// stale now. Undatable config gets one refresh, never a fresh clock.
	cached := CachedBundle(env)
	return &cached, nil
}

// Set writes a bundle to Redis with TTL matching its expiry.
func (s *RedisStore) Set(ctx context.Context, hash string, cached CachedBundle) {
	if cached.Bundle == nil {
		return
	}
	ttl := time.Until(cached.Bundle.ExpiresAt)
	if ttl < minTTL {
		ttl = minTTL
	}
	raw, err := json.Marshal(cachedBundleEnvelope(cached))
	if err != nil {
		return
	}
	_ = s.client.Set(ctx, keyPrefix+hash, raw, ttl).Err()
}

// Delete removes a bundle from Redis, so a change-feed eviction reaches the
// copy every other gateway node shares.
func (s *RedisStore) Delete(ctx context.Context, hash string) error {
	return s.client.Del(ctx, keyPrefix+hash).Err()
}
