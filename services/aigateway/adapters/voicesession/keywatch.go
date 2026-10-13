package voicesession

import (
	"context"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// keyWatch is one virtual key's bundle as the supervised calls of that key
// last read it. The calls share it, so a key with many open calls is re-read
// once per refresh interval and not once per call.
type keyWatch struct {
	mu      sync.Mutex
	bundle  *domain.Bundle
	etag    string
	revoked bool
	readAt  time.Time
	refs    int
}

func (m *Manager) watchLocked(call domain.BrokeredVoiceSession) *keyWatch {
	if call.Bundle == nil {
		return nil
	}
	watch, ok := m.watches[call.Bundle.VirtualKeyID]
	if !ok {
		watch = &keyWatch{bundle: call.Bundle, readAt: call.StartedAt}
		m.watches[call.Bundle.VirtualKeyID] = watch
	}
	watch.refs++
	return watch
}

func (m *Manager) unwatchLocked(s *session) {
	if s.watch == nil {
		return
	}
	s.watch.refs--
	if s.watch.refs <= 0 {
		delete(m.watches, s.Bundle.VirtualKeyID)
	}
}

// current answers the key's bundle, re-read when it is older than the
// refresh interval, and whether the key can no longer be used.
func (w *keyWatch) current(m *Manager, now time.Time) (*domain.Bundle, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.revoked || w.bundle.KeyExpired(now) {
		return w.bundle, true
	}
	if m.keys == nil || now.Sub(w.readAt) < m.timing.KeyRefresh {
		return w.bundle, false
	}
	w.readAt = now
	w.reread(m)
	return w.bundle, w.revoked
}

// reread fetches the key again. A read that fails for any reason but the key
// being gone leaves what is held: an outage is not a revocation.
func (w *keyWatch) reread(m *Manager) {
	// A bundle with a blocking budget is read outright: a revalidation
	// carries no spend, and the precheck judges the spend on the bundle.
	etag := w.etag
	if hasBlockingBudget(w.bundle) {
		etag = ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), m.timing.CallTimeout)
	defer cancel()
	held, err := m.keys.ReadHeldKey(ctx, w.bundle, etag)
	if err != nil {
		w.revoked = herr.IsCode(err, domain.ErrInvalidAPIKey)
		m.logger.Debug("voice_session_key_read_failed",
			zap.String("vk_id", w.bundle.VirtualKeyID), zap.Bool("key_gone", w.revoked), zap.Error(err))
		return
	}
	w.revoked = held.Revoked
	if held.Bundle != nil {
		w.bundle = held.Bundle
	}
	if held.ETag != "" {
		w.etag = held.ETag
	}
}

func hasBlockingBudget(bundle *domain.Bundle) bool {
	for i := range bundle.Config.Budget.Scopes {
		scope := &bundle.Config.Budget.Scopes[i]
		if scope.LimitMicroUSD > 0 && scope.OnBreach == "block" {
			return true
		}
	}
	return false
}
