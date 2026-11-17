package authresolver

import (
	"context"
	"sync"
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

// DefaultDenialRecheckInterval is how often a denied key may be re-checked
// against the control plane when no re-enable event arrives.
const DefaultDenialRecheckInterval = 30 * time.Second

// denialRecheckTimeout bounds one background recheck call.
const denialRecheckTimeout = 10 * time.Second

// denialRechecks paces background rechecks of denied credentials: at most one
// per credential per interval, and never two at once for the same credential.
type denialRechecks struct {
	mu       sync.Mutex
	interval time.Duration
	state    *lru.Cache[[64]byte, recheckState]
}

type recheckState struct {
	last    time.Time
	running bool
}

// begin claims the recheck of h when none runs and the last one, or the
// denial itself, is at least one interval old.
func (r *denialRechecks) begin(h [64]byte, deniedAt time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	st, _ := r.state.Peek(h)
	since := deniedAt
	if st.last.After(since) {
		since = st.last
	}
	if st.running || time.Since(since) < r.interval {
		return false
	}
	r.state.Add(h, recheckState{last: time.Now(), running: true})
	return true
}

func (r *denialRechecks) end(h [64]byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if st, ok := r.state.Peek(h); ok {
		st.running = false
		r.state.Add(h, st)
	}
}

// scheduleRecheck starts a background control-plane check of a denied
// credential when one is due. Every other request is refused locally.
func (s *Service) scheduleRecheck(key domain.PresentedKey, h [64]byte) {
	vkID, ok := s.deniedKeys.Peek(h)
	if !ok {
		return
	}
	d, ok := s.denied.Peek(vkID)
	if !ok || !s.rechecks.begin(h, d.at) {
		return
	}
	go s.recheckDenied(key, h, vkID)
}

// recheckDenied asks the control plane about a denied credential and lifts
// the denial when the key is confirmed and no newer denial landed meanwhile.
func (s *Service) recheckDenied(key domain.PresentedKey, h [64]byte, vkID string) {
	defer s.rechecks.end(h)
	ctx, cancel := context.WithTimeout(context.Background(), denialRecheckTimeout)
	defer cancel()
	go func() {
		select {
		case <-s.stopCh:
			cancel()
		case <-ctx.Done():
		}
	}()
	answer, err := s.resolveFresh(ctx, key, h)
	if err != nil {
		return
	}
	if d, ok := s.denied.Peek(vkID); ok && d.at.After(answer.authStart) {
		return
	}
	s.clearDenial(vkID)
	s.logger.Info("auth_cache_denial_cleared", zap.String("vk_id", vkID), zap.String("source", "recheck"))
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
// it. A re-enable, a confirmation that began after the denial, or a
// background recheck calls it.
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
				s.dropAndCountDenied(h, b.VirtualKeyID, "denied_"+evictReason(d.kind))
				return nil, denialError(ctx, d.kind)
			}
			s.clearDenial(b.VirtualKeyID)
		}
	}
	if s.failClosedAfter > 0 && s.feedSilent(b.OrganizationID) &&
		time.Since(authStart) > s.failClosedAfter {
		// Resolve counts this refusal once the key re-check has had its say.
		return nil, herr.New(ctx, domain.ErrAuthUpstream, herr.M{
			"message": "control plane unreachable and this gateway refuses keys it cannot re-check; retry shortly",
		}).WithRetryable(true)
	}
	return b, nil
}

// claimReconfirm lets one request per FailClosedReconfirmInterval re-check a
// cached key with the control plane before fail closed refuses it. A config
// answer is no key check: the config route does not look at key status.
func (s *Service) claimReconfirm(h [64]byte) bool {
	e, ok := s.l1.Peek(h)
	if !ok {
		return false
	}
	now, last := time.Now().UnixNano(), e.reconfirmAt.Load()
	if now-last < int64(FailClosedReconfirmInterval) {
		return false
	}
	return e.reconfirmAt.CompareAndSwap(last, now)
}

