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
