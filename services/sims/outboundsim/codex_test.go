package outboundsim

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func (g *rig) deviceStart() (id, code string) {
	g.t.Helper()
	got := g.post("/codex-auth/api/accounts/deviceauth/usercode", `{"client_id":"app_x"}`)
	if got.status != http.StatusOK {
		g.t.Fatalf("usercode = %d %s", got.status, got.body)
	}
	var out map[string]string
	decode(g.t, got.body, &out)
	if out["interval"] == "" {
		g.t.Fatalf("usercode answered no interval: %s", got.body)
	}
	return out["device_auth_id"], out["user_code"]
}

func (g *rig) devicePoll(id, code string) answer {
	g.t.Helper()
	return g.post("/codex-auth/api/accounts/deviceauth/token", `{"device_auth_id":"`+id+`","user_code":"`+code+`"}`)
}

func (g *rig) form(path string, values url.Values) answer {
	g.t.Helper()
	return g.do(http.MethodPost, path, map[string]string{"Content-Type": "application/x-www-form-urlencoded"}, values.Encode())
}

// signIn walks a device sign-in to its token set: start, approve in the page, poll, exchange.
func (g *rig) signIn() map[string]any {
	g.t.Helper()
	id, code := g.deviceStart()
	if page := g.form("/codex-auth/codex/device", url.Values{"user_code": {code}, "action": {"approve"}}); page.status != http.StatusOK || !strings.Contains(page.body, "Approved") {
		g.t.Fatalf("approve page = %d %s", page.status, page.body)
	}
	polled := g.devicePoll(id, code)
	var grant map[string]string
	decode(g.t, polled.body, &grant)
	if polled.status != http.StatusOK || grant["code_verifier"] == "" {
		g.t.Fatalf("approved poll = %d %s", polled.status, polled.body)
	}
	exchanged := g.form("/codex-auth/oauth/token", url.Values{
		"grant_type": {"authorization_code"}, "code": {grant["authorization_code"]}, "code_verifier": {grant["code_verifier"]},
	})
	var tokens map[string]any
	decode(g.t, exchanged.body, &tokens)
	if exchanged.status != http.StatusOK {
		g.t.Fatalf("code exchange = %d %s", exchanged.status, exchanged.body)
	}
	return tokens
}

func (g *rig) turn(token string) answer {
	g.t.Helper()
	return g.postAs("/codex-api/responses", tokenHeader(token), `{"model":"gpt-5-codex","stream":true,"store":false,"input":[]}`)
}

// @scenario "Outboundsim stands in for Codex device sign-in and model turns"
func TestCodexDeviceSignInAndTurn(t *testing.T) {
	g := newRig(t, Config{})
	id, code := g.deviceStart()
	if got := g.devicePoll(id, code); got.status != http.StatusForbidden || !strings.Contains(got.body, "authorization_pending") {
		t.Fatalf("pending poll = %d %s, want 403 authorization_pending", got.status, got.body)
	}
	if got := g.devicePoll("deviceauth-unknown", code); got.status != http.StatusNotFound {
		t.Fatalf("unknown device poll = %d, want 404", got.status)
	}
	if page := g.get("/codex-auth/codex/device", nil); page.status != http.StatusOK || !strings.Contains(page.body, "Approve") {
		t.Fatalf("device page = %d %s", page.status, page.body)
	}

	tokens := g.signIn()
	claims := strings.Split(tokens["id_token"].(string), ".")[1]
	raw, _ := base64.RawURLEncoding.DecodeString(claims)
	if !strings.Contains(string(raw), `"chatgpt_account_id":"acct_outboundsim"`) {
		t.Fatalf("id token claims = %s", raw)
	}

	turn := g.turn(tokens["access_token"].(string))
	if turn.status != http.StatusOK || !strings.HasPrefix(turn.header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("turn = %d %s", turn.status, turn.header.Get("Content-Type"))
	}
	for _, event := range []string{"response.created", "response.output_text.delta", "response.output_item.done", "response.completed"} {
		if !strings.Contains(turn.body, "event: "+event+"\n") {
			t.Fatalf("turn stream lacks %s:\n%s", event, turn.body)
		}
	}
	if rec := g.one("channel=codex&target=/codex-api/responses"); rec.Status != http.StatusOK {
		t.Fatalf("recorded turn status = %d", rec.Status)
	}

	refreshed := g.form("/codex-auth/oauth/token", url.Values{"grant_type": {"refresh_token"}, "refresh_token": {tokens["refresh_token"].(string)}})
	if refreshed.status != http.StatusOK || !strings.Contains(refreshed.body, "sim-codex-at-") {
		t.Fatalf("refresh = %d %s", refreshed.status, refreshed.body)
	}
}

