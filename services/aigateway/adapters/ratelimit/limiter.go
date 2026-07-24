// Package ratelimit enforces per-VK request-rate ceilings (RPM/RPD).
// In-memory token bucket per VK with LRU eviction.
package ratelimit

import (
	"context"
	"fmt"
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"golang.org/x/time/rate"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Limiter enforces per-VK rate limits. Implements app.RateLimiter.
type Limiter struct {
	cache *lru.Cache[string, *buckets]
	mu    sync.Mutex
}

// Options configures the limiter.
type Options struct {
	MaxVKs int // LRU size (default 50000)
}

// New creates a Limiter.
func New(opts Options) (*Limiter, error) {
	if opts.MaxVKs <= 0 {
		opts.MaxVKs = 50_000
	}
	c, err := lru.New[string, *buckets](opts.MaxVKs)
	if err != nil {
		return nil, err
	}
	return &Limiter{cache: c}, nil
}

// Allow returns nil if the request is permitted, or an error if the VK's
// rate limit has been exceeded.
func (l *Limiter) Allow(_ context.Context, vkID string, limits domain.RateLimits) error {
	if vkID == "" || (limits.RPM <= 0 && limits.RPD <= 0) {
		return nil
	}

	b := l.bucketsFor(vkID, limits)
	now := time.Now()

	// Reserve RPM
	var rpmRes *rate.Reservation
	if b.rpm != nil {
		r := b.rpm.ReserveN(now, 1)
		rpmRes = r
		if !r.OK() || r.DelayFrom(now) > 0 {
			r.CancelAt(now)
			return fmt.Errorf("rpm %d exceeded", limits.RPM)
		}
	}

	// Reserve RPD
	if b.rpd != nil {
		r := b.rpd.ReserveN(now, 1)
		if !r.OK() || r.DelayFrom(now) > 0 {
			r.CancelAt(now)
			if rpmRes != nil {
				rpmRes.CancelAt(now)
			}
			return fmt.Errorf("rpd %d exceeded", limits.RPD)
		}
	}

	return nil
}

// Invalidate drops cached buckets so next Allow() rebuilds with fresh ceilings.
func (l *Limiter) Invalidate(vkID string) {
	l.cache.Remove(vkID)
}

func (l *Limiter) bucketsFor(vkID string, limits domain.RateLimits) *buckets {
	if existing, ok := l.cache.Get(vkID); ok {
		if sameCeilings(existing, limits) {
			return existing
		}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if existing, ok := l.cache.Get(vkID); ok && sameCeilings(existing, limits) {
		return existing
	}
	b := &buckets{}
	if limits.RPM > 0 {
		b.rpm = rate.NewLimiter(rate.Limit(float64(limits.RPM)/60.0), limits.RPM)
	}
	if limits.RPD > 0 {
		b.rpd = rate.NewLimiter(rate.Limit(float64(limits.RPD)/86400.0), limits.RPD)
	}
	l.cache.Add(vkID, b)
	return b
}

type buckets struct {
	rpm *rate.Limiter
	rpd *rate.Limiter
}

func sameCeilings(b *buckets, limits domain.RateLimits) bool {
	if (limits.RPM > 0) != (b.rpm != nil) {
		return false
	}
	if b.rpm != nil && b.rpm.Burst() != limits.RPM {
		return false
	}
	if (limits.RPD > 0) != (b.rpd != nil) {
		return false
	}
	if b.rpd != nil && b.rpd.Burst() != limits.RPD {
		return false
	}
	return true
}
