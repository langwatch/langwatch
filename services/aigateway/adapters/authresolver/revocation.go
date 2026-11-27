package authresolver

import (
	"context"
	"errors"
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

// maxDeniedCredentialsPerKey bounds the credentials remembered per denied key:
// a key carries its current and previous secret, so a few slots are plenty.
const maxDeniedCredentialsPerKey = 8

// denial records that every confirmation of a virtual key started before at is
// void. kind is the change-feed event that caused it. A pending denial came
// from a change-feed backlog and refuses no credential locally (denyPending).
type denial struct {
	at      time.Time
	kind    string
	pending bool
}

// DefaultDenialRecheckInterval is how often a denied key may be re-checked
// against the control plane when no re-enable event arrives.
const DefaultDenialRecheckInterval = 30 * time.Second

// backgroundCheckTimeout bounds one background control-plane check.
const backgroundCheckTimeout = 10 * time.Second

// backgroundCheckContext is the context of a check no single request owns:
// it ends on its timeout or when the service stops.
func (s *Service) backgroundCheckContext() (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(context.Background(), backgroundCheckTimeout)
	go func() {
		select {
		case <-s.stopCh:
			cancel()
		case <-ctx.Done():
		}
	}()
	return ctx, cancel
}

// monoBase anchors monoStamp. Stamps are offsets on the monotonic clock, so a
// wall clock step does not move fail closed.
var monoBase = time.Now()

func monoStamp(offset time.Duration) int64 { return int64(time.Since(monoBase) + offset) }

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
	if !ok || d.pending || !s.rechecks.begin(h, d.at) {
		return
	}
	go s.recheckDenied(key, h, vkID)
}

// recheckDenied asks the control plane about a denied credential and lifts
// the denial when the key is confirmed and no newer denial landed meanwhile.
func (s *Service) recheckDenied(key domain.PresentedKey, h [64]byte, vkID string) {
	defer s.rechecks.end(h)
	ctx, cancel := s.backgroundCheckContext()
	defer cancel()
	answer, err := s.resolveFresh(ctx, key, h)
	if err != nil {
		return
	}
	s.liftDenialBefore(vkID, answer.authStart, "recheck")
}

func (e *entry) authStart() time.Time {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.authStartedAt
}

// deny voids every confirmation of vkID that started before now, and remembers
// which cached credentials carried it so an outage still answers them with the
// key's own error rather than a retryable one.
func (s *Service) deny(vkID, kind string) { s.recordDenial(vkID, kind, false) }

// denyPending is deny for an event read from a change-feed backlog, where a
// later page may re-enable the key: it voids confirmations the same way but
// refuses no credential locally until promotePending, so the next request asks
// the control plane. See specs/ai-gateway/auth-cache.feature, issue #9754.
func (s *Service) denyPending(vkID, kind string) { s.recordDenial(vkID, kind, true) }

// recordDenial puts vkID on the revocation list. A pending denial never
// replaces one that already refuses locally.
func (s *Service) recordDenial(vkID, kind string, pending bool) {
	s.denyMu.Lock()
	if old, ok := s.denied.Peek(vkID); ok && !old.pending {
		pending = false
	}
	s.denied.Add(vkID, denial{at: time.Now(), kind: kind, pending: pending})
	s.denyMu.Unlock()
	s.rememberDenied(vkID, s.carriersOf(vkID)...)
	s.logger.Info("auth_cache_key_denied", zap.String("vk_id", vkID), zap.String("reason", evictReason(kind)), zap.Bool("pending", pending))
}

// carriersOf lists the cached credentials, live or last known, of vkID.
func (s *Service) carriersOf(vkID string) [][64]byte {
	var carried [][64]byte
	for _, h := range s.l1.Keys() {
		if e, ok := s.l1.Peek(h); ok && e.bundle.VirtualKeyID == vkID {
			carried = append(carried, h)
		}
	}
	for _, h := range s.lastKnown.Keys() {
		if e, ok := s.lastKnown.Peek(h); ok && e.bundle.VirtualKeyID == vkID {
			carried = append(carried, h)
		}
	}
	return carried
}

