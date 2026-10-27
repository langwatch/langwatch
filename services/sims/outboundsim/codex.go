package outboundsim

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ChannelCodex records the Codex (ChatGPT subscription) calls: device sign-in and token
// grants on the issuer base (/codex-auth) and model turns on the API base (/codex-api).
const ChannelCodex = "codex"

// The wire facts this stand-in mirrors, as the product and the codex CLI read them:
//   - the issuer reports "not approved yet" as 403 (404 for an unknown device), never 200;
//     slow_down rides the same 403, expired_token and access_denied are 400s;
//   - a refresh the issuer refuses for good is a 400 naming invalid_grant;
//   - the model backend speaks Responses SSE only and its response.completed carries an
//     empty output array; a plan limit is a 429 with error.type usage_limit_reached.
const (
	codexIntervalSeconds = 3
	codexDefaultTTL      = 15 * time.Minute
	codexAccountID       = "acct_outboundsim"
	codexEmail           = "codex@sim.vendor.test"
)

// CodexState is what the control API sets; the zero value is a healthy account.
type CodexState struct {
	// UsageLimit refuses every model turn with the plan's usage-limit 429.
	UsageLimit bool `json:"usageLimit"`
	// SlowDown answers every device poll with slow_down (still a 403, so callers keep waiting).
	SlowDown bool `json:"slowDown"`
	// RefreshRevoked refuses every refresh grant with invalid_grant: the session is dead.
	RefreshRevoked bool `json:"refreshRevoked"`
	// DeviceTTLSeconds is how long a device code lives before expired_token (0 = 15 minutes).
	DeviceTTLSeconds int `json:"deviceTtlSeconds"`
	// Plan is the chatgpt_plan_type the id token carries ("" = plus).
	Plan string `json:"plan"`
}

// CodexDevice is one device sign-in as the control API lists it.
type CodexDevice struct {
	DeviceAuthID string    `json:"deviceAuthId"`
	UserCode     string    `json:"userCode"`
	Status       string    `json:"status"`
	CreatedAt    time.Time `json:"createdAt"`
}

type codexAccount struct {
	mu      sync.Mutex
	next    int
	state   CodexState
	devices map[string]*CodexDevice // by device auth id
	codes   map[string]bool         // authorization codes not yet exchanged
	expired map[string]bool         // access tokens the control API aged out
}

func newCodexAccount() *codexAccount {
	return &codexAccount{devices: map[string]*CodexDevice{}, codes: map[string]bool{}, expired: map[string]bool{}}
}

func (a *codexAccount) mint(prefix string) string {
	a.next++
	return fmt.Sprintf("%s-%d", prefix, a.next)
}

func (a *codexAccount) ttl() time.Duration {
	if a.state.DeviceTTLSeconds > 0 {
		return time.Duration(a.state.DeviceTTLSeconds) * time.Second
	}
	return codexDefaultTTL
}

// deviceByCode is the device holding userCode, with its status brought up to now.
func (a *codexAccount) deviceByCode(userCode string, now time.Time) *CodexDevice {
	for _, d := range a.devices {
		if strings.EqualFold(d.UserCode, strings.TrimSpace(userCode)) {
			a.age(d, now)
			return d
		}
	}
	return nil
}

func (a *codexAccount) age(d *CodexDevice, now time.Time) {
	if d.Status == "pending" && now.Sub(d.CreatedAt) > a.ttl() {
		d.Status = "expired"
	}
}

