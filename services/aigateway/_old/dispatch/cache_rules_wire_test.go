package dispatch

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	dto "github.com/prometheus/client_model/go"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
	"github.com/langwatch/langwatch/services/gateway/internal/metrics"
)

// testDispatcher builds the minimum Dispatcher needed to exercise the
// cache-override paths (logger + metrics). No bifrost / breakers /
// fallback — those aren't touched by applyCacheOverride.
func testDispatcher(t *testing.T) (*Dispatcher, *metrics.Metrics) {
	t.Helper()
	m := metrics.New()
	return &Dispatcher{
		logger:  slog.New(slog.NewTextHandler(io.Discard, nil)),
		metrics: m,
	}, m
}

func testBundle(rules []auth.CacheRuleSpec) *auth.Bundle {
	return &auth.Bundle{
		JWTClaims:     auth.JWTClaims{PrincipalID: "user_42", VirtualKeyID: "vk_id_raw"},
		DisplayPrefix: "lw_vk_live_01ABCD",
		Config: &auth.Config{
			CacheRules: rules,
		},
	}
}

func postBody(body string) *http.Request {
	return httptest.NewRequest("POST", "/v1/messages", strings.NewReader(body))
}

// bodyWithCache returns an Anthropic-shape request body with a
// cache_control marker on the system block. stripCacheControl must
// remove it when mode=disable fires; respect passes through.
func bodyWithCache() string {
	return `{"system":[{"type":"text","text":"hi","cache_control":{"type":"ephemeral"}}],"messages":[{"role":"user","content":"ping"}]}`
}

func counterValue(t *testing.T, m *metrics.Metrics, ruleID, modeApplied string) float64 {
	t.Helper()
	c, err := m.CacheRuleHits.GetMetricWithLabelValues(ruleID, modeApplied)
	if err != nil {
		t.Fatalf("get counter: %v", err)
	}
	var pb dto.Metric
	if err := c.Write(&pb); err != nil {
		t.Fatalf("read counter: %v", err)
	}
	return pb.Counter.GetValue()
}

func TestApplyCacheOverride_HeaderWinsOverRule(t *testing.T) {
	d, m := testDispatcher(t)
	rules := []auth.CacheRuleSpec{
		{ID: "rule_disable_all", Priority: 999, Matchers: auth.CacheRuleMatchers{VKPrefix: "lw_vk_live_"}, Action: auth.CacheRuleAction{Mode: "disable"}},
	}
	b := testBundle(rules)

	rec := httptest.NewRecorder()
	req := postBody(bodyWithCache())
	req.Header.Set("X-LangWatch-Cache", "respect")

	out, ok := d.applyCacheOverride(rec, req, []byte(bodyWithCache()), "req_x", b)
	if !ok {
		t.Fatal("expected continue")
	}
	// Header said respect → rule's disable should NOT apply → cache_control preserved
	if !strings.Contains(string(out), `"cache_control":{"type":"ephemeral"}`) {
		t.Errorf("respect header should leave cache_control intact; got %s", out)
	}
	// Mode-applied header mirrors the header mode
	if got := rec.Header().Get("X-LangWatch-Cache-Mode"); got != "respect" {
		t.Errorf("X-LangWatch-Cache-Mode=%q want respect", got)
	}
	// Rule metric MUST NOT fire when header wins
	if v := counterValue(t, m, "rule_disable_all", "DISABLE"); v != 0 {
		t.Errorf("rule metric should not fire when header wins; got %f", v)
	}
}

func TestApplyCacheOverride_RuleDisableStripsCacheControl(t *testing.T) {
	d, m := testDispatcher(t)
	rules := []auth.CacheRuleSpec{
		{ID: "r_disable", Priority: 500, Matchers: auth.CacheRuleMatchers{VKPrefix: "lw_vk_live_"}, Action: auth.CacheRuleAction{Mode: "disable"}},
	}
	b := testBundle(rules)

	rec := httptest.NewRecorder()
	req := postBody(bodyWithCache())
	// No X-LangWatch-Cache → rule should apply

	out, ok := d.applyCacheOverride(rec, req, []byte(bodyWithCache()), "req_x", b)
	if !ok {
		t.Fatal("expected continue")
	}
	// Rule=disable → cache_control stripped
	if strings.Contains(string(out), `"cache_control"`) {
		t.Errorf("disable should strip cache_control; got %s", out)
	}
	if got := rec.Header().Get("X-LangWatch-Cache-Mode"); got != "disable" {
		t.Errorf("X-LangWatch-Cache-Mode=%q want disable", got)
	}
	// Metric fires with upper-case mode to match control-plane mode_enum
	if v := counterValue(t, m, "r_disable", "DISABLE"); v != 1 {
		t.Errorf("rule metric should fire once; got %f", v)
	}
}