// @scenario "Outboundsim's Codex refuses as the control API asks"
func TestCodexRefusalsFromTheControlAPI(t *testing.T) {
	g := newRig(t, Config{})
	tokens := g.signIn()
	access, refresh := tokens["access_token"].(string), tokens["refresh_token"].(string)

	setState := func(body string) {
		t.Helper()
		if got := g.do(http.MethodPut, "/_sim/api/codex", nil, body); got.status != http.StatusOK {
			t.Fatalf("set state = %d %s", got.status, got.body)
		}
	}

	setState(`{"usageLimit":true}`)
	limited := g.turn(access)
	if limited.status != http.StatusTooManyRequests || !strings.Contains(limited.body, "usage_limit_reached") {
		t.Fatalf("usage limit turn = %d %s", limited.status, limited.body)
	}

	setState(`{}`)
	if got := g.post("/_sim/api/codex/expire-tokens", ""); got.status != http.StatusOK {
		t.Fatalf("expire tokens = %d", got.status)
	}
	if got := g.turn(access); got.status != http.StatusUnauthorized {
		t.Fatalf("expired token turn = %d, want 401", got.status)
	}

	setState(`{"refreshRevoked":true}`)
	revoked := g.form("/codex-auth/oauth/token", url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}})
	if revoked.status != http.StatusBadRequest || !strings.Contains(revoked.body, "invalid_grant") {
		t.Fatalf("revoked refresh = %d %s", revoked.status, revoked.body)
	}

	setState(`{"slowDown":true}`)
	id, code := g.deviceStart()
	if got := g.devicePoll(id, code); got.status != http.StatusForbidden || !strings.Contains(got.body, "slow_down") {
		t.Fatalf("slow_down poll = %d %s", got.status, got.body)
	}
	if got := g.post("/_sim/api/codex/devices/"+code+"/expire", ""); got.status != http.StatusOK {
		t.Fatalf("expire device = %d %s", got.status, got.body)
	}
	if got := g.devicePoll(id, code); got.status != http.StatusBadRequest || !strings.Contains(got.body, "expired_token") {
		t.Fatalf("expired poll = %d %s", got.status, got.body)
	}

	id, code = g.deviceStart()
	if got := g.post("/_sim/api/codex/devices/"+code+"/deny", ""); got.status != http.StatusOK {
		t.Fatalf("deny = %d %s", got.status, got.body)
	}
	if got := g.devicePoll(id, code); got.status != http.StatusBadRequest || !strings.Contains(got.body, "access_denied") {
		t.Fatalf("denied poll = %d %s", got.status, got.body)
	}
}

func TestCodexDeviceCodeExpiresAfterItsTTL(t *testing.T) {
	g := newRig(t, Config{})
	now := time.Date(2026, 10, 9, 10, 0, 0, 0, time.UTC)
	g.s.now = func() time.Time { return now }
	if got := g.do(http.MethodPut, "/_sim/api/codex", nil, `{"deviceTtlSeconds":60}`); got.status != http.StatusOK {
		t.Fatalf("set ttl = %d", got.status)
	}
	id, code := g.deviceStart()
	now = now.Add(61 * time.Second)
	if got := g.devicePoll(id, code); got.status != http.StatusBadRequest || !strings.Contains(got.body, "expired_token") {
		t.Fatalf("poll past ttl = %d %s", got.status, got.body)
	}
	var state struct {
		Devices []CodexDevice `json:"devices"`
	}
	if err := json.Unmarshal([]byte(g.get("/_sim/api/codex", nil).body), &state); err != nil || len(state.Devices) != 1 || state.Devices[0].Status != "expired" {
		t.Fatalf("state = %+v (%v)", state, err)
	}
}