func (a *codexAccount) idToken() string {
	plan := a.state.Plan
	if plan == "" {
		plan = "plus"
	}
	part := func(v any) string {
		raw, _ := json.Marshal(v)
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	return part(map[string]string{"alg": "none", "typ": "JWT"}) + "." + part(map[string]any{
		"email": codexEmail,
		"https://api.openai.com/auth": map[string]string{
			"chatgpt_account_id": codexAccountID, "chatgpt_plan_type": plan,
		},
	}) + ".outboundsim"
}

func (a *codexAccount) tokens(withRefresh bool) map[string]any {
	out := map[string]any{
		"id_token": a.idToken(), "access_token": a.mint("sim-codex-at"),
		"token_type": "Bearer", "expires_in": 3600,
	}
	if withRefresh {
		out["refresh_token"] = a.mint("sim-codex-rt")
	}
	return out
}

func (s *Server) codexCall(w http.ResponseWriter, r *http.Request) (call, bool) {
	return readCall(w, r, ChannelCodex, r.URL.Path)
}

// handleCodexUserCode starts a device sign-in.
func (s *Server) handleCodexUserCode(w http.ResponseWriter, r *http.Request) {
	c, ok := s.codexCall(w, r)
	if !ok {
		return
	}
	a := s.codex
	a.mu.Lock()
	id := a.mint("deviceauth")
	code := fmt.Sprintf("SIMC-%04d", a.next%10000)
	a.devices[id] = &CodexDevice{DeviceAuthID: id, UserCode: code, Status: "pending", CreatedAt: s.now()}
	a.mu.Unlock()
	s.finish(w, c, jsonReply(http.StatusOK, map[string]any{
		"device_auth_id": id, "user_code": code, "interval": fmt.Sprint(codexIntervalSeconds),
	}))
}

// handleCodexDeviceToken is one poll of a device sign-in.
func (s *Server) handleCodexDeviceToken(w http.ResponseWriter, r *http.Request) {
	c, ok := s.codexCall(w, r)
	if !ok {
		return
	}
	var in struct {
		DeviceAuthID string `json:"device_auth_id"`
		UserCode     string `json:"user_code"`
	}
	_ = json.Unmarshal(c.body, &in)
	s.finish(w, c, s.codex.poll(in.DeviceAuthID, in.UserCode, s.now()))
}

// poll is a device's answer to one poll, consuming an approval into an authorization code.
func (a *codexAccount) poll(deviceAuthID, userCode string, now time.Time) reply {
	a.mu.Lock()
	defer a.mu.Unlock()
	d := a.devices[deviceAuthID]
	if d == nil || !strings.EqualFold(d.UserCode, userCode) {
		return jsonReply(http.StatusNotFound, map[string]string{"error": "deviceauth_not_found"})
	}
	a.age(d, now)
	switch d.Status {
	case "expired", "exchanged":
		return jsonReply(http.StatusBadRequest, map[string]string{"error": "expired_token"})
	case "denied":
		return jsonReply(http.StatusBadRequest, map[string]string{"error": "access_denied"})
	case "approved":
		code := a.mint("sim-codex-code")
		a.codes[code] = true
		d.Status = "exchanged"
		return jsonReply(http.StatusOK, map[string]string{
			"authorization_code": code, "code_challenge": "outboundsim", "code_verifier": "outboundsim-verifier",
		})
	}
	word := "authorization_pending"
	if a.state.SlowDown {
		word = "slow_down"
	}
	return jsonReply(http.StatusForbidden, map[string]string{"error": word})
}

// handleCodexOAuthToken answers the authorization-code and refresh grants.
func (s *Server) handleCodexOAuthToken(w http.ResponseWriter, r *http.Request) {
	c, ok := s.codexCall(w, r)
	if !ok {
		return
	}
	form, _ := url.ParseQuery(string(c.body))
	s.finish(w, c, s.codex.grant(form))
}

// grant answers one token-endpoint grant.
func (a *codexAccount) grant(form url.Values) reply {
	a.mu.Lock()
	defer a.mu.Unlock()
	invalid := func(why string) reply {
		return jsonReply(http.StatusBadRequest, map[string]string{"error": "invalid_grant", "error_description": why})
	}
	switch form.Get("grant_type") {
	case "authorization_code":
		code := form.Get("code")
		if !a.codes[code] {
			return invalid("unknown or used authorization code")
		}
		delete(a.codes, code)
		return jsonReply(http.StatusOK, a.tokens(true))
	case "refresh_token":
		if a.state.RefreshRevoked || !strings.HasPrefix(form.Get("refresh_token"), "sim-codex-rt-") {
			return invalid("refresh token revoked")
		}
		return jsonReply(http.StatusOK, a.tokens(true))
	}
	return jsonReply(http.StatusBadRequest, map[string]string{"error": "unsupported_grant_type"})
}

// codexDevicePage is the verification page: enter the code, approve or deny.
const codexDevicePage = `<!doctype html><html><head><meta charset="utf-8"><title>outboundsim: Codex sign-in</title></head>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto">
<h1>Sign in to Codex (outboundsim)</h1><p>%s</p>
<form method="post"><label>One-time code <input name="user_code" value="%s" autofocus></label>
<p><button name="action" value="approve">Approve</button> <button name="action" value="deny">Deny</button></p></form>
</body></html>`

func (s *Server) handleCodexDevicePage(w http.ResponseWriter, r *http.Request) {
	writeHTML(w, http.StatusOK, fmt.Sprintf(codexDevicePage, "Enter the code LangWatch shows you.", html.EscapeString(r.URL.Query().Get("user_code"))))
}

// handleCodexDeviceDecision is the page's form post: the browser approves or denies a code.
func (s *Server) handleCodexDeviceDecision(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		writeHTML(w, http.StatusBadRequest, fmt.Sprintf(codexDevicePage, "That form could not be read.", ""))
		return
	}
	code := r.PostForm.Get("user_code")
	status, message := s.decideCodexDevice(code, r.PostForm.Get("action") != "deny")
	writeHTML(w, status, fmt.Sprintf(codexDevicePage, html.EscapeString(message), html.EscapeString(code)))
}

