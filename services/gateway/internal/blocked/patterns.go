// Package blocked evaluates the VK's `blocked_patterns` policy
// against a request's tool / MCP / URL lists and returns the first
// violation. Contract §5:
//
//   - Each dimension has independent `deny` and `allow` regex lists.
//   - `deny` wins: any match in deny is a violation regardless of
//     what allow says.
//   - When `allow` is non-nil, a name that doesn't match any allow
//     entry is ALSO a violation (allowlist semantics).
//   - When `allow` is nil, no allowlist check runs (only deny applies).
//   - Patterns are RE2 (Go's `regexp` package). Invalid patterns are
//     compiled once on VK resolve; runtime compilation errors mean
//     the VK config is broken and we fail-closed (no requests through).
//
// The package is intentionally stateless: the dispatcher calls
// Check* on each request with the pre-compiled patterns from the
// bundle. No caching of compiled regexes across requests — the VK
// config is stable between revisions, so we compile once per resolve
// (in Compile) and reuse.
package blocked

import (
	"fmt"
	"regexp"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

// Compiled caches the compiled regex form of a BlockedPatternConfig
// so the hot path doesn't pay regex compilation. Build once from the
// bundle; reuse across every request until the VK config revision
// bumps.
type Compiled struct {
	Tools  CompiledPattern
	MCPs   CompiledPattern
	URLs   CompiledPattern
	Models CompiledPattern
}

// CompiledPattern is a deny/allow pair with pre-built regexes.
type CompiledPattern struct {
	Deny  []*regexp.Regexp
	Allow []*regexp.Regexp // nil = no allowlist enforcement
}

// Compile turns a BlockedPatternConfig into ready-to-match regexes.
// Returns the first compilation error — the VK config is broken and
// the gateway should refuse it on resolve.
func Compile(cfg auth.BlockedPatternConfig) (*Compiled, error) {
	out := &Compiled{}
	var err error
	out.Tools, err = compilePattern(cfg.Tools)
	if err != nil {
		return nil, fmt.Errorf("tools: %w", err)
	}
	out.MCPs, err = compilePattern(cfg.MCPs)
	if err != nil {
		return nil, fmt.Errorf("mcp: %w", err)
	}
	out.URLs, err = compilePattern(cfg.URLs)
	if err != nil {
		return nil, fmt.Errorf("urls: %w", err)
	}
	out.Models, err = compilePattern(cfg.Models)
	if err != nil {
		return nil, fmt.Errorf("models: %w", err)
	}
	return out, nil
}

func compilePattern(p auth.BlockedPattern) (CompiledPattern, error) {
	cp := CompiledPattern{}
	for _, re := range p.Deny {
		r, err := regexp.Compile(re)
		if err != nil {
			return cp, fmt.Errorf("compile deny %q: %w", re, err)
		}
		cp.Deny = append(cp.Deny, r)
	}
	if p.Allow != nil {
		cp.Allow = make([]*regexp.Regexp, 0, len(p.Allow))
		for _, re := range p.Allow {
			r, err := regexp.Compile(re)
			if err != nil {
				return cp, fmt.Errorf("compile allow %q: %w", re, err)
			}
			cp.Allow = append(cp.Allow, r)
		}
	}
	return cp, nil
}

// Evaluate checks a candidate string against deny and allow lists.
// Returns the offending pattern source (or empty string + bool) so
// the caller can emit it on the error envelope for debugging.
//
// Return values:
//   - (name, true)  → block; `name` is the matching regex (or the
//     candidate itself when allowlist rejects it — so operators can
//     tell why)
//   - ("",   false) → allow
func Evaluate(candidate string, pattern CompiledPattern) (string, bool) {
	// Deny wins outright.
	for _, re := range pattern.Deny {
		if re.MatchString(candidate) {
			return re.String(), true
		}
	}
	// If allowlist is configured, candidate must match at least one entry.
	if pattern.Allow != nil {
		ok := false
		for _, re := range pattern.Allow {
			if re.MatchString(candidate) {
				ok = true
				break
			}
		}
		if !ok {
			return candidate + " (not in allowlist)", true
		}
	}
	return "", false
}

// FirstBlockedTool scans a list of tool names and returns the first
// match against the Tools pattern (or empty string). Convenience for
// the dispatcher which hands us the already-extracted names.
func FirstBlockedTool(names []string, c *Compiled) (tool, reason string) {
	if c == nil {
		return "", ""
	}
	for _, n := range names {
		if p, blocked := Evaluate(n, c.Tools); blocked {
			return n, p
		}
	}
	return "", ""
}

// FirstBlockedMCP is the same for MCP identifiers.
func FirstBlockedMCP(names []string, c *Compiled) (mcp, reason string) {
	if c == nil {
		return "", ""
	}
	for _, n := range names {
		if p, blocked := Evaluate(n, c.MCPs); blocked {
			return n, p
		}
	}
	return "", ""
}

// FirstBlockedURL is the same for URLs appearing in a request body.
func FirstBlockedURL(urls []string, c *Compiled) (url, reason string) {
	if c == nil {
		return "", ""
	}
	for _, u := range urls {
		if p, blocked := Evaluate(u, c.URLs); blocked {
			return u, p
		}
	}
	return "", ""
}
