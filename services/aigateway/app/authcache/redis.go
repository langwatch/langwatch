package authcache

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

// redisStore is the L2 cache backed by Redis.
type redisStore struct {
	client redis.UniversalClient
}

func newRedisStore(client redis.UniversalClient) *redisStore {
	return &redisStore{client: client}
}

// Get retrieves a bundle from Redis by key hash.
func (s *redisStore) Get(ctx context.Context, hash string) (*domain.Bundle, error) {
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
		return nil, nil
	}
	if time.Now().After(bundle.ExpiresAt) {
		return nil, nil
	}
	return &bundle, nil
}

// Set writes a bundle to Redis with TTL matching its expiry.
func (s *redisStore) Set(ctx context.Context, hash string, bundle *domain.Bundle) {
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
