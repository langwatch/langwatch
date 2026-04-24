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

// VKPrefix matcher — iter-110 root cause regression. The seed's
// `disable-cache-evals` rule (vk_prefix=lw_vk_eval_) was matching every VK
// because the wire DTO silently dropped the matcher and collapsed it to
// "match all". Verify the matcher is honoured: a rule gated on
// vk_prefix=lw_vk_eval_ must NOT match a lw_vk_live_* matrix VK.
func TestEvaluate_VKPrefix_NoMatch(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "disable-evals", Priority: 1, Match: domain.CacheRuleMatch{VKPrefixes: []string{"lw_vk_eval_"}}, Action: domain.CacheActionDisable},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{
		Model:           "claude-sonnet-4-5",
		VKDisplayPrefix: "lw_vk_live_01KP",
	})
	assert.Nil(t, got, "lw_vk_live_* VK must not match a vk_prefix=lw_vk_eval_ rule")
}

func TestEvaluate_VKPrefix_Match(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "disable-evals", Priority: 1, Match: domain.CacheRuleMatch{VKPrefixes: []string{"lw_vk_eval_"}}, Action: domain.CacheActionDisable},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{
		Model:           "claude-sonnet-4-5",
		VKDisplayPrefix: "lw_vk_eval_01KP",
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
		{ID: "disable-evals", Priority: 1, Match: domain.CacheRuleMatch{VKPrefixes: []string{"lw_vk_eval_"}}, Action: domain.CacheActionDisable},
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
		VKDisplayPrefix: "lw_vk_live_01KP",
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

// AND across matcher kinds: model matches but vk_prefix doesn't ⇒ no match.
func TestEvaluate_AndAcrossMatchers(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{
			ID:       "scoped-disable",
			Priority: 1,
			Match: domain.CacheRuleMatch{
				Models:     []string{"claude-*"},
				VKPrefixes: []string{"lw_vk_eval_"},
			},
			Action: domain.CacheActionDisable,
		},
	}

	got := e.Evaluate(context.Background(), rules, domain.CacheEvalContext{
		Model:           "claude-sonnet-4-5",
		VKDisplayPrefix: "lw_vk_live_01KP",
	})
	assert.Nil(t, got, "model matches but vk_prefix doesn't — rule must not fire")
}

// Iter-110 end-to-end seed simulation: three rules emulating the dogfood
// seed (force vk_tags / disable vk_prefix / respect haiku) — a lw_vk_live_*
// matrix VK on claude-sonnet-4-5 should resolve to FORCE (not DISABLE),
// because the disable rule's vk_prefix gate now actually filters.
func TestEvaluate_IterDogfoodSeed_MatrixVK(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{
			ID: "force-cache-enterprise", Priority: 300,
			Match:  domain.CacheRuleMatch{VKTags: []string{"tier=enterprise"}},
			Action: domain.CacheActionForce,
		},
		{
			ID: "disable-cache-evals", Priority: 200,
			Match:  domain.CacheRuleMatch{VKPrefixes: []string{"lw_vk_eval_"}},
			Action: domain.CacheActionDisable,
		},
		{
			ID: "respect-on-haiku", Priority: 100,
			Match:  domain.CacheRuleMatch{Models: []string{"claude-haiku-4-5-20251001"}},
			Action: domain.CacheActionRespect,
		},
	}

	matrixVK := domain.CacheEvalContext{
		Model:           "claude-sonnet-4-5-20250929",
		VKID:            "vk_1777027536276_matrix-anthropic",
		VKDisplayPrefix: "lw_vk_live_01KPZHGNCA",
	}
	got := e.Evaluate(context.Background(), rules, matrixVK)
	assert.Nil(t, got, "matrix-anthropic on sonnet matches no rule (haiku-only respect, eval-only disable, enterprise-only force) — cache_control on inbound body should pass through unchanged")
}
