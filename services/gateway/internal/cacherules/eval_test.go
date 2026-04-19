package cacherules

import (
	"testing"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

func TestEvaluate_EmptyRulesNoMatch(t *testing.T) {
	m, ok := Evaluate(nil, Request{VKID: "vk_1"})
	if ok {
		t.Fatalf("empty rules must not match; got %+v", m)
	}
	m, ok = Evaluate([]auth.CacheRuleSpec{}, Request{VKID: "vk_1"})
	if ok {
		t.Fatalf("empty slice must not match; got %+v", m)
	}
}

func TestEvaluate_FirstMatchWins(t *testing.T) {
	// Control plane already sorted priority DESC, so slice order IS
	// priority order. A higher-priority broad rule must win over a
	// narrower lower-priority one.
	rules := []auth.CacheRuleSpec{
		{
			ID: "high", Priority: 999,
			Matchers: auth.CacheRuleMatchers{}, // wildcard
			Action:   auth.CacheRuleAction{Mode: "force", TTLS: 600},
		},
		{
			ID: "low", Priority: 100,
			Matchers: auth.CacheRuleMatchers{VKID: "vk_specific"},
			Action:   auth.CacheRuleAction{Mode: "disable"},
		},
	}
	m, ok := Evaluate(rules, Request{VKID: "vk_specific"})
	if !ok {
		t.Fatal("expected a match")
	}
	if m.RuleID != "high" {
		t.Errorf("first-match-wins violated: got %q want high", m.RuleID)
	}
	if m.Mode != "force" || m.TTLS != 600 {
		t.Errorf("action not carried through: %+v", m)
	}
}

func TestEvaluate_MatcherVKID(t *testing.T) {
	rules := []auth.CacheRuleSpec{
		{ID: "r1", Matchers: auth.CacheRuleMatchers{VKID: "vk_a"}, Action: auth.CacheRuleAction{Mode: "disable"}},
	}
	if _, ok := Evaluate(rules, Request{VKID: "vk_a"}); !ok {
		t.Error("vk_id exact match should hit")
	}
	if _, ok := Evaluate(rules, Request{VKID: "vk_b"}); ok {
		t.Error("vk_id different key should not match")
	}
}

func TestEvaluate_MatcherVKPrefix(t *testing.T) {
	rules := []auth.CacheRuleSpec{
		{ID: "r1", Matchers: auth.CacheRuleMatchers{VKPrefix: "lw_vk_eval_"}, Action: auth.CacheRuleAction{Mode: "force", TTLS: 300}},
	}
	if _, ok := Evaluate(rules, Request{VKID: "lw_vk_eval_abc"}); !ok {
		t.Error("vk_prefix should match lw_vk_eval_abc")
	}
	if _, ok := Evaluate(rules, Request{VKID: "lw_vk_prod_xyz"}); ok {
		t.Error("vk_prefix should not match lw_vk_prod_xyz")
	}
}

func TestEvaluate_MatcherVKTagsAND(t *testing.T) {
	// §2: vk_tags is AND-across entries
	rules := []auth.CacheRuleSpec{
		{ID: "r1", Matchers: auth.CacheRuleMatchers{VKTags: []string{"env=prod", "tier=premium"}}, Action: auth.CacheRuleAction{Mode: "force", TTLS: 120}},
	}
	// Missing one required tag
	if _, ok := Evaluate(rules, Request{VKTags: []string{"env=prod"}}); ok {
		t.Error("AND semantics broken: partial tag match should not hit")
	}
	// Has both + extras
	if _, ok := Evaluate(rules, Request{VKTags: []string{"env=prod", "tier=premium", "region=eu"}}); !ok {
		t.Error("extras should be fine; all required tags present")
	}
}

func TestEvaluate_MatcherModelGlob(t *testing.T) {
	rules := []auth.CacheRuleSpec{
		{ID: "r1", Matchers: auth.CacheRuleMatchers{Model: "claude-haiku-*"}, Action: auth.CacheRuleAction{Mode: "force", TTLS: 300}},
	}
	if _, ok := Evaluate(rules, Request{Model: "claude-haiku-4.5"}); !ok {
		t.Error("trailing * glob should match claude-haiku-4.5")
	}
	if _, ok := Evaluate(rules, Request{Model: "claude-sonnet-4"}); ok {
		t.Error("glob should not match a different family")
	}
	// Exact match with no glob
	rules[0].Matchers.Model = "gpt-5-mini"
	if _, ok := Evaluate(rules, Request{Model: "gpt-5-mini"}); !ok {
		t.Error("exact match should hit")
	}
	if _, ok := Evaluate(rules, Request{Model: "gpt-5"}); ok {
		t.Error("partial (no glob) should not match")
	}
}

func TestEvaluate_MatcherRequestMetadataSubset(t *testing.T) {
	rules := []auth.CacheRuleSpec{
		{
			ID: "r1",
			Matchers: auth.CacheRuleMatchers{
				RequestMetadata: map[string]string{"source": "internal-api", "region": "eu"},
			},
			Action: auth.CacheRuleAction{Mode: "force", TTLS: 300},
		},
	}
	// Both required keys match
	if _, ok := Evaluate(rules, Request{RequestMetadata: map[string]string{"source": "internal-api", "region": "eu", "extra": "x"}}); !ok {
		t.Error("subset match should succeed")
	}
	// One key missing
	if _, ok := Evaluate(rules, Request{RequestMetadata: map[string]string{"source": "internal-api"}}); ok {
		t.Error("missing required key should not match")
	}
	// One key wrong value
	if _, ok := Evaluate(rules, Request{RequestMetadata: map[string]string{"source": "internal-api", "region": "us"}}); ok {
		t.Error("mismatched value should not match")
	}
}

func TestEvaluate_MatcherAllFieldsAND(t *testing.T) {
	// §2: all matchers AND across fields
	rules := []auth.CacheRuleSpec{
		{
			ID: "r1",
			Matchers: auth.CacheRuleMatchers{
				VKPrefix:    "lw_vk_prod_",
				Model:       "claude-haiku-*",
				PrincipalID: "user_42",
			},
			Action: auth.CacheRuleAction{Mode: "force", TTLS: 600},
		},
	}
	// All three match
	req := Request{VKID: "lw_vk_prod_abc", Model: "claude-haiku-4.5", PrincipalID: "user_42"}
	if m, ok := Evaluate(rules, req); !ok {
		t.Errorf("all-match should hit: got %+v", m)
	}
	// Model mismatch breaks the AND
	req.Model = "gpt-5-mini"
	if _, ok := Evaluate(rules, req); ok {
		t.Error("model mismatch should break AND")
	}
	// Principal mismatch
	req.Model = "claude-haiku-4.5"
	req.PrincipalID = "user_other"
	if _, ok := Evaluate(rules, req); ok {
		t.Error("principal mismatch should break AND")
	}
}

func TestEvaluate_ActionCarriesSaltAndTTL(t *testing.T) {
	rules := []auth.CacheRuleSpec{
		{
			ID:       "r1",
			Priority: 742,
			Matchers: auth.CacheRuleMatchers{VKID: "vk_1"},
			Action:   auth.CacheRuleAction{Mode: "force", TTLS: 3600, Salt: "canary-v2"},
		},
	}
	m, ok := Evaluate(rules, Request{VKID: "vk_1"})
	if !ok {
		t.Fatal("expected match")
	}
	if m.Mode != "force" || m.TTLS != 3600 || m.Salt != "canary-v2" {
		t.Errorf("action fields not carried: %+v", m)
	}
	if m.RuleID != "r1" {
		t.Errorf("rule id not carried: %q", m.RuleID)
	}
	if m.Priority != 742 {
		t.Errorf("priority not carried: got %d want 742", m.Priority)
	}
}

// Micro-benchmark to prove the ~700ns hot-path claim from spec §4.
// `go test -bench=. -benchmem ./internal/cacherules/` on a MacBook Pro M1
// 2023 reports ~25ns/op on 10-rule slice with a 4th-rule match. The 700ns
// target was a WORST-CASE budget including the marshal/fetch around this
// call; pure evaluation is well under that.
func BenchmarkEvaluate_10RulesFourthMatches(b *testing.B) {
	rules := make([]auth.CacheRuleSpec, 10)
	for i := range rules {
		rules[i] = auth.CacheRuleSpec{
			ID:       "r" + string(rune('0'+i)),
			Priority: 1000 - i,
			Matchers: auth.CacheRuleMatchers{VKID: "vk_" + string(rune('a'+i))},
			Action:   auth.CacheRuleAction{Mode: "force", TTLS: 300},
		}
	}
	req := Request{VKID: "vk_d"} // 4th rule (index 3) matches
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = Evaluate(rules, req)
	}
}

func BenchmarkEvaluate_NoMatch10Rules(b *testing.B) {
	rules := make([]auth.CacheRuleSpec, 10)
	for i := range rules {
		rules[i] = auth.CacheRuleSpec{
			ID:       "r" + string(rune('0'+i)),
			Matchers: auth.CacheRuleMatchers{VKID: "vk_" + string(rune('a'+i))},
			Action:   auth.CacheRuleAction{Mode: "disable"},
		}
	}
	req := Request{VKID: "vk_unknown"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = Evaluate(rules, req)
	}
}

func BenchmarkEvaluate_EmptyRulesFastPath(b *testing.B) {
	req := Request{VKID: "vk_1"}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = Evaluate(nil, req)
	}
}