func TestApplyCacheOverride_RuleForceInjectsOnAnthropic(t *testing.T) {
	// Iter 50: force is now implemented for Anthropic-shape bodies.
	// Body with NO cache_control on the target block gets the marker.
	d, m := testDispatcher(t)
	rules := []auth.CacheRuleSpec{
		{ID: "r_force", Priority: 500, Matchers: auth.CacheRuleMatchers{VKPrefix: "lw_vk_live_"}, Action: auth.CacheRuleAction{Mode: "force", TTLS: 600}},
	}
	b := testBundle(rules)

	rec := httptest.NewRecorder()
	// Anthropic-shape body with NO cache_control initially.
	body := `{"system":[{"type":"text","text":"hi"}],"messages":[{"role":"user","content":"ping"}]}`

	out, ok := d.applyCacheOverride(rec, httptest.NewRequest("POST", "/v1/messages", strings.NewReader(body)), []byte(body), "req_x", b)
	if !ok {
		t.Fatal("expected continue")
	}
	// Force injected cache_control on system[-1]
	if !strings.Contains(string(out), `"cache_control":{"type":"ephemeral"}`) {
		t.Errorf("force should inject cache_control ephemeral; got %s", out)
	}
	if got := rec.Header().Get("X-LangWatch-Cache-Mode"); got != "force" {
		t.Errorf("X-LangWatch-Cache-Mode=%q want force", got)
	}
	// Metric fires with FORCE on mode_applied
	if v := counterValue(t, m, "r_force", "FORCE"); v != 1 {
		t.Errorf("rule metric should fire once with FORCE label; got %f", v)
	}
}

// TestApplyCacheOverride_EmbeddingsPath covers iter 51 — cache-rules
// on /v1/embeddings. Embedding endpoints use the same applyCacheOverride
// as chat/messages; body-level mutations are no-ops on the current
// OpenAI-shape embeddings schema (no cache_control field), so the
// value is observability: rule fires + metric bumps + span attrs.
func TestApplyCacheOverride_EmbeddingsPath(t *testing.T) {
	d, m := testDispatcher(t)
	rules := []auth.CacheRuleSpec{
		{ID: "r_emb", Priority: 500, Matchers: auth.CacheRuleMatchers{VKPrefix: "lw_vk_live_"}, Action: auth.CacheRuleAction{Mode: "disable"}},
	}
	b := testBundle(rules)

	rec := httptest.NewRecorder()
	// Embeddings body is OpenAI-shape: model + input string/array
	body := `{"model":"text-embedding-3-small","input":"the quick brown fox"}`
	_, ok := d.applyCacheOverride(rec, httptest.NewRequest("POST", "/v1/embeddings", strings.NewReader(body)), []byte(body), "req_x", b)
	if !ok {
		t.Fatal("expected continue")
	}
	if v := counterValue(t, m, "r_emb", "DISABLE"); v != 1 {
		t.Errorf("rule metric should fire on /v1/embeddings; got %f", v)
	}
	if got := rec.Header().Get("X-LangWatch-Cache-Mode"); got != "disable" {
		t.Errorf("X-LangWatch-Cache-Mode=%q want disable", got)
	}
}

func TestApplyCacheOverride_RuleForceOpenAIShapePassthrough(t *testing.T) {
	// Force on OpenAI-shape body (string content) is a body-level
	// no-op — their caching is automatic. Rule still fires so
	// operators see it in metrics + span attrs.
	d, m := testDispatcher(t)
	rules := []auth.CacheRuleSpec{
		{ID: "r_force_openai", Priority: 500, Matchers: auth.CacheRuleMatchers{VKPrefix: "lw_vk_live_"}, Action: auth.CacheRuleAction{Mode: "force", TTLS: 300}},
	}
	b := testBundle(rules)

	rec := httptest.NewRecorder()
	body := `{"model":"gpt-5-mini","messages":[{"role":"user","content":"ping"}]}`
	out, ok := d.applyCacheOverride(rec, httptest.NewRequest("POST", "/v1/chat/completions", strings.NewReader(body)), []byte(body), "req_x", b)
	if !ok {
		t.Fatal("expected continue")
	}
	if string(out) != body {
		t.Errorf("OpenAI shape should be byte-identical on force; got %s", out)
	}
	if v := counterValue(t, m, "r_force_openai", "FORCE"); v != 1 {
		t.Errorf("metric should still fire on OpenAI-shape passthrough; got %f", v)
	}
}

