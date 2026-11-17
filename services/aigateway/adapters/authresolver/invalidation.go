package authresolver

import (
	"sync"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// invalidationLogSize bounds the change events kept for in-flight fetches to
// check against. A fetch that began before the oldest kept event is refused
// its publish, since the events it may have missed are gone.
const invalidationLogSize = 1024

// invalidationLog numbers every change-feed eviction and budget change, so a
// fetch that started before one cannot publish the result it read earlier.
// Evictions and guarded publishes share mu: an eviction either removes the
// published entry or is seen by the publish check, never neither.
type invalidationLog struct {
	mu     sync.Mutex
	gen    uint64
	events []invalidation
}

// invalidation is one change event: the bundles it reached and whether it
// evicts them or only marks their budget behind.
type invalidation struct {
	gen        uint64
	match      func(*domain.Bundle) bool
	budgetOnly bool
}

// fetchGeneration is the generation a fetch records before it calls the
// control plane, to hand back to publishFetched.
func (s *Service) fetchGeneration() uint64 {
	s.invalidations.mu.Lock()
	defer s.invalidations.mu.Unlock()
	return s.invalidations.gen
}

// recordInvalidation numbers a change and runs apply (the L1 walk) under the
// same lock the guarded publish takes. Caller does not hold mu.
func (s *Service) recordInvalidation(ev invalidation, apply func()) {
	log := &s.invalidations
	log.mu.Lock()
	defer log.mu.Unlock()
	log.gen++
	ev.gen = log.gen
	log.events = append(log.events, ev)
	if over := len(log.events) - invalidationLogSize; over > 0 {
		log.events = append(log.events[:0:0], log.events[over:]...)
	}
	apply()
}

// publishFetched publishes an entry built from a fetch that started at
// generation since, unless a change event after since reached its bundle. A
// budget-only change publishes the entry marked behind instead. Reports
// whether it published.
func (s *Service) publishFetched(h [64]byte, stored *entry, since uint64) bool {
	log := &s.invalidations
	log.mu.Lock()
	defer log.mu.Unlock()
	if since < log.gen && (len(log.events) == 0 || log.events[0].gen > since+1) {
		s.logger.Debug("auth_cache_publish_dropped_unknown_changes")
		return false
	}
	for _, ev := range log.events {
		if ev.gen <= since || !ev.match(stored.bundle) {
			continue
		}
		if !ev.budgetOnly {
			s.logger.Debug("auth_cache_publish_dropped_stale",
				zap.String("vk_id", stored.bundle.VirtualKeyID))
			return false
		}
		stored.budgetChanges = 1
	}
	s.publishL1(h, stored)
	return true
}
