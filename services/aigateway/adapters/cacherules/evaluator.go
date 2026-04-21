// Package cacherules evaluates cache control rules against requests.
package cacherules

import (
	"context"
	"path"
	"sort"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Evaluator evaluates priority-ordered cache rules.
type Evaluator struct{}

// NewEvaluator creates a cache rule evaluator.
func NewEvaluator() *Evaluator {
	return &Evaluator{}
}

// Evaluate returns the first matching cache rule's action, or nil if no rule matches.
func (e *Evaluator) Evaluate(_ context.Context, rules []domain.CacheRule, model string) *domain.CacheDecision {
	if len(rules) == 0 {
		return nil
	}

	// Sort by priority (lower = higher priority)
	sorted := make([]domain.CacheRule, len(rules))
	copy(sorted, rules)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Priority < sorted[j].Priority
	})

	for _, rule := range sorted {
		if matchesRule(rule.Match, model) {
			return &domain.CacheDecision{
				Action: rule.Action,
				RuleID: rule.ID,
			}
		}
	}

	return nil
}

func matchesRule(match domain.CacheRuleMatch, model string) bool {
	if len(match.Models) == 0 {
		return true // no model filter = matches all
	}
	for _, pattern := range match.Models {
		if matched, _ := path.Match(pattern, model); matched {
			return true
		}
	}
	return false
}