// reconfirm is the key re-check fail closed makes. A rejection evicts both
// cached copies; a config fetch that fails after the key checked out keeps
// the cached config and its deadlines, with the fresh key check stamped.
func (s *Service) reconfirm(ctx context.Context, key domain.PresentedKey, h [64]byte) (served, error) {
	since := s.fetchGeneration()
	start := time.Now()
	bundle, err := s.resolver.ResolveKey(ctx, key)
	if err != nil {
		if classifyRefreshError(err) == classAuthRejection {
			s.dropRejected(h, err)
		}
		return served{}, err
	}
	etag, cfgErr := s.populateConfig(ctx, bundle)
	if cfgErr == nil {
		s.publishFetched(h, s.newEntry(bundle, etag).authFrom(start), since)
		return served{bundle: bundle, authStart: start}, nil
	}
	if classifyRefreshError(cfgErr) == classAuthRejection {
		s.dropRejected(h, cfgErr)
		return served{}, cfgErr
	}
	if bundle.KeyExpired(time.Now()) {
		return served{}, herr.New(ctx, domain.ErrKeyExpired, herr.M{"message": domain.KeyExpiredMessage})
	}
	if e, ok := s.l1.Peek(h); ok && servableEntry(e) {
		return s.keepCachedConfig(h, cachedConfigKeep{e: e, check: served{bundle: bundle, authStart: start}, since: since}), nil
	}
	return served{}, errConfigUnavailable(ctx, cfgErr)
}

// servableEntry reports whether e may still serve its config: fresh, or
// stale inside its hard cap.
func servableEntry(e *entry) bool {
	state := classifyEntry(e)
	return state == entryFresh || state == entryStale
}

// cachedConfigKeep is the cached entry, the fresh key answer and the
// generation the re-check started at.
type cachedConfigKeep struct {
	e     *entry
	check served
	since uint64
}

// keepCachedConfig re-stores e with the fresh key answer and e's config,
// never past e's own deadlines.
func (s *Service) keepCachedConfig(h [64]byte, in cachedConfigKeep) served {
	e, since := in.e, in.since
	fresh, start := in.check.bundle, in.check.authStart
	e.mu.Lock()
	merged := *fresh
	merged.Config, merged.Credentials = e.bundle.Config, e.bundle.Credentials
	soft, hard := entryDeadlines(&merged, s.hardGrace)
	if e.softExpiresAt.Before(soft) {
		soft = e.softExpiresAt
	}
	if e.hardExpiresAt.Before(hard) {
		hard = e.hardExpiresAt
	}
	kept := &entry{
		bundle: &merged, softExpiresAt: soft, hardExpiresAt: hard,
		configFetchedAt: e.configFetchedAt, configConfirmedAt: e.configConfirmedAt,
		configETag: e.configETag, budgetRollAckedFor: e.budgetRollAckedFor,
		budgetChanges: e.budgetChanges, authStartedAt: start,
	}
	e.mu.Unlock()
	s.publishFetched(h, kept, since)
	return served{bundle: &merged, authStart: start}
}

// dropRejected evicts both cached copies of a key the control plane refused.
func (s *Service) dropRejected(h [64]byte, err error) {
	s.l1.Remove(h)
	s.lastKnown.Remove(h)
	s.logger.Error("auth_cache_hard_evict", zap.String("reason", "reconfirm_rejection"), zap.Error(err))
}

// FailClosedReconfirmInterval bounds the re-checks fail closed makes per key.
const FailClosedReconfirmInterval = 5 * time.Second

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

// refusalIfDenied answers a credential the change feed denied, and that nothing
// confirmed since, with that denial's error and no control-plane call. It
// returns nil for any other.
func (s *Service) refusalIfDenied(ctx context.Context, h [64]byte) error {
	vkID, ok := s.deniedKeys.Peek(h)
	if !ok {
		return nil
	}
	d, ok := s.denied.Peek(vkID)
	if !ok || !d.at.After(s.confirmedAt(h)) {
		return nil
	}
	s.dropAndCountDenied(h, vkID, "denied_"+evictReason(d.kind))
	return denialError(ctx, d.kind)
}

// dropAndCountDenied drops every cached copy of h, remembers it as denied,
// and counts the refusal.
func (s *Service) dropAndCountDenied(h [64]byte, vkID, reason string) {
	s.l1.Remove(h)
	s.lastKnown.Remove(h)
	s.deniedKeys.Add(h, vkID)
	s.countRefusal(vkID, reason)
}

// countRefusal logs and counts a refusal. A fail-closed refusal calls it
// alone, so the cached entry stays for when the control plane answers again.
// It logs at info like evictOnLookup: the request's own line reports the
// refusal, and the counter is the alerting signal.
func (s *Service) countRefusal(vkID, reason string) {
	s.logger.Info("auth_cache_refused", zap.String("vk_id", vkID), zap.String("reason", reason))
	if s.metrics != nil {
		s.metrics.RecordAuthCacheRefusal(reason)
	}
}

func denialError(ctx context.Context, kind string) error {
	if kind == ChangeKindVirtualKeyDisabled {
		return herr.New(ctx, domain.ErrKeyDisabled, herr.M{"message": domain.KeyDisabledMessage})
	}
	return herr.New(ctx, domain.ErrKeyRevoked, herr.M{"message": domain.KeyRevokedMessage})
}
