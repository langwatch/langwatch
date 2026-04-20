// Package ratelimit enforces the per-VK request-rate ceilings in
// `config.rate_limits`. Three dimensions, following the contract:
//
//   - RPM: requests per minute (instantaneous burst control)
//   - RPD: requests per day (quota-style cap)
//   - TPM: tokens per minute — DEFERRED to v1.1 (needs post-response
//          enforcement since the token count isn't known until the
//          provider replies; pre-estimation is too imprecise for a
//          hard cap and too lenient for a soft cap).
//
// The limiter is an in-memory token bucket per VK per dimension, stored
// in a hashicorp/golang-lru cache so we don't leak memory for keys
// that stop being used. A single gateway pod is the unit of
// enforcement — under HPA there's some over-limit drift (N pods × per-
// pod ceiling) but that's an explicit design trade: v1 prioritises
// zero-dependency (no Redis round-trip on the hot path) over strict
// cluster-wide correctness. Redis-coordinated counters are a follow-up.
package ratelimit

import (
	"fmt"
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"golang.org/x/time/rate"
)

// Decision is what the dispatcher acts on.
type Decision struct {
	Allowed    bool
	Reason     string        // non-empty on deny
	RetryAfter time.Duration // > 0 on deny; zero = retry immediately
	Dimension  string        // rpm|rpd — which bucket breached
}

// Config is just the subset of `auth.Config.RateLimits` that we enforce.
// Passing in the narrow shape keeps the package dependency-free from
// the auth package (avoids a cycle if auth ever wants to log/enforce
// limits itself).
type Config struct {
	RPM int // requests per minute
	RPD int // requests per day
}

// vkBuckets groups the per-dimension limiters for one VK.
type vkBuckets struct {
	rpm *rate.Limiter // refill = RPM/60 per second, burst = RPM
	rpd *rate.Limiter // refill = RPD/86400 per second, burst = RPD
}

// Limiter enforces per-VK limits. Safe for concurrent use.
type Limiter struct {
	cache *lru.Cache[string, *vkBuckets]
	mu    sync.Mutex
}

// Options configures the limiter.
type Options struct {
	// MaxVKs caps the LRU size so a flood of distinct keys can't
	// balloon memory. 50k is plenty for any realistic multi-tenant
	// scale; cold VKs fall out and get rebuilt on next request.
	MaxVKs int
}

// New builds a Limiter.
func New(opts Options) (*Limiter, error) {
	if opts.MaxVKs <= 0 {
		opts.MaxVKs = 50_000
	}
	c, err := lru.New[string, *vkBuckets](opts.MaxVKs)
	if err != nil {
		return nil, err
	}
	return &Limiter{cache: c}, nil
}

// Allow evaluates whether one request from this VK may proceed.
// Config with both limits == 0 is a no-op (allow). The limiter takes
// one token from each configured dimension; if any dimension would
// go below zero we deny with a Retry-After pointing at the earliest
// refill time across the breached dimensions.
func (l *Limiter) Allow(vkID string, cfg Config) Decision {
	if vkID == "" || (cfg.RPM <= 0 && cfg.RPD <= 0) {
		return Decision{Allowed: true}
	}
	buckets := l.bucketsFor(vkID, cfg)
	now := time.Now()

	// We must reserve both tokens before committing so partial refusal
	// doesn't burn budget on the allowed dimension when the other
	// breaches. `Reserve` returns a Reservation we can Cancel.
	var resRPM *rate.Reservation
	if buckets.rpm != nil {
		r := buckets.rpm.ReserveN(now, 1)
		resRPM = r
		if !r.OK() || r.DelayFrom(now) > 0 {
			retry := r.DelayFrom(now)
			r.CancelAt(now)
			return Decision{
				Allowed:    false,
				Reason:     fmt.Sprintf("rpm %d exceeded", cfg.RPM),
				RetryAfter: retry,
				Dimension:  "rpm",
			}
		}
	}
	if buckets.rpd != nil {
		r := buckets.rpd.ReserveN(now, 1)
		if !r.OK() || r.DelayFrom(now) > 0 {
			retry := r.DelayFrom(now)
			r.CancelAt(now)
			if resRPM != nil {
				resRPM.CancelAt(now)
			}
			return Decision{
				Allowed:    false,
				Reason:     fmt.Sprintf("rpd %d exceeded", cfg.RPD),
				RetryAfter: retry,
				Dimension:  "rpd",
			}
		}
	}
	return Decision{Allowed: true}
}

// bucketsFor fetches or builds the buckets for a VK. Rebuilds if the
// effective ceiling drifted (e.g. admin raised RPM on the VK while
// the limiter still had the old value cached).
func (l *Limiter) bucketsFor(vkID string, cfg Config) *vkBuckets {
	if existing, ok := l.cache.Get(vkID); ok {
		if sameCeilings(existing, cfg) {
			return existing
		}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if existing, ok := l.cache.Get(vkID); ok && sameCeilings(existing, cfg) {
		return existing
	}
	b := &vkBuckets{}
	if cfg.RPM > 0 {
		b.rpm = rate.NewLimiter(rate.Limit(float64(cfg.RPM)/60.0), cfg.RPM)
	}
	if cfg.RPD > 0 {
		b.rpd = rate.NewLimiter(rate.Limit(float64(cfg.RPD)/86400.0), cfg.RPD)
	}
	l.cache.Add(vkID, b)
	return b
}

func sameCeilings(b *vkBuckets, cfg Config) bool {
	wantRPM := cfg.RPM > 0
	hasRPM := b.rpm != nil
	if wantRPM != hasRPM {
		return false
	}
	if wantRPM && int(b.rpm.Burst()) != cfg.RPM {
		return false
	}
	wantRPD := cfg.RPD > 0
	hasRPD := b.rpd != nil
	if wantRPD != hasRPD {
		return false
	}
	if wantRPD && int(b.rpd.Burst()) != cfg.RPD {
		return false
	}
	return true
}

// Invalidate drops the cached buckets for a VK. Call this when a
// config revision flips so the next Allow() rebuilds with fresh
// ceilings.
func (l *Limiter) Invalidate(vkID string) {
	l.cache.Remove(vkID)
}
