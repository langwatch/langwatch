package authresolver

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const keyPrefix = "gw:auth:"
const minTTL = 30 * time.Second

// RedisStore is the L2 cache backed by Redis. Implements L2Store.
type RedisStore struct {
	client redis.UniversalClient
}

// NewRedisStore creates a Redis L2 store.
func NewRedisStore(client redis.UniversalClient) *RedisStore {
	return &RedisStore{client: client}
}

// Get retrieves a bundle from Redis by key hash.
func (s *RedisStore) Get(ctx context.Context, hash string) (*domain.Bundle, error) {
	raw, err := s.client.Get(ctx, keyPrefix+hash).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, err
	}
	var bundle domain.Bundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		_ = s.client.Del(ctx, keyPrefix+hash).Err()
		return nil, nil //nolint:nilerr // corrupted cache entry — treat as miss
	}
	if time.Now().After(bundle.ExpiresAt) {
		return nil, nil
	}
	return &bundle, nil
}

// Set writes a bundle to Redis with TTL matching its expiry.
func (s *RedisStore) Set(ctx context.Context, hash string, bundle *domain.Bundle) {
	if bundle == nil {
		return
	}
	ttl := time.Until(bundle.ExpiresAt)
	if ttl < minTTL {
		ttl = minTTL
	}
	raw, err := json.Marshal(bundle)
	if err != nil {
		return
	}
	_ = s.client.Set(ctx, keyPrefix+hash, raw, ttl).Err()
}
