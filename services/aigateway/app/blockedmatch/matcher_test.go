package blockedmatch

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestCheck_NoPatterns(t *testing.T) {
	m := NewMatcher()
	err := m.Check(context.Background(), nil, []byte(`{}`))
	assert.NoError(t, err)
}

func TestCheck_DenyMatches(t *testing.T) {
	m := NewMatcher()
	patterns := []domain.BlockedPattern{
		{Pattern: "evil_tool", Type: domain.BlockedDeny, Target: domain.BlockedTargetTool},
	}
	body := []byte(`{"tools":[{"function":{"name":"evil_tool"}}]}`)

	err := m.Check(context.Background(), patterns, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBlockedPattern))
}

func TestCheck_DenyNoMatch(t *testing.T) {
	m := NewMatcher()
	patterns := []domain.BlockedPattern{
		{Pattern: "evil_tool", Type: domain.BlockedDeny, Target: domain.BlockedTargetTool},
	}
	body := []byte(`{"tools":[{"function":{"name":"good_tool"}}]}`)

	err := m.Check(context.Background(), patterns, body)
	assert.NoError(t, err)
}

func TestCheck_AllowMatch(t *testing.T) {
	m := NewMatcher()
	patterns := []domain.BlockedPattern{
		{Pattern: "^good_.*$", Type: domain.BlockedAllow, Target: domain.BlockedTargetTool},
	}
	body := []byte(`{"tools":[{"function":{"name":"good_tool"}}]}`)

	err := m.Check(context.Background(), patterns, body)
	assert.NoError(t, err)
}

func TestCheck_AllowNoMatch(t *testing.T) {
	m := NewMatcher()
	patterns := []domain.BlockedPattern{
		{Pattern: "^good_.*$", Type: domain.BlockedAllow, Target: domain.BlockedTargetTool},
	}
	body := []byte(`{"tools":[{"function":{"name":"bad_tool"}}]}`)

	err := m.Check(context.Background(), patterns, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBlockedPattern))
}

func TestCheck_ExtractToolNames_OpenAI(t *testing.T) {
	m := NewMatcher()
	patterns := []domain.BlockedPattern{
		{Pattern: "search", Type: domain.BlockedDeny, Target: domain.BlockedTargetTool},
	}
	body := []byte(`{"tools":[{"function":{"name":"search"}}]}`)

	err := m.Check(context.Background(), patterns, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBlockedPattern))
}

func TestCheck_ExtractToolNames_Anthropic(t *testing.T) {
	m := NewMatcher()
	patterns := []domain.BlockedPattern{
		{Pattern: "search", Type: domain.BlockedDeny, Target: domain.BlockedTargetTool},
	}
	body := []byte(`{"tools":[{"name":"search"}]}`)

	err := m.Check(context.Background(), patterns, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBlockedPattern))
}

func TestCheck_ExtractURLs(t *testing.T) {
	m := NewMatcher()
	patterns := []domain.BlockedPattern{
		{Pattern: "evil\\.com", Type: domain.BlockedDeny, Target: domain.BlockedTargetURL},
	}
	body := []byte(`{"content":"visit https://evil.com/api for more"}`)

	err := m.Check(context.Background(), patterns, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBlockedPattern))
}

func TestCheck_ExtractMCPNames(t *testing.T) {
	m := NewMatcher()
	patterns := []domain.BlockedPattern{
		{Pattern: "server1", Type: domain.BlockedDeny, Target: domain.BlockedTargetMCP},
	}
	body := []byte(`{"mcp":[{"name":"server1"}]}`)

	err := m.Check(context.Background(), patterns, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBlockedPattern))
}

func TestCheck_ExtractMCPNames_StringEntries(t *testing.T) {
	m := NewMatcher()
	patterns := []domain.BlockedPattern{
		{Pattern: "raw_server", Type: domain.BlockedDeny, Target: domain.BlockedTargetMCP},
	}
	body := []byte(`{"mcp":["raw_server"]}`)

	err := m.Check(context.Background(), patterns, body)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBlockedPattern))
}
