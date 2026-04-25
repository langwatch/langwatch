// Package cacherules evaluates cache control rules against requests.
package cacherules

import (
	"context"
	"path"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Evaluator evaluates priority-ordered cache rules.
type Evaluator struct{}

// NewEvaluator creates a cache rule evaluator.
func NewEvaluator() *Evaluator {
	return &Evaluator{}
}

// Evaluate returns the first matching cache rule's action, or nil if no rule matches.
func (e *Evaluator) Evaluate(_ context.Context, rules []domain.CacheRule, eval domain.CacheEvalContext) *domain.CacheDecision {
	if len(rules) == 0 {
		return nil
	}

	// Sort by priority (lower = higher priority)
	sorted := make([]domain.CacheRule, len(rules))
	copy(sorted, rules)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Priority < sorted[j].Priority
	})

	for i := range sorted {
		rule := &sorted[i]
		if matchesRule(rule.Match, eval) {
			return &domain.CacheDecision{
				Action: rule.Action,
				RuleID: rule.ID,
			}
		}
	}

	return nil
}

// matchesRule reports whether the rule's matchers ALL match the request /
// VK context (AND across matcher kinds; OR within a matcher's value list).
// An empty matcher kind contributes "true" (no filter) — kept so an
// operator-defined org-wide rule with no matchers still matches every VK.
//
// Each non-empty matcher MUST resolve to a positive match against the eval
// context. Missing eval-context data (e.g. no VKDisplayPrefix wired) when
// the rule expects it counts as "doesn't match" — fail-safe so wiring gaps
// don't accidentally apply rules to traffic the operator didn't intend.
func matchesRule(match domain.CacheRuleMatch, eval domain.CacheEvalContext) bool {
	if !matchesAnyGlob(match.Models, eval.Model) {
		return false
	}
	if !matchesAnyExact(match.Principals, eval.PrincipalID) {
		return false
	}
	if !matchesAnyExact(match.VKIDs, eval.VKID) {
		return false
	}
	if !matchesAnyPrefix(match.VKPrefixes, eval.VKDisplayPrefix) {
		return false
	}
	if !matchesAllTags(match.VKTags, eval.VKTags) {
		return false
	}
	return true
}

// matchesAnyGlob: empty patterns ⇒ no filter (true). Otherwise at least one
// path-glob pattern must match the value.
func matchesAnyGlob(patterns []string, value string) bool {
	if len(patterns) == 0 {
		return true
	}
	for _, pattern := range patterns {
		if matched, _ := path.Match(pattern, value); matched {
			return true
		}
	}
	return false
}

func matchesAnyExact(allowed []string, value string) bool {
	if len(allowed) == 0 {
		return true
	}
	for _, v := range allowed {
		if v == value {
			return true
		}
	}
	return false
}

func matchesAnyPrefix(prefixes []string, value string) bool {
	if len(prefixes) == 0 {
		return true
	}
	if value == "" {
		return false
	}
	for _, p := range prefixes {
		if strings.HasPrefix(value, p) {
			return true
		}
	}
	return false
}

// matchesAllTags requires every matcher tag to be present on the VK's tag
// set. Empty matcher tags ⇒ no filter. Empty VK tags + non-empty matcher
// tags ⇒ doesn't match (AND semantics, the operator gated on a tag the VK
// lacks).
func matchesAllTags(required, vkTags []string) bool {
	if len(required) == 0 {
		return true
	}
	tagSet := make(map[string]struct{}, len(vkTags))
	for _, t := range vkTags {
		tagSet[t] = struct{}{}
	}
	for _, want := range required {
		if _, ok := tagSet[want]; !ok {
			return false
		}
	}
	return true
}