// promotePending makes the pending denials of vkIDs that are still on the list
// refuse their credentials locally. The change feed calls it once the backlog
// that recorded them is read to its end, so each key is refused only for the
// state the backlog left it in.
func (s *Service) promotePending(vkIDs map[string]struct{}) {
	s.denyMu.Lock()
	defer s.denyMu.Unlock()
	for vkID := range vkIDs {
		d, ok := s.denied.Peek(vkID)
		if !ok || !d.pending {
			continue
		}
		d.pending = false
		s.denied.Add(vkID, d)
		s.indexDeniedLocked(vkID)
	}
}

// clearDenial lifts vkID's denial and forgets the credentials that carried
// it. A re-enable, a confirmation that began after the denial, or a
// background recheck calls it.
func (s *Service) clearDenial(vkID, source string) {
	s.denyMu.Lock()
	defer s.denyMu.Unlock()
	if s.clearDenialLocked(vkID) {
		s.logger.Info("auth_cache_denial_cleared", zap.String("vk_id", vkID), zap.String("source", source))
	}
}

// clearDenialLocked reports whether vkID was denied.
func (s *Service) clearDenialLocked(vkID string) bool {
	was := s.denied.Remove(vkID)
	s.forgetCredentialsLocked(vkID)
	return was
}

// forgetCredentialsLocked drops the credentials vkID carried from the index.
// The caller holds denyMu.
func (s *Service) forgetCredentialsLocked(vkID string) {
	for h := range s.deniedByVK[vkID] {
		if v, ok := s.deniedKeys.Peek(h); ok && v == vkID {
			s.deniedKeys.Remove(h)
		}
	}
	delete(s.deniedByVK, vkID)
}

// liftDenialBefore lifts vkID's denial when it is older than a confirmation
// that began at start. A newer denial is kept and returned, checked and
// cleared under one lock so a denial landing in between is never lost.
func (s *Service) liftDenialBefore(vkID string, start time.Time, source string) (denial, bool) {
	s.denyMu.Lock()
	defer s.denyMu.Unlock()
	d, ok := s.denied.Peek(vkID)
	if !ok {
		return denial{}, false
	}
	if d.at.After(start) {
		return d, true
	}
	s.clearDenialLocked(vkID)
	s.logger.Info("auth_cache_denial_cleared", zap.String("vk_id", vkID), zap.String("source", source))
	return denial{}, false
}

// rememberDenied maps credentials to the denied key they carried, each once and
// at most maxDeniedCredentialsPerKey per key; only a denial that is not
// pending refuses them locally. The index drops keys that left the revocation
// list once it outgrows the list.
func (s *Service) rememberDenied(vkID string, hashes ...[64]byte) {
	s.denyMu.Lock()
	defer s.denyMu.Unlock()
	set := s.deniedByVK[vkID]
	if set == nil {
		set = map[[64]byte]struct{}{}
		s.deniedByVK[vkID] = set
	}
	for _, h := range hashes {
		if _, seen := set[h]; !seen && len(set) >= maxDeniedCredentialsPerKey {
			continue
		}
		set[h] = struct{}{}
	}
	if d, ok := s.denied.Peek(vkID); ok && !d.pending {
		s.indexDeniedLocked(vkID)
	}
	s.pruneDeniedIndexLocked()
}

// indexDeniedLocked lets refusalIfDenied find every credential vkID carried.
// The caller holds denyMu.
func (s *Service) indexDeniedLocked(vkID string) {
	for h := range s.deniedByVK[vkID] {
		s.deniedKeys.Add(h, vkID)
	}
}

