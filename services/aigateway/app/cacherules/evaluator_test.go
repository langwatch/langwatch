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
	got := e.Evaluate(context.Background(), nil, "gpt-4")
	assert.Nil(t, got)
}

func TestEvaluate_MatchAll(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "r1", Priority: 1, Match: domain.CacheRuleMatch{}, Action: domain.CacheActionDisable},
	}

	got := e.Evaluate(context.Background(), rules, "any-model")
	require.NotNil(t, got)
	assert.Equal(t, domain.CacheActionDisable, got.Action)
	assert.Equal(t, "r1", got.RuleID)
}

func TestEvaluate_GlobMatch(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "r1", Priority: 1, Match: domain.CacheRuleMatch{Models: []string{"gpt-*"}}, Action: domain.CacheActionForce},
	}

	got := e.Evaluate(context.Background(), rules, "gpt-4")
	require.NotNil(t, got)
	assert.Equal(t, domain.CacheActionForce, got.Action)
	assert.Equal(t, "r1", got.RuleID)
}

func TestEvaluate_NoMatch(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "r1", Priority: 1, Match: domain.CacheRuleMatch{Models: []string{"claude-*"}}, Action: domain.CacheActionForce},
	}

	got := e.Evaluate(context.Background(), rules, "gpt-4")
	assert.Nil(t, got)
}

func TestEvaluate_PriorityOrder(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "high-pri", Priority: 10, Match: domain.CacheRuleMatch{}, Action: domain.CacheActionDisable},
		{ID: "low-pri", Priority: 1, Match: domain.CacheRuleMatch{}, Action: domain.CacheActionForce},
	}

	got := e.Evaluate(context.Background(), rules, "gpt-4")
	require.NotNil(t, got)
	assert.Equal(t, "low-pri", got.RuleID, "lower priority number wins")
	assert.Equal(t, domain.CacheActionForce, got.Action)
}

func TestEvaluate_ReturnsAction(t *testing.T) {
	e := NewEvaluator()
	rules := []domain.CacheRule{
		{ID: "cache-rule-42", Priority: 5, Match: domain.CacheRuleMatch{Models: []string{"gpt-4"}}, Action: domain.CacheActionRespect},
	}

	got := e.Evaluate(context.Background(), rules, "gpt-4")
	require.NotNil(t, got)
	assert.Equal(t, domain.CacheActionRespect, got.Action)
	assert.Equal(t, "cache-rule-42", got.RuleID)
}
