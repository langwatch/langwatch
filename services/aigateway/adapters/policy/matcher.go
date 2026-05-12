// Package policy evaluates regex-based deny/allow rules against request content.
// Implements app.PolicyMatcher.
package policy

import (
	"context"
	"fmt"
	"regexp"
	"sync"

	"github.com/bytedance/sonic"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Matcher evaluates policy rules against request bodies.
type Matcher struct {
	// cache stores compiled patterns keyed by pattern string to avoid recompilation.
	cache sync.Map
}

// NewMatcher creates a policy rule matcher.
func NewMatcher() *Matcher {
	return &Matcher{}
}

// Check evaluates the body against the given rules. Returns a herr.E if violated.
func (m *Matcher) Check(ctx context.Context, rules []domain.PolicyRule, body []byte) error {
	if len(rules) == 0 {
		return nil
	}

	// Extract candidates from body based on rule targets.
	candidates := extractCandidates(body, rules)

	for _, r := range rules {
		re, err := m.compile(r.Pattern)
		if err != nil {
			return herr.New(ctx, domain.ErrInternal, nil, err)
		}

		names := candidates[r.Target]
		for _, name := range names {
			matched := re.MatchString(name)
			if r.Type == domain.PolicyDeny && matched {
				return herr.New(ctx, domain.ErrPolicyViolation, herr.M{
					"message": fmt.Sprintf("%s %q is blocked by policy", r.Target, name),
				})
			}
		}
	}

	// Check allowlists: for each target with allow rules, candidates must match at least one.
	allowsByTarget := groupAllows(rules)
	for target, allows := range allowsByTarget {
		names := candidates[target]
		for _, name := range names {
			if !matchesAny(m, name, allows) {
				return herr.New(ctx, domain.ErrPolicyViolation, herr.M{
					"message": fmt.Sprintf("%s %q is not in allowlist", target, name),
				})
			}
		}
	}

	return nil
}

func (m *Matcher) compile(pattern string) (*regexp.Regexp, error) {
	if cached, ok := m.cache.Load(pattern); ok {
		return cached.(*regexp.Regexp), nil
	}
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, fmt.Errorf("compile %q: %w", pattern, err)
	}
	m.cache.Store(pattern, re)
	return re, nil
}

func groupAllows(rules []domain.PolicyRule) map[domain.PolicyRuleTarget][]string {
	result := make(map[domain.PolicyRuleTarget][]string)
	for _, r := range rules {
		if r.Type == domain.PolicyAllow {
			result[r.Target] = append(result[r.Target], r.Pattern)
		}
	}
	return result
}

func matchesAny(m *Matcher, candidate string, patterns []string) bool {
	for _, p := range patterns {
		re, err := m.compile(p)
		if err != nil {
			continue
		}
		if re.MatchString(candidate) {
			return true
		}
	}
	return false
}

// extractCandidates pulls tool names, MCP identifiers, and URLs from the body.
// This is provider-agnostic extraction — it looks for common JSON patterns.
func extractCandidates(body []byte, rules []domain.PolicyRule) map[domain.PolicyRuleTarget][]string {
	result := make(map[domain.PolicyRuleTarget][]string)

	// Determine which targets we need
	targets := make(map[domain.PolicyRuleTarget]bool)
	for _, r := range rules {
		targets[r.Target] = true
	}

	if targets[domain.PolicyTargetTool] {
		result[domain.PolicyTargetTool] = extractToolNames(body)
	}
	if targets[domain.PolicyTargetMCP] {
		result[domain.PolicyTargetMCP] = extractMCPNames(body)
	}
	if targets[domain.PolicyTargetURL] {
		result[domain.PolicyTargetURL] = extractURLs(body)
	}

	return result
}

// extractToolNames pulls tool names from both OpenAI (tools[].function.name)
// and Anthropic (tools[].name) shapes.
func extractToolNames(body []byte) []string {
	var env struct {
		Tools []struct {
			Name     string `json:"name"`
			Function struct {
				Name string `json:"name"`
			} `json:"function"`
		} `json:"tools"`
	}
	if err := sonic.Unmarshal(body, &env); err != nil {
		return nil
	}
	out := make([]string, 0, len(env.Tools))
	for _, t := range env.Tools {
		if t.Function.Name != "" {
			out = append(out, t.Function.Name)
		} else if t.Name != "" {
			out = append(out, t.Name)
		}
	}
	return out
}

// extractMCPNames pulls MCP identifiers from mcp/mcps/mcp_servers arrays.
// Accepts both string entries and objects with name/id fields.
func extractMCPNames(body []byte) []string {
	var env struct {
		MCP        []mcpEntry `json:"mcp"`
		MCPs       []mcpEntry `json:"mcps"`
		MCPServers []mcpEntry `json:"mcp_servers"`
	}
	if err := sonic.Unmarshal(body, &env); err != nil {
		return nil
	}
	all := append(append([]mcpEntry{}, env.MCP...), env.MCPs...)
	all = append(all, env.MCPServers...)
	out := make([]string, 0, len(all))
	for _, m := range all {
		if m.Name != "" {
			out = append(out, m.Name)
		} else if m.ID != "" {
			out = append(out, m.ID)
		} else if m.Raw != "" {
			out = append(out, m.Raw)
		}
	}
	return out
}

type mcpEntry struct {
	Name string `json:"name,omitempty"`
	ID   string `json:"id,omitempty"`
	Raw  string `json:"-"`
}

func (m *mcpEntry) UnmarshalJSON(b []byte) error {
	if len(b) > 0 && b[0] == '"' {
		return sonic.Unmarshal(b, &m.Raw)
	}
	type alias mcpEntry
	return sonic.Unmarshal(b, (*alias)(m))
}

// extractURLs scans the body for http:// and https:// URLs regardless of position.
func extractURLs(body []byte) []string {
	if len(body) == 0 {
		return nil
	}
	var out []string
	seen := make(map[string]struct{})
	s := string(body)
	for i := 0; i < len(s); {
		idx := indexScheme(s[i:])
		if idx < 0 {
			break
		}
		start := i + idx
		end := start
		for end < len(s) && !isURLBoundary(s[end]) {
			end++
		}
		url := s[start:end]
		for len(url) > 0 && isTrailingJunk(url[len(url)-1]) {
			url = url[:len(url)-1]
		}
		if len(url) > 8 {
			if _, dup := seen[url]; !dup {
				seen[url] = struct{}{}
				out = append(out, url)
			}
		}
		i = end
	}
	return out
}

func indexScheme(s string) int {
	for i := 0; i+7 <= len(s); i++ {
		if s[i:i+7] == "http://" || (i+8 <= len(s) && s[i:i+8] == "https://") {
			return i
		}
	}
	return -1
}

func isURLBoundary(c byte) bool {
	switch c {
	case ' ', '\t', '\n', '\r', '"', '\'', '<', '>':
		return true
	}
	return false
}

func isTrailingJunk(c byte) bool {
	switch c {
	case ',', '.', ';', ':', ')', ']', '}', '\\':
		return true
	}
	return false
}
