// Package cacherules evaluates the bundle-baked cache-control rules
// against a request context. Rules are pre-sorted priority DESC by the
// control plane (config.materialiser), so Evaluate walks linearly and
// returns the first match — no sort, no regex compile, no DB hit on
// the hot path.
//
// Spec: specs/ai-gateway/cache-control-rules.feature
// Design: docs/ai-gateway/cache-control.mdx §Rules engine
//
// Precedence (resolved by the caller, not this package):
//
//	per-request X-LangWatch-Cache header
//	> matched rule (this package)
//	> VK Cache default (bundle.Config.Cache.Mode)
//	> gateway default (respect)
package cacherules

import (
	"strings"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

// Request carries everything Evaluate needs to match a rule. Build it
// from the bundle + inbound request once; reuse for repeated calls in
// streaming paths.
type Request struct {
	VKID            string
	VKTags          []string
	PrincipalID     string
	Model           string
	RequestMetadata map[string]string
}

// Match is the outcome of a successful rule match. Callers compose this
// with the per-request header override — header > rule > VK default.
type Match struct {
	RuleID string
	Mode   string // respect|force|disable
	TTLS   int    // only meaningful when Mode == "force"
	Salt   string // optional cache-key salt
}

// Evaluate walks rules in the slice order (control plane emits priority
// DESC) and returns the first rule whose matchers all match req. The
// second return value reports whether a match was found; callers fall
// back to VK default on false.
//
// Empty rules slice is a hot-path fast-path: no allocation, no
// comparisons. The callers on /v1/messages, /v1/chat/completions, and
// /v1/embeddings all hit this first thing inside cacheoverride.Apply.
func Evaluate(rules []auth.CacheRuleSpec, req Request) (Match, bool) {
	for i := range rules {
		r := &rules[i]
		if matches(&r.Matchers, req) {
			return Match{
				RuleID: r.ID,
				Mode:   r.Action.Mode,
				TTLS:   r.Action.TTLS,
				Salt:   r.Action.Salt,
			}, true
		}
	}
	return Match{}, false
}

// matches implements the AND-across-non-null matcher semantics from
// cache-control-rules.feature §2. Any matcher field set to its zero
// value is treated as wildcard.
func matches(m *auth.CacheRuleMatchers, req Request) bool {
	if m.VKID != "" && m.VKID != req.VKID {
		return false
	}
	if m.VKPrefix != "" && !strings.HasPrefix(req.VKID, m.VKPrefix) {
		return false
	}
	if len(m.VKTags) > 0 && !hasAllTags(m.VKTags, req.VKTags) {
		return false
	}
	if m.PrincipalID != "" && m.PrincipalID != req.PrincipalID {
		return false
	}
	if m.Model != "" && !matchModel(m.Model, req.Model) {
		return false
	}
	if len(m.RequestMetadata) > 0 && !matchMetadata(m.RequestMetadata, req.RequestMetadata) {
		return false
	}
	return true
}

// hasAllTags checks that every tag in required is present in actual.
// Linear over typically-small slices (<10 tags) — map allocation would
// dwarf the compare cost.
func hasAllTags(required, actual []string) bool {
	for _, r := range required {
		found := false
		for _, a := range actual {
			if a == r {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

// matchModel supports exact match and trailing-* glob. Per spec §3 we
// intentionally do NOT support regex here — matchers are meant to be
// trivially auditable in the UI.
func matchModel(pattern, model string) bool {
	if strings.HasSuffix(pattern, "*") {
		return strings.HasPrefix(model, strings.TrimSuffix(pattern, "*"))
	}
	return pattern == model
}

// matchMetadata is a map-subset check: every key in required must exist
// in actual with the same value. Extra keys in actual are fine.
func matchMetadata(required, actual map[string]string) bool {
	for k, v := range required {
		if actual[k] != v {
			return false
		}
	}
	return true
}