// pruneDeniedIndexLocked drops keys that left the revocation list, with their
// credentials, once the index outgrows it. The caller holds denyMu.
func (s *Service) pruneDeniedIndexLocked() {
	if len(s.deniedByVK) <= denySetSize {
		return
	}
	for id := range s.deniedByVK {
		if !s.denied.Contains(id) {
			s.forgetCredentialsLocked(id)
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
// is set, a key nothing confirmed recently while its org's feed is silent. A
// key past KeyRecheckAfter under a silent feed comes back with errKeyRecheckDue.
func (s *Service) admit(ctx context.Context, h [64]byte, in served) (*domain.Bundle, error) {
	b, authStart := in.bundle, in.authStart
	if b.VirtualKeyID != "" {
		if _, ok := s.denied.Peek(b.VirtualKeyID); ok {
			if d, kept := s.liftDenialBefore(b.VirtualKeyID, authStart, "confirmation"); kept {
				return nil, s.refuseVoided(ctx, voidedAnswer{h: h, vkID: b.VirtualKeyID, by: d})
			}
		}
	}
	if s.failClosedAfter > 0 && s.feedSilentFor(b.OrganizationID, s.failClosedAfter) &&
		time.Since(authStart) > s.failClosedAfter {
		// Resolve counts this refusal once the key re-check has had its say.
		return nil, herr.New(ctx, domain.ErrAuthUpstream, herr.M{
			"message": "control plane unreachable and this gateway refuses keys it cannot re-check; retry shortly",
		}).WithRetryable(true)
	}
	if s.keyRecheckAfter > 0 && time.Since(authStart) > s.keyRecheckAfter &&
		s.feedSilentFor(b.OrganizationID, s.keyRecheckAfter) {
		return b, errKeyRecheckDue
	}
	return b, nil
}

// presentedKey is a credential as presented and the hash it is cached under.
type presentedKey struct {
	key domain.PresentedKey
	h   [64]byte
}

// errKeyRecheckDue is admit's answer for a key neither the control plane nor
// its org's change feed vouched for within KeyRecheckAfter: Resolve checks it
// once more before it serves (recheckKey).
var errKeyRecheckDue = errors.New("key re-check due")

// recheckKey checks a key the change feed has not vouched for lately. A
// refusal stands. A check that cannot reach the control plane, or that runs
// past keyRecheckWait, serves the cached answer; the check still evicts a key
// it finds refused, so the next request is refused. fresh reports a new answer.
func (s *Service) recheckKey(ctx context.Context, k presentedKey, cached served) (answer served, fresh bool, err error) {
	call := s.joinReconfirm(k.key, k.h)
	if call == nil {
		return cached, false, nil
	}
	timer := time.NewTimer(keyRecheckWait)
	defer timer.Stop()
	select {
	case <-call.done:
	case <-timer.C:
		return cached, false, nil
	case <-ctx.Done():
		return cached, false, nil
	}
	switch {
	case call.err == nil:
		return call.answer, true, nil
	case classifyRefreshError(call.err) == classTransportFailure:
		return cached, false, nil
	default:
		return served{}, false, call.err
	}
}

// errPendingDenial is admit's answer when a pending denial voided the
// confirmation: Resolve asks the control plane again (reaskVoided).
var errPendingDenial = errors.New("confirmation voided by a pending denial")

// voidedAnswer is a credential whose confirmation the denial `by` voided.
type voidedAnswer struct {
	h    [64]byte
	vkID string
	by   denial
}

// refuseVoided refuses an answer a denial voided. A pending one may come from
// an event a later page undoes, so the answer is asked again, not refused.
func (s *Service) refuseVoided(ctx context.Context, v voidedAnswer) error {
	h, vkID, d := v.h, v.vkID, v.by
	if d.pending {
		s.rememberDenied(vkID, h)
		return errPendingDenial
	}
	s.dropAndCountDenied(h, vkID, denialReason(d.kind))
	return denialError(ctx, d.kind)
}

// reaskVoided asks the control plane once more about a key whose answer a
// pending denial voided, and admits that answer. One it cannot get, or one a
// newer pending denial voids again, is retryable.
func (s *Service) reaskVoided(ctx context.Context, key domain.PresentedKey, h [64]byte) (*domain.Bundle, error) {
	answer, err := s.resolveFresh(ctx, key, h)
	if err != nil && classifyRefreshError(err) == classTransportFailure {
		return nil, errReaskUnavailable(ctx, err)
	}
	if err != nil {
		return nil, err
	}
	bundle, err := s.admit(ctx, h, answer)
	if errors.Is(err, errKeyRecheckDue) {
		err = nil // the answer is the re-check
	}
	if errors.Is(err, errPendingDenial) {
		return nil, errReaskUnavailable(ctx, err)
	}
	if err == nil && answer.stale != "" {
		s.recordStaleServe(answer.stale)
	}
	return bundle, err
}

func errReaskUnavailable(ctx context.Context, cause error) error {
	return herr.New(ctx, domain.ErrAuthUpstream, herr.M{
		"message": "this key changed while the gateway was catching up and the control plane could not re-check it; retry shortly",
	}, cause).WithRetryable(true)
}

// claimReconfirm lets one request per FailClosedReconfirmInterval re-check a
// cached key with the control plane before fail closed refuses it. A config
// answer is no key check: the config route does not look at key status.
func (s *Service) claimReconfirm(h [64]byte) bool {
	e, ok := s.l1.Peek(h)
	if !ok {
		return false
	}
	now, last := monoStamp(0), e.reconfirmAt.Load()
	if last != 0 && now-last < int64(FailClosedReconfirmInterval) {
		return false
	}
	return e.reconfirmAt.CompareAndSwap(last, now)
}

// reconfirmCall is one fail-closed key re-check. Requests for the same
// credential wait on it rather than being refused while it runs.
type reconfirmCall struct {
	done   chan struct{}
	answer served
	err    error
}

// joinReconfirm returns the running re-check of h, or starts one when
// claimReconfirm allows it; nil when neither. The check runs on a background
// context, so a client that leaves does not cut it short.
func (s *Service) joinReconfirm(key domain.PresentedKey, h [64]byte) *reconfirmCall {
	s.reconfirmMu.Lock()
	defer s.reconfirmMu.Unlock()
	if c, ok := s.reconfirms[h]; ok {
		return c
	}
	if !s.claimReconfirm(h) {
		return nil
	}
	c := &reconfirmCall{done: make(chan struct{})}
	s.reconfirms[h] = c
	go s.runReconfirm(key, h, c)
	return c
}

func (s *Service) runReconfirm(key domain.PresentedKey, h [64]byte, c *reconfirmCall) {
	ctx, cancel := s.backgroundCheckContext()
	defer cancel()
	c.answer, c.err = s.reconfirm(ctx, key, h)
	s.reconfirmMu.Lock()
	delete(s.reconfirms, h)
	s.reconfirmMu.Unlock()
	close(c.done)
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
		s.publishFetched(h, s.newEntry(bundle, etag, start), since)
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

// FailClosedReconfirmInterval bounds the re-checks fail closed and the key
// re-check make per key.
const FailClosedReconfirmInterval = 5 * time.Second

// DefaultKeyRecheckAfter is the KeyRecheckAfter used when none is set: a
// disable or revoke the change feed could not carry lands within about this
// long, as long as the control plane answers.
const DefaultKeyRecheckAfter = 60 * time.Second

// keyRecheckWait is how long a request waits on a key re-check before it
// serves the cached key, so a slow control plane adds bounded latency.
const keyRecheckWait = 2 * time.Second

// feedSilentFor reports whether the org's change feed has gone without an
// answer for longer than limit.
func (s *Service) feedSilentFor(orgID string, limit time.Duration) bool {
	v, ok := s.activeOrgs.Load(orgID)
	if !ok {
		return true
	}
	c, _ := v.(*orgCursor)
	polled := c.polledAt.Load()
	return polled == 0 || time.Duration(monoStamp(0)-polled) > limit
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
	if !ok || d.pending || !d.at.After(s.confirmedAt(h)) {
		return nil
	}
	s.dropAndCountDenied(h, vkID, denialReason(d.kind))
	return denialError(ctx, d.kind)
}

// dropAndCountDenied drops every cached copy of h, remembers it as denied,
// and counts the refusal.
func (s *Service) dropAndCountDenied(h [64]byte, vkID, reason string) {
	s.l1.Remove(h)
	s.lastKnown.Remove(h)
	s.rememberDenied(vkID, h)
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

func denialReason(kind string) string {
	if kind == ChangeKindVirtualKeyDisabled {
		return refusalDeniedDisabled
	}
	return refusalDeniedRevoked
}

func denialError(ctx context.Context, kind string) error {
	if kind == ChangeKindVirtualKeyDisabled {
		return herr.New(ctx, domain.ErrKeyDisabled, herr.M{"message": domain.KeyDisabledMessage})
	}
	return herr.New(ctx, domain.ErrKeyRevoked, herr.M{"message": domain.KeyRevokedMessage})
}
