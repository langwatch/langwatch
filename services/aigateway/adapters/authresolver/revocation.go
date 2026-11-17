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
	for _, h := range s.lastKnown.Keys() {
		if e, ok := s.lastKnown.Peek(h); ok && e.bundle != nil && e.bundle.VirtualKeyID == vkID {
			s.deniedKeys.Add(h, vkID)
		}
	}
	s.logger.Info("auth_cache_key_denied", zap.String("vk_id", vkID), zap.String("reason", evictReason(kind)))
}

// clearDenial lifts vkID's denial and forgets the credentials that carried
// it. A re-enable or a confirmation that began after the denial calls it.
func (s *Service) clearDenial(vkID string) {
	s.denied.Remove(vkID)
	for _, h := range s.deniedKeys.Keys() {
		if v, ok := s.deniedKeys.Peek(h); ok && v == vkID {
			s.deniedKeys.Remove(h)
		}
	}
}

// confirmedAt is the latest confirmation the cache holds for h, zero if none.
func (s *Service) confirmedAt(h [64]byte) time.Time {
	var at time.Time
	if e, ok := s.l1.Peek(h); ok {
		at = e.authStart()
	}
	if e, ok := s.lastKnown.Peek(h); ok {
		if t := e.authStart(); t.After(at) {
			at = t
		}
	}
	return at
}

// served is one resolved answer waiting for the gate: the bundle, when the
// control-plane call that confirmed it began, and the stale tier it came from
// ("" when fresh). It travels with the answer, never read back from L1.
type served struct {
	bundle    *domain.Bundle
	authStart time.Time
	stale     string
}

// admit is the last check before a resolved bundle serves. It refuses a key the
// change feed revoked after its confirmation began, and, when FailClosedAfter
// is set, a key nothing confirmed recently while its org's feed is silent.
func (s *Service) admit(ctx context.Context, h [64]byte, in served) (*domain.Bundle, error) {
	b, authStart := in.bundle, in.authStart
	if b.VirtualKeyID != "" {
		if d, ok := s.denied.Peek(b.VirtualKeyID); ok {
			if d.at.After(authStart) {
				s.refuseDenial(h, b.VirtualKeyID, "denied_"+evictReason(d.kind))
				return nil, denialError(ctx, d.kind)
			}
			s.clearDenial(b.VirtualKeyID)
		}
	}
	if s.failClosedAfter > 0 && b.OrganizationID != "" && s.feedSilent(b.OrganizationID) &&
		time.Since(authStart) > s.failClosedAfter {
		s.countRefusal(b.VirtualKeyID, "fail_closed")
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

// refuseDenied answers a credential the change feed denied, and that nothing
// confirmed since, with that denial's error. It returns nil for any other.
func (s *Service) refuseDenied(ctx context.Context, h [64]byte) error {
	vkID, ok := s.deniedKeys.Peek(h)
	if !ok {
		return nil
	}
	d, ok := s.denied.Peek(vkID)
	if !ok || !d.at.After(s.confirmedAt(h)) {
		return nil
	}
	s.refuseDenial(h, vkID, "denied_"+evictReason(d.kind))
	return denialError(ctx, d.kind)
}

// refuseDenial drops every cached copy of h, remembers it as denied, and
// counts the refusal.
func (s *Service) refuseDenial(h [64]byte, vkID, reason string) {
	s.l1.Remove(h)
	s.lastKnown.Remove(h)
	s.deniedKeys.Add(h, vkID)
	s.countRefusal(vkID, reason)
}

// countRefusal logs and counts a refusal. A fail-closed refusal calls it
// alone, so the cached entry stays for when the control plane answers again.
func (s *Service) countRefusal(vkID, reason string) {
	s.logger.Warn("auth_cache_refused", zap.String("vk_id", vkID), zap.String("reason", reason))
	if s.metrics != nil {
		s.metrics.RecordAuthCacheRefusal(reason)
	}
}

func (s *Service) recordStaleServe(source string) {
	if s.metrics != nil {
		s.metrics.RecordAuthCacheStaleServe(source)
	}
}

func denialError(ctx context.Context, kind string) error {
	if kind == ChangeKindVirtualKeyDisabled {
		return herr.New(ctx, domain.ErrKeyDisabled, herr.M{"message": domain.KeyDisabledMessage})
	}
	return herr.New(ctx, domain.ErrKeyRevoked, herr.M{"message": domain.KeyRevokedMessage})
}