// decideCodexDevice approves or denies a pending code, answering the status and a sentence.
func (s *Server) decideCodexDevice(userCode string, approve bool) (int, string) {
	a := s.codex
	a.mu.Lock()
	defer a.mu.Unlock()
	d := a.deviceByCode(userCode, s.now())
	switch {
	case d == nil:
		return http.StatusNotFound, "No sign-in is waiting for that code."
	case d.Status != "pending":
		return http.StatusConflict, "That code is " + d.Status + "."
	case approve:
		d.Status = "approved"
		return http.StatusOK, "Approved. You can return to LangWatch."
	default:
		d.Status = "denied"
		return http.StatusOK, "Denied. LangWatch will report the sign-in as refused."
	}
}

func writeHTML(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_, _ = w.Write([]byte(body))
}

// handleCodexResponses is one model turn: Responses SSE, or the plan's refusal.
func (s *Server) handleCodexResponses(w http.ResponseWriter, r *http.Request) {
	c, ok := s.codexCall(w, r)
	if !ok {
		return
	}
	token := bearerOf(r)
	a := s.codex
	a.mu.Lock()
	expired, limited, plan := a.expired[token], a.state.UsageLimit, a.state.Plan
	a.mu.Unlock()
	if !strings.HasPrefix(token, "sim-codex-at-") || expired {
		s.finish(w, c, jsonReply(http.StatusUnauthorized, map[string]any{"error": map[string]string{
			"message": "Your authentication token has expired. Please try signing in again.",
			"type":    "invalid_request_error", "code": "token_expired",
		}}))
		return
	}
	if limited {
		if plan == "" {
			plan = "plus"
		}
		out := jsonReply(http.StatusTooManyRequests, map[string]any{"error": map[string]any{
			"type": "usage_limit_reached", "message": "The usage limit has been reached",
			"plan_type": plan, "resets_in_seconds": 3600,
		}})
		out.header = map[string]string{"Retry-After": "3600"}
		s.finish(w, c, out)
		return
	}
	var in struct {
		Model string `json:"model"`
	}
	_ = json.Unmarshal(c.body, &in)
	s.finish(w, c, reply{status: http.StatusOK, contentType: "text/event-stream", body: codexStream(in.Model, s.now())})
}

