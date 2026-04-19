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

func TestApplyCacheOverride_RuleForceDowngradesToRespect(t *testing.T) {
	d, m := testDispatcher(t)
	rules := []auth.CacheRuleSpec{
		{ID: "r_force", Priority: 500, Matchers: auth.CacheRuleMatchers{VKPrefix: "lw_vk_live_"}, Action: auth.CacheRuleAction{Mode: "force", TTLS: 600}},
	}
	b := testBundle(rules)

	rec := httptest.NewRecorder()
	body := bodyWithCache()

	out, ok := d.applyCacheOverride(rec, httptest.NewRequest("POST", "/v1/messages", strings.NewReader(body)), []byte(body), "req_x", b)
	if !ok {
		t.Fatal("expected continue")
	}
	// v1 deferral: force downgrades to respect, body unchanged
	if !strings.Contains(string(out), `"cache_control":{"type":"ephemeral"}`) {
		t.Errorf("force-deferred should preserve cache_control; got %s", out)
	}
	if got := rec.Header().Get("X-LangWatch-Cache-Mode"); got != "respect" {
		t.Errorf("force-deferred X-LangWatch-Cache-Mode=%q want respect", got)
	}
	// Metric still fires — operators need to see the rule matched
	if v := counterValue(t, m, "r_force", "RESPECT"); v != 1 {
		t.Errorf("rule metric should fire once for force→respect downgrade; got %f", v)
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
