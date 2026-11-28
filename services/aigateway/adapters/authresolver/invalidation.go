package authresolver

import (
	"sync"

	lru "github.com/hashicorp/golang-lru/v2"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// invalidationGuard stops a fetch that began before a change event from
// publishing the answer it read earlier. Each event stamps the identities it
// targets (key, project, organization, provider credential) with a new
// generation, and a publish compares its own bundle's identities with the
// generation captured before its fetch. Events and publishes share mu.
type invalidationGuard struct {
	mu      sync.Mutex
	gen     uint64
	evicted *stampSet
	revoked *stampSet
	budget  *stampSet
}

// stampSet holds the last generation per identity, bounded like L1. Its epoch
// is the generation of the last event that reached every bundle: an evict-all
// event, or an identity pushed out of the LRU.
type stampSet struct {
	stamps *lru.Cache[string, uint64]
	epoch  uint64
}

func newStampSet(size int) (*stampSet, error) {
	t := &stampSet{}
	stamps, err := lru.NewWithEvict(size, func(_ string, gen uint64) { t.epoch = max(t.epoch, gen) })
	if err != nil {
		return nil, err
	}
	t.stamps = stamps
	return t, nil
}

func newInvalidationGuard(size int) (*invalidationGuard, error) {
	evicted, err := newStampSet(size)
	if err != nil {
		return nil, err
	}
	revoked, err := newStampSet(size)
	if err != nil {
		return nil, err
	}
	budget, err := newStampSet(size)
	if err != nil {
		return nil, err
	}
	return &invalidationGuard{evicted: evicted, revoked: revoked, budget: budget}, nil
}

// invalidation is one change event: the identities it reached (none means
// every bundle), whether it evicts them or only marks their budget behind, and
// whether it makes the key unusable so no outage fallback may survive it.
type invalidation struct {
	keys       []string
	budgetOnly bool
	revokes    bool
}

func keyScope(id string) string        { return "vk:" + id }
func projectScope(id string) string    { return "project:" + id }
func orgScope(id string) string        { return "org:" + id }
func credentialScope(id string) string { return "credential:" + id }
func presentedScope(h [64]byte) string { return "presented:" + string(h[:]) }

// guardKeys lists the identities a bundle can be reached by.
func guardKeys(b *domain.Bundle) []string {
	keys := make([]string, 0, 3+len(b.Config.Credentials))
	keys = append(keys, keyScope(b.VirtualKeyID), projectScope(b.ProjectID), orgScope(b.OrganizationID))
	for _, c := range b.Config.Credentials {
		keys = append(keys, credentialScope(c.ID))
	}
	return keys
}

// fetchGeneration is the generation a fetch records before it calls the
// control plane, to hand back to publishFetched.
func (s *Service) fetchGeneration() uint64 {
	s.invalidations.mu.Lock()
	defer s.invalidations.mu.Unlock()
	return s.invalidations.gen
}

// recordInvalidation stamps a change on its identities and runs apply (the L1
// walk) under the lock the guarded publish takes. Caller does not hold mu.
func (s *Service) recordInvalidation(ev invalidation, apply func()) {
	g := s.invalidations
	g.mu.Lock()
	defer g.mu.Unlock()
	g.gen++
	set := g.evicted
	if ev.budgetOnly {
		set = g.budget
	}
	sets := []*stampSet{set}
	if ev.revokes {
		sets = append(sets, g.revoked)
	}
	for _, t := range sets {
		if len(ev.keys) == 0 {
			t.epoch = g.gen
		}
		for _, k := range ev.keys {
			t.stamps.Add(k, g.gen)
		}
	}
	apply()
}

// reachedSince reports whether an event after since reached any of keys.
func (t *stampSet) reachedSince(keys []string, since uint64) bool {
	if t.epoch > since {
		return true
	}
	for _, k := range keys {
		if gen, ok := t.stamps.Peek(k); ok && gen > since {
			return true
		}
	}
	return false
}

// publishFetched publishes an entry built from a fetch that started at
// generation since, unless an eviction after since reached its bundle. A
// budget change only marks the published entry behind. Reports whether it
// published.
func (s *Service) publishFetched(h [64]byte, stored *entry, since uint64) bool {
	g := s.invalidations
	g.mu.Lock()
	defer g.mu.Unlock()
	keys := append(guardKeys(stored.bundle), presentedScope(h))
	if g.evicted.reachedSince(keys, since) {
		s.logger.Debug("auth_cache_publish_dropped_stale",
			zap.String("vk_id", stored.bundle.VirtualKeyID))
		return false
	}
	if g.budget.reachedSince(keys, since) {
		stored.budgetChanges = 1
	}
	if cur, ok := s.l1.Peek(h); ok {
		// The re-check pacing is per key, so a replacement keeps the claim.
		stored.reconfirmAt.Store(max(stored.reconfirmAt.Load(), cur.reconfirmAt.Load()))
	}
	s.publishL1(h, stored)
	return true
}

// refusalSince reports whether the control plane refused the presented
// credential h after generation since (dropRejected). unknown means its stamp
// may have been pushed out of the bounded set since, so it cannot tell.
func (s *Service) refusalSince(h [64]byte, since uint64) (refused, unknown bool) {
	g := s.invalidations
	g.mu.Lock()
	defer g.mu.Unlock()
	if gen, ok := g.evicted.stamps.Peek(presentedScope(h)); ok {
		return gen > since, false
	}
	return false, g.evicted.epoch > since
}

// revokedSince reports whether an event after since made the bundle's key
// unusable (revoke, disable, rotation), as opposed to a change that keeps the
// outage fallback.
func (s *Service) revokedSince(b *domain.Bundle, since uint64) bool {
	g := s.invalidations
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.revoked.reachedSince(guardKeys(b), since)
}