func TestApplyCacheOverride_NoRulesNoHeaderPassthrough(t *testing.T) {
	d, _ := testDispatcher(t)
	b := testBundle(nil)

	rec := httptest.NewRecorder()
	body := bodyWithCache()
	out, ok := d.applyCacheOverride(rec, postBody(body), []byte(body), "req_x", b)
	if !ok {
		t.Fatal("expected continue")
	}
	// Unchanged body (respect default, nothing to do)
	if string(out) != body {
		t.Errorf("no rules + no header must pass through; got %s", out)
	}
	// No X-LangWatch-Cache-Mode header emitted on the pure-passthrough path
	if got := rec.Header().Get("X-LangWatch-Cache-Mode"); got != "" {
		t.Errorf("pure passthrough must not set X-LangWatch-Cache-Mode; got %q", got)
	}
}

func TestApplyCacheOverride_RuleMatchWithPrincipalID(t *testing.T) {
	d, m := testDispatcher(t)
	rules := []auth.CacheRuleSpec{
		{ID: "r_principal", Priority: 400, Matchers: auth.CacheRuleMatchers{PrincipalID: "user_42"}, Action: auth.CacheRuleAction{Mode: "disable"}},
	}
	b := testBundle(rules)

	rec := httptest.NewRecorder()
	body := bodyWithCache()
	_, ok := d.applyCacheOverride(rec, postBody(body), []byte(body), "req_x", b)
	if !ok {
		t.Fatal("expected continue")
	}
	if v := counterValue(t, m, "r_principal", "DISABLE"); v != 1 {
		t.Errorf("principal matcher should fire; got %f", v)
	}
}

// TestApplyCacheOverride_RulesExistButNoneMatch closes a coverage
// gap from iter 48: rules are present in the bundle but NO matcher
// fires (e.g. principal_id or tag narrow enough to exclude this
// request). Must be pure passthrough — no mode header emitted, no
// metric bump, no span attr, no body mutation.
func TestApplyCacheOverride_RulesExistButNoneMatch(t *testing.T) {
	d, m := testDispatcher(t)
	rules := []auth.CacheRuleSpec{
		{ID: "r_narrow", Priority: 500, Matchers: auth.CacheRuleMatchers{PrincipalID: "someone_else"}, Action: auth.CacheRuleAction{Mode: "disable"}},
	}
	b := testBundle(rules) // principal_id on bundle is "user_42", won't match

	rec := httptest.NewRecorder()
	body := bodyWithCache()
	out, ok := d.applyCacheOverride(rec, postBody(body), []byte(body), "req_x", b)
	if !ok {
		t.Fatal("expected continue")
	}
	// Body unchanged
	if string(out) != body {
		t.Errorf("no-match must passthrough; got %s", out)
	}
	// No mode header (per iter 48 NoRulesNoHeaderPassthrough invariant)
	if got := rec.Header().Get("X-LangWatch-Cache-Mode"); got != "" {
		t.Errorf("no-match must not emit mode header; got %q", got)
	}
	// Metric never fired for this rule
	if v := counterValue(t, m, "r_narrow", "DISABLE"); v != 0 {
		t.Errorf("no-match rule must not bump metric; got %f", v)
	}
}

// TestApplyCacheOverride_ModelMatcherFires covers iter 49: extractModelField
// lets rule.matchers.model fire from inside applyCacheOverride without
// waiting for parseOpenAIChatBody downstream. Closes the scope note
// in iter 47's docs that said "model-field matchers don't fire on
// /v1/messages because model parse happens below cache-override".
func TestApplyCacheOverride_ModelMatcherFires(t *testing.T) {
	d, m := testDispatcher(t)
	rules := []auth.CacheRuleSpec{
		{ID: "r_haiku", Priority: 700, Matchers: auth.CacheRuleMatchers{Model: "claude-haiku-*"}, Action: auth.CacheRuleAction{Mode: "disable"}},
	}
	b := testBundle(rules)

	rec := httptest.NewRecorder()
	body := `{"model":"claude-haiku-4-5-20251001","system":[{"type":"text","text":"hi","cache_control":{"type":"ephemeral"}}],"messages":[{"role":"user","content":"ping"}]}`
	_, ok := d.applyCacheOverride(rec, postBody(body), []byte(body), "req_x", b)
	if !ok {
		t.Fatal("expected continue")
	}
	if v := counterValue(t, m, "r_haiku", "DISABLE"); v != 1 {
		t.Errorf("model glob matcher should fire on claude-haiku-4-5; got %f", v)
	}
}

// TestExtractModelField covers the cheap JSON peek helper iter 49
// added so cache-rule model matchers can fire without waiting for
// parseOpenAIChatBody.
func TestExtractModelField(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"happy path", `{"model":"gpt-5-mini","messages":[]}`, "gpt-5-mini"},
		{"missing model", `{"messages":[]}`, ""},
		{"malformed json", `{"model":"gpt-5-mini"`, ""},
		{"empty body", ``, ""},
		{"extra fields ignored", `{"stream":true,"model":"claude-haiku-4-5","messages":[]}`, "claude-haiku-4-5"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := extractModelField([]byte(tc.body)); got != tc.want {
				t.Errorf("got %q want %q", got, tc.want)
			}
		})
	}
}

