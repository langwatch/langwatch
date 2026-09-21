package policy

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestCheck_NoRules(t *testing.T) {
	m := NewMatcher()
	err := m.Check(context.Background(), nil, []byte(`{}`))
	assert.NoError(t, err)
}

func TestCheck_DenyMatches(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "evil_tool", Type: domain.PolicyDeny, Target: domain.PolicyTargetTool},
	}
	body := []byte(`{"tools":[{"function":{"name":"evil_tool"}}]}`)

	err := m.Check(context.Background(), rules, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

func TestCheck_DenyNoMatch(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "evil_tool", Type: domain.PolicyDeny, Target: domain.PolicyTargetTool},
	}
	body := []byte(`{"tools":[{"function":{"name":"good_tool"}}]}`)

	err := m.Check(context.Background(), rules, body)
	assert.NoError(t, err)
}

func TestCheck_AllowMatch(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "^good_.*$", Type: domain.PolicyAllow, Target: domain.PolicyTargetTool},
	}
	body := []byte(`{"tools":[{"function":{"name":"good_tool"}}]}`)

	err := m.Check(context.Background(), rules, body)
	assert.NoError(t, err)
}

func TestCheck_AllowNoMatch(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "^good_.*$", Type: domain.PolicyAllow, Target: domain.PolicyTargetTool},
	}
	body := []byte(`{"tools":[{"function":{"name":"bad_tool"}}]}`)

	err := m.Check(context.Background(), rules, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

func TestCheck_ExtractToolNames_OpenAI(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "search", Type: domain.PolicyDeny, Target: domain.PolicyTargetTool},
	}
	body := []byte(`{"tools":[{"function":{"name":"search"}}]}`)

	err := m.Check(context.Background(), rules, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

func TestCheck_ExtractToolNames_Anthropic(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "search", Type: domain.PolicyDeny, Target: domain.PolicyTargetTool},
	}
	body := []byte(`{"tools":[{"name":"search"}]}`)

	err := m.Check(context.Background(), rules, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

func TestCheck_ExtractURLs(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "evil\\.com", Type: domain.PolicyDeny, Target: domain.PolicyTargetURL},
	}
	body := []byte(`{"content":"visit https://evil.com/api for more"}`)

	err := m.Check(context.Background(), rules, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

func TestCheck_ExtractMCPNames(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "server1", Type: domain.PolicyDeny, Target: domain.PolicyTargetMCP},
	}
	body := []byte(`{"mcp":[{"name":"server1"}]}`)

	err := m.Check(context.Background(), rules, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

func TestCheck_ExtractMCPNames_StringEntries(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "raw_server", Type: domain.PolicyDeny, Target: domain.PolicyTargetMCP},
	}
	body := []byte(`{"mcp":["raw_server"]}`)

	err := m.Check(context.Background(), rules, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

func TestCheckModel_DenyMatches(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "^gpt-4.*", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
	}

	err := m.CheckModel(context.Background(), rules, domain.ResolvedModel{ModelID: "gpt-4o"})
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

func TestCheckModel_DenyNoMatch(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "^gpt-4.*", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
	}

	err := m.CheckModel(context.Background(), rules, domain.ResolvedModel{ModelID: "claude-haiku-4-5"})
	assert.NoError(t, err)
}

func TestCheckModel_AllowRestricts(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "^claude-.*", Type: domain.PolicyAllow, Target: domain.PolicyTargetModel},
	}

	err := m.CheckModel(context.Background(), rules, domain.ResolvedModel{ModelID: "gpt-4o"})
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

func TestCheckModel_AllowMatch(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "^claude-.*", Type: domain.PolicyAllow, Target: domain.PolicyTargetModel},
	}

	err := m.CheckModel(context.Background(), rules, domain.ResolvedModel{ModelID: "claude-haiku-4-5"})
	assert.NoError(t, err)
}

// A model rule must not be judged against the body's raw model name: that is
// the string the caller typed, and an alias naming a denied model would walk
// straight past the rule.
//
// @scenario "A model deny rule judges the model an alias resolved to"
func TestCheck_IgnoresModelRules(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "^gpt-4.*", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
	}
	body := []byte(`{"model":"gpt-4o","messages":[]}`)

	assert.NoError(t, m.Check(context.Background(), rules, body))
}

// @scenario "A model deny rule judges the model an alias resolved to"
func TestCheckModel_DenyReachesTheModelBehindAnAlias(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "^gpt-4.*", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
	}

	// The caller asked for "safe-model"; the alias resolved it to gpt-4o.
	err := m.CheckModel(context.Background(), rules, domain.ResolvedModel{
		ModelID:    "gpt-4o",
		Source:     domain.ModelSourceAlias,
		ProviderID: domain.ProviderOpenAI,
	})
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

// @scenario "A model rule matches either spelling of the same model"
func TestCheckModel_JudgesBothSpellings(t *testing.T) {
	m := NewMatcher()
	ctx := context.Background()

	t.Run("a provider-qualified deny rule reaches a bare resolved id", func(t *testing.T) {
		rules := []domain.PolicyRule{
			{Pattern: "^openai/gpt-4.*", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
		}
		err := m.CheckModel(ctx, rules, domain.ResolvedModel{
			ModelID: "gpt-4o", ProviderID: domain.ProviderOpenAI,
		})
		require.Error(t, err)
		assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
	})

	t.Run("a bare allow rule satisfies a provider-qualified model", func(t *testing.T) {
		rules := []domain.PolicyRule{
			{Pattern: "^claude-.*", Type: domain.PolicyAllow, Target: domain.PolicyTargetModel},
		}
		assert.NoError(t, m.CheckModel(ctx, rules, domain.ResolvedModel{
			ModelID: "claude-haiku-4-5", ProviderID: domain.ProviderAnthropic,
		}))
	})
}

// A pattern the platform cannot read must refuse the request wherever it sits
// in the list. Matching before compiling would make enforcement depend on rule
// order: the good pattern here answers first, and the broken one is only
// noticed for models the good one misses.
func TestCheckModel_InvalidAllowPatternAfterAMatchStillFailsClosed(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "^gpt-.*", Type: domain.PolicyAllow, Target: domain.PolicyTargetModel},
		{Pattern: "(unterminated", Type: domain.PolicyAllow, Target: domain.PolicyTargetModel},
	}

	err := m.CheckModel(context.Background(), rules, domain.ResolvedModel{ModelID: "gpt-5-mini"})
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrInternal))
}

func TestCheckModel_InvalidDenyPatternAfterAMatchStillFailsClosed(t *testing.T) {
	m := NewMatcher()
	rules := []domain.PolicyRule{
		{Pattern: "^claude-.*", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
		{Pattern: "(unterminated", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
	}

	// The first rule matches, so a lazy compile would answer "blocked" and
	// never reach the broken one. Either answer refuses the request, but only
	// the internal error tells the operator their rule set is unreadable.
	err := m.CheckModel(context.Background(), rules, domain.ResolvedModel{ModelID: "claude-haiku-4-5"})
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrInternal))
}