// codexStream is a short text turn in the backend's SSE event order.
func codexStream(model string, now time.Time) string {
	const text = "Hello from outboundsim's Codex stand-in."
	id, item := fmt.Sprintf("resp_sim_%d", now.UnixNano()), "msg_sim_1"
	response := func(status string) map[string]any {
		return map[string]any{
			"id": id, "object": "response", "created_at": now.Unix(), "status": status, "model": model, "output": []any{},
			"usage": map[string]int{"input_tokens": 12, "output_tokens": 9, "total_tokens": 21},
		}
	}
	message := map[string]any{
		"id": item, "type": "message", "role": "assistant", "status": "completed",
		"content": []map[string]any{{"type": "output_text", "text": text, "annotations": []any{}}},
	}
	events := []map[string]any{
		{"type": "response.created", "response": response("in_progress")},
		{"type": "response.output_item.added", "output_index": 0, "item": map[string]any{"id": item, "type": "message", "role": "assistant", "status": "in_progress", "content": []any{}}},
		{"type": "response.content_part.added", "item_id": item, "output_index": 0, "content_index": 0, "part": map[string]any{"type": "output_text", "text": ""}},
	}
	for _, word := range strings.SplitAfter(text, " ") {
		events = append(events, map[string]any{"type": "response.output_text.delta", "item_id": item, "output_index": 0, "content_index": 0, "delta": word})
	}
	events = append(events,
		map[string]any{"type": "response.output_text.done", "item_id": item, "output_index": 0, "content_index": 0, "text": text},
		map[string]any{"type": "response.output_item.done", "output_index": 0, "item": message},
		map[string]any{"type": "response.completed", "response": response("completed")},
	)
	var b strings.Builder
	for seq, e := range events {
		e["sequence_number"] = seq
		raw, _ := json.Marshal(e)
		fmt.Fprintf(&b, "event: %s\ndata: %s\n\n", e["type"], raw)
	}
	return b.String()
}

// handleCodexState lists the control state and every device sign-in.
func (s *Server) handleCodexState(w http.ResponseWriter, _ *http.Request) {
	a := s.codex
	a.mu.Lock()
	defer a.mu.Unlock()
	devices := []CodexDevice{}
	for _, d := range a.devices {
		a.age(d, s.now())
		devices = append(devices, *d)
	}
	writeJSON(w, http.StatusOK, map[string]any{"state": a.state, "devices": devices, "expiredTokens": len(a.expired)})
}

// handleSetCodexState replaces the control state.
func (s *Server) handleSetCodexState(w http.ResponseWriter, r *http.Request) {
	var next CodexState
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&next); err != nil {
		writeError(w, http.StatusBadRequest, "reading the state: "+err.Error())
		return
	}
	if next.DeviceTTLSeconds < 0 {
		writeError(w, http.StatusBadRequest, "deviceTtlSeconds: must not be negative")
		return
	}
	s.codex.mu.Lock()
	s.codex.state = next
	s.codex.mu.Unlock()
	writeJSON(w, http.StatusOK, next)
}

// handleExpireCodexTokens ages out every access token issued so far: the next turn is a 401.
func (s *Server) handleExpireCodexTokens(w http.ResponseWriter, _ *http.Request) {
	a := s.codex
	a.mu.Lock()
	for n := 1; n <= a.next; n++ {
		a.expired[fmt.Sprintf("sim-codex-at-%d", n)] = true
	}
	count := len(a.expired)
	a.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]int{"expiredTokens": count})
}

// handleCodexDeviceAction approves, denies or expires a device sign-in by its user code.
func (s *Server) handleCodexDeviceAction(w http.ResponseWriter, r *http.Request) {
	code, action := r.PathValue("code"), r.PathValue("action")
	switch action {
	case "approve", "deny":
		status, message := s.decideCodexDevice(code, action == "approve")
		writeJSON(w, status, map[string]string{"message": message})
	case "expire":
		a := s.codex
		a.mu.Lock()
		defer a.mu.Unlock()
		d := a.deviceByCode(code, s.now())
		if d == nil {
			writeError(w, http.StatusNotFound, "no sign-in holds that code")
			return
		}
		d.Status = "expired"
		writeJSON(w, http.StatusOK, d)
	default:
		writeError(w, http.StatusNotFound, "action must be approve, deny or expire")
	}
}
