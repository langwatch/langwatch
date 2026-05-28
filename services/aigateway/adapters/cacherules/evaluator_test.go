package cacherules

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestEvaluate_NoRules(t *testing.T) {
	e := NewEvaluator()
	got := e.Evaluate(context.Background(), nil, domain.CacheEvalContext{Model: "gpt-4"})
	assert.Nil(t, got)
}

func TestEvaluate_MatchAll(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "r1", Priority: 1, Match: domain.CacheRuleMatch{}, Action: domain.CacheActionDisable},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{Model: "any-model"})
	require.NotNil(t, got)
	assert.Equal(t, domain.CacheActionDisable, got.Action)
	assert.Equal(t, "r1", got.RuleID)
}

func TestEvaluate_GlobMatch(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "r1", Priority: 1, Match: domain.CacheRuleMatch{Models: []string{"gpt-*"}}, Action: domain.CacheActionForce},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{Model: "gpt-4"})
	require.NotNil(t, got)
	assert.Equal(t, domain.CacheActionForce, got.Action)
	assert.Equal(t, "r1", got.RuleID)
}

func TestEvaluate_NoMatch(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "r1", Priority: 1, Match: domain.CacheRuleMatch{Models: []string{"claude-*"}}, Action: domain.CacheActionForce},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{Model: "gpt-4"})
	assert.Nil(t, got)
}

func TestEvaluate_PriorityOrder(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "high-pri", Priority: 10, Match: domain.CacheRuleMatch{}, Action: domain.CacheActionDisable},
		{ID: "low-pri", Priority: 1, Match: domain.CacheRuleMatch{}, Action: domain.CacheActionForce},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{Model: "gpt-4"})
	require.NotNil(t, got)
	assert.Equal(t, "low-pri", got.RuleID, "lower priority number wins")
	assert.Equal(t, domain.CacheActionForce, got.Action)
}

func TestEvaluate_ReturnsAction(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "cache-rule-42", Priority: 5, Match: domain.CacheRuleMatch{Models: []string{"gpt-4"}}, Action: domain.CacheActionRespect},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{Model: "gpt-4"})
	require.NotNil(t, got)
	assert.Equal(t, domain.CacheActionRespect, got.Action)
	assert.Equal(t, "cache-rule-42", got.RuleID)
}

// VKPrefix matcher: a rule gated on vk_prefix=vk-lw- matches a VK whose
// displayPrefix starts with vk-lw-. The wire DTO must propagate the
// matcher so it can be honored — a previous regression dropped it and
// collapsed the rule to "match all".
func TestEvaluate_VKPrefix_Match(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "disable-evals", Priority: 1, Match: domain.CacheRuleMatch{VKPrefixes: []string{"vk-lw-"}}, Action: domain.CacheActionDisable},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{
		Model:           "claude-sonnet-4-5",
		VKDisplayPrefix: "vk-lw-01KP",
	})
	require.NotNil(t, got)
	assert.Equal(t, domain.CacheActionDisable, got.Action)
}

// Empty VKDisplayPrefix on the eval context with a non-empty matcher
// prefix must NOT match — fail-safe so wiring gaps don't accidentally
// apply a vk_prefix rule to traffic the operator didn't intend.
func TestEvaluate_VKPrefix_EmptyContext_NoMatch(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "disable-evals", Priority: 1, Match: domain.CacheRuleMatch{VKPrefixes: []string{"vk-lw-"}}, Action: domain.CacheActionDisable},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{Model: "any"})
	assert.Nil(t, got, "missing VKDisplayPrefix in eval context must not match a vk_prefix rule")
}

// VKTag AND-semantics: rule with vk_tags=["enterprise"] must not match a
// VK whose tag set lacks the tag. Empty VKTags on the bundle is the common
// case (the schema doesn't carry tags yet).
func TestEvaluate_VKTags_RequiredButMissing_NoMatch(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "force-enterprise", Priority: 1, Match: domain.CacheRuleMatch{VKTags: []string{"tier=enterprise"}}, Action: domain.CacheActionForce},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{
		Model:           "claude-sonnet-4-5",
		VKDisplayPrefix: "vk-lw-01KP",
		// VKTags intentionally empty
	})
	assert.Nil(t, got, "rule gated on a tag the VK lacks must not match")
}

func TestEvaluate_VKTags_AllPresent_Match(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "force-enterprise", Priority: 1, Match: domain.CacheRuleMatch{VKTags: []string{"tier=enterprise"}}, Action: domain.CacheActionForce},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{
		Model:  "claude-sonnet-4-5",
		VKTags: []string{"tier=enterprise", "stack=prod"},
	})
	require.NotNil(t, got)
	assert.Equal(t, domain.CacheActionForce, got.Action)
}
