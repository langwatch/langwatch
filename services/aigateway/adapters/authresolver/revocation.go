package authresolver

import (
	"context"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Revocation list and fail-closed gate. See specs/ai-gateway/auth-cache.feature,
// Rule "A revoked key is refused from every cache tier, even with the control
// plane down".

// denySetSize bounds the revocation list. A denial only matters while an entry
// confirmed before it can still be cached, so the oldest can go first.
const denySetSize = 1 << 16

// denial records that every confirmation of a virtual key started before at is
// void. kind is the change-feed event that caused it.
type denial struct {
	at   time.Time
	kind string
}

// RevocationMetrics is the optional metrics surface for refusals and
// stale serves. The gateway's Prometheus recorder satisfies it.
type RevocationMetrics interface {
	RecordAuthCacheRefusal(reason string)
	RecordAuthCacheStaleServe(source string)
}

func newDenySet() *lru.Cache[string, denial] {
	c, err := lru.New[string, denial](denySetSize)
	if err != nil {
		panic(err) // only fails for a non-positive size
	}
	return c
}

func newDeniedKeys() *lru.Cache[[64]byte, string] {
	c, err := lru.New[[64]byte, string](denySetSize)
	if err != nil {
		panic(err) // only fails for a non-positive size
	}
	return c
}

func newOrgCursor() *orgCursor {
	c := &orgCursor{since: "0"}
	c.polledAt.Store(time.Now().UnixNano())
	return c
}

// authFrom stamps when the confirming control-plane call began. Call it before
// the entry is published.
func (e *entry) authFrom(t time.Time) *entry {
	e.authStartedAt = t
	return e
}

func (e *entry) authStart() time.Time {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.authStartedAt
}

// deny voids every confirmation of vkID that started before now, and remembers
// which cached credentials carried it so an outage still answers them with the
// key's own error rather than a retryable one.
func (s *Service) deny(vkID, kind string) {
	s.denied.Add(vkID, denial{at: time.Now(), kind: kind})
	for _, h := range s.l1.Keys() {
		if e, ok := s.l1.Peek(h); ok && e.bundle.VirtualKeyID == vkID {
			s.deniedKeys.Add(h, vkID)
		}
	}
	s.logger.Info("auth_cache_key_denied", zap.String("vk_id", vkID), zap.String("reason", evictReason(kind)))
}

// admitInput is one resolved answer waiting for the gate.
type admitInput struct {
	hash         [64]byte
	bundle       *domain.Bundle
	requestStart time.Time
}

// admit is the last check before a resolved bundle serves. It refuses a key the
// change feed revoked after its confirmation began, and, when FailClosedAfter
// is set, a key nothing confirmed recently while its org's feed is silent.
func (s *Service) admit(ctx context.Context, in admitInput) (*domain.Bundle, error) {
	b := in.bundle
	authStart := in.requestStart
	if e, ok := s.l1.Peek(in.hash); ok && e.bundle.VirtualKeyID == b.VirtualKeyID {
		authStart = e.authStart()
	}
	if b.VirtualKeyID != "" {
		if d, ok := s.denied.Peek(b.VirtualKeyID); ok && d.at.After(authStart) {
			s.refuse(in.hash, b.VirtualKeyID, "denied_"+evictReason(d.kind))
			return nil, denialError(ctx, d.kind)
		}
	}
	if s.failClosedAfter > 0 && b.OrganizationID != "" && s.feedSilent(b.OrganizationID) &&
		time.Since(authStart) > s.failClosedAfter {
		s.refuse(in.hash, b.VirtualKeyID, "fail_closed")
		return nil, herr.New(ctx, domain.ErrAuthUpstream, herr.M{
			"message": "control plane unreachable and this gateway refuses keys it cannot re-check; retry shortly",
		}).WithRetryable(true)
	}
	return b, nil
}

// feedSilent reports whether the org's change feed has gone without an answer
// for longer than FailClosedAfter.
func (s *Service) feedSilent(orgID string) bool {
	v, ok := s.activeOrgs.Load(orgID)
	if !ok {
		return true
	}
	c, _ := v.(*orgCursor)
	return time.Since(time.Unix(0, c.polledAt.Load())) > s.failClosedAfter
}

// deniedAnswer turns a transport failure for a credential the change feed
// denied into that denial's error. Any other error passes through unchanged.
func (s *Service) deniedAnswer(ctx context.Context, h [64]byte, err error) error {
	if classifyRefreshError(err) != classTransportFailure {
		return err
	}
	vkID, ok := s.deniedKeys.Peek(h)
	if !ok {
		return err
	}
	if d, ok := s.denied.Peek(vkID); ok {
		s.logger.Warn("auth_cache_refused", zap.String("vk_id", vkID), zap.String("reason", "denied_"+evictReason(d.kind)))
		return denialError(ctx, d.kind)
	}
	return err
}

func (s *Service) refuse(h [64]byte, vkID, reason string) {
	s.l1.Remove(h)
	if reason != "fail_closed" {
		s.lastKnown.Remove(h)
		s.deniedKeys.Add(h, vkID)
	}
	s.logger.Warn("auth_cache_refused", zap.String("vk_id", vkID), zap.String("reason", reason))
	if m, ok := s.metrics.(RevocationMetrics); ok {
		m.RecordAuthCacheRefusal(reason)
	}
}

func (s *Service) recordStaleServe(source string) {
	if m, ok := s.metrics.(RevocationMetrics); ok {
		m.RecordAuthCacheStaleServe(source)
	}
}

func denialError(ctx context.Context, kind string) error {
	if kind == ChangeKindVirtualKeyDisabled {
		return herr.New(ctx, domain.ErrKeyDisabled, herr.M{"message": "This key is disabled."})
	}
	return herr.New(ctx, domain.ErrKeyRevoked, herr.M{"message": "This key was revoked."})
}