// BenchmarkApplyCacheOverride_* measures the full dispatcher path
// (header check + rule evaluation + body apply) on the hot path, not
// just the inner cacherules.Evaluate (iter 45's 24 ns/op bench).
// Pairs with those to validate the ~700 ns spec §4 target end-to-end.
// Measurements on amd64 VirtualApple @ 2.5 GHz (iter 53):
//
//	NoRulesFastPath:       70 ns/op   1 alloc    — empty rules early-out
//	HeaderOnlyRespect:    252 ns/op   4 allocs   — parse + mode header
//	RuleHitModeDisable:  5000 ns/op  63 allocs   — evaluator + JSON strip
//	RuleHitModeForce:    4553 ns/op  64 allocs   — evaluator + JSON inject
//
// The no-rules path fits the 700 ns budget with 10× headroom. The
// rule-hit paths are dominated by JSON marshal/unmarshal of the body
// (~4-5 μs), which is expected — mutating a multi-KB body can't be
// sub-microsecond. The evaluator + precedence logic itself stays at
// ~25 ns per iter 45. If ops needs the rule-hit path faster, the win
// is switching from encoding/json to a streaming JSON mutator (~5×
// speedup possible) — flagged as v1.1 perf follow-up.
func BenchmarkApplyCacheOverride_NoRulesFastPath(b *testing.B) {
	d, _ := testDispatcher(&testing.T{})
	bundle := testBundle(nil)
	body := []byte(bodyWithCache())
	req := postBody(string(body))
	rec := httptest.NewRecorder()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = d.applyCacheOverride(rec, req, body, "req_x", bundle)
	}
}

func BenchmarkApplyCacheOverride_HeaderOnlyRespect(b *testing.B) {
	d, _ := testDispatcher(&testing.T{})
	bundle := testBundle(nil)
	body := []byte(bodyWithCache())
	req := postBody(string(body))
	req.Header.Set("X-LangWatch-Cache", "respect")
	rec := httptest.NewRecorder()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = d.applyCacheOverride(rec, req, body, "req_x", bundle)
	}
}

func BenchmarkApplyCacheOverride_RuleHitModeDisable(b *testing.B) {
	d, _ := testDispatcher(&testing.T{})
	rules := []auth.CacheRuleSpec{
		{ID: "r_disable", Priority: 500, Matchers: auth.CacheRuleMatchers{VKPrefix: "lw_vk_live_"}, Action: auth.CacheRuleAction{Mode: "disable"}},
	}
	bundle := testBundle(rules)
	body := []byte(bodyWithCache())
	req := postBody(string(body))
	rec := httptest.NewRecorder()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = d.applyCacheOverride(rec, req, body, "req_x", bundle)
	}
}

func BenchmarkApplyCacheOverride_RuleHitModeForce(b *testing.B) {
	d, _ := testDispatcher(&testing.T{})
	rules := []auth.CacheRuleSpec{
		{ID: "r_force", Priority: 500, Matchers: auth.CacheRuleMatchers{VKPrefix: "lw_vk_live_"}, Action: auth.CacheRuleAction{Mode: "force", TTLS: 600}},
	}
	bundle := testBundle(rules)
	body := []byte(`{"system":[{"type":"text","text":"hi"}],"messages":[{"role":"user","content":"ping"}]}`)
	req := postBody(string(body))
	rec := httptest.NewRecorder()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = d.applyCacheOverride(rec, req, body, "req_x", bundle)
	}
}

// sanity check the wire contract: respect does not mutate body at all.
func TestApplyCacheOverride_RuleRespectIsPurePassthrough(t *testing.T) {
	d, m := testDispatcher(t)
	rules := []auth.CacheRuleSpec{
		{ID: "r_respect", Priority: 200, Matchers: auth.CacheRuleMatchers{VKPrefix: "lw_vk_live_"}, Action: auth.CacheRuleAction{Mode: "respect"}},
	}
	b := testBundle(rules)

	rec := httptest.NewRecorder()
	body := bodyWithCache()
	out, ok := d.applyCacheOverride(rec, postBody(body), []byte(body), "req_x", b)
	if !ok {
		t.Fatal("expected continue")
	}
	// Byte-identical — respect = explicit passthrough
	if string(out) != body {
		var a, bmap map[string]any
		_ = json.Unmarshal([]byte(body), &a)
		_ = json.Unmarshal(out, &bmap)
		t.Errorf("respect rule must NOT mutate body; in=%s out=%s", body, out)
	}
	if v := counterValue(t, m, "r_respect", "RESPECT"); v != 1 {
		t.Errorf("respect rule metric should fire; got %f", v)
	}
}
