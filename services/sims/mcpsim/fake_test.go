package mcpsim

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeLangWatch is LangWatch's hosted MCP endpoint as tests need it: discovery,
// registration, the consent approval, the token endpoint and the Streamable
// HTTP transport at /mcp and /sse, with the faults a test asks for.
type fakeLangWatch struct {
	t   *testing.T
	srv *httptest.Server

	mu sync.Mutex
	// knobs
	apiKey      string
	cookie      string // the session cookie value approval accepts
	password    string // the sign-in password for admin@example.com
	sseBodies   bool   // answer POSTs as an SSE body instead of JSON
	lostStatus  int    // what an unknown session id answers: 404 (spec) or 401 (the old behavior)
	fail503     int    // the next N transport requests answer 503
	dropAfter   time.Duration
	refreshCalm bool // a repeat refresh with the same token inside 60s answers the same pair

	// state
	seq      int
	sessions map[string]string // session id -> owner
	clients  map[string]string // client_id -> redirect_uri
	codes    map[string]fakeCode
	access   map[string]string // access token -> owner
	refresh  map[string]*fakeRefresh
	requests []string       // "METHOD path status"
	asked    map[string]int // "METHOD path" -> times asked, on every route
	// credentialed counts requests on any route that carried a bearer, a cookie or a sign-in.
	credentialed int
}

type fakeCode struct{ clientID, redirect, challenge string }

type fakeRefresh struct {
	owner, clientID    string
	used               bool
	nextAccess, nextRT string
}

func newFakeLangWatch(t *testing.T) *fakeLangWatch {
	t.Helper()
	f := &fakeLangWatch{
		t: t, apiKey: "sk-lw-test-project-key-0000", cookie: "session-1", password: "pw", lostStatus: http.StatusNotFound,
		sessions: map[string]string{}, clients: map[string]string{}, codes: map[string]fakeCode{},
		access: map[string]string{}, refresh: map[string]*fakeRefresh{}, refreshCalm: true, asked: map[string]int{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /.well-known/oauth-protected-resource/{rest...}", f.protectedResource)
	mux.HandleFunc("GET /.well-known/oauth-protected-resource", f.protectedResource)
	mux.HandleFunc("GET /.well-known/oauth-authorization-server", f.authorizationServer)
	mux.HandleFunc("POST /oauth/register", f.register)
	mux.HandleFunc("POST /oauth/token", f.token)
	mux.HandleFunc("POST /api/mcp/authorize", f.approve)
	mux.HandleFunc("POST /api/auth/sign-in/email", f.signIn)
	for _, path := range []string{"/mcp", "/sse"} {
		mux.HandleFunc("POST "+path, f.post)
		mux.HandleFunc("GET "+path, f.get)
		mux.HandleFunc("DELETE "+path, f.delete)
	}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hasCredential := r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" || r.URL.Path == "/api/auth/sign-in/email"
		f.set(func(f *fakeLangWatch) {
			f.asked[r.Method+" "+r.URL.Path]++
			if hasCredential {
				f.credentialed++
			}
		})
		mux.ServeHTTP(w, r)
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeLangWatch) URL() string { return f.srv.URL }

// credentialsSeen is how many requests, on any route, carried a bearer, a cookie or a sign-in.
func (f *fakeLangWatch) credentialsSeen() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.credentialed
}

// timesAsked is how often route ("METHOD path") was asked.
func (f *fakeLangWatch) timesAsked(route string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.asked[route]
}

func (f *fakeLangWatch) set(change func(*fakeLangWatch)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	change(f)
}

// forgetSessions is a server restart: every session is gone.
func (f *fakeLangWatch) forgetSessions() {
	f.set(func(f *fakeLangWatch) { f.sessions = map[string]string{} })
}

// expireAccess makes every access token stale, as their lifetime running out does.
func (f *fakeLangWatch) expireAccess() {
	f.set(func(f *fakeLangWatch) { f.access = map[string]string{} })
}

func (f *fakeLangWatch) next(prefix string) string {
	f.seq++
	return fmt.Sprintf("%s-%04d-%s", prefix, f.seq, strings.Repeat("x", 12))
}

func jsonAnswer(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (f *fakeLangWatch) unauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("WWW-Authenticate", `Bearer resource_metadata="`+f.srv.URL+`/.well-known/oauth-protected-resource"`)
	jsonAnswer(w, http.StatusUnauthorized, map[string]string{"error": msg})
}

func (f *fakeLangWatch) protectedResource(w http.ResponseWriter, r *http.Request) {
	suffix := strings.TrimPrefix(r.URL.Path, "/.well-known/oauth-protected-resource")
	jsonAnswer(w, http.StatusOK, map[string]any{"resource": f.srv.URL + suffix, "authorization_servers": []string{f.srv.URL}, "scopes_supported": []string{"mcp:tools"}})
}

func (f *fakeLangWatch) authorizationServer(w http.ResponseWriter, _ *http.Request) {
	b := f.srv.URL
	jsonAnswer(w, http.StatusOK, map[string]any{
		"issuer": b, "authorization_endpoint": b + "/mcp/authorize", "token_endpoint": b + "/oauth/token",
		"registration_endpoint": b + "/oauth/register", "code_challenge_methods_supported": []string{"S256"},
	})
}

func (f *fakeLangWatch) register(w http.ResponseWriter, r *http.Request) {
	var doc struct {
		RedirectURIs []string `json:"redirect_uris"`
	}
	if json.NewDecoder(r.Body).Decode(&doc) != nil || len(doc.RedirectURIs) == 0 {
		jsonAnswer(w, http.StatusBadRequest, map[string]string{"error": "invalid_client_metadata"})
		return
	}
	f.mu.Lock()
	id := f.next("mcp_client")
	f.clients[id] = doc.RedirectURIs[0]
	f.mu.Unlock()
	jsonAnswer(w, http.StatusCreated, map[string]any{"client_id": id, "redirect_uris": doc.RedirectURIs})
}

func (f *fakeLangWatch) signIn(w http.ResponseWriter, r *http.Request) {
	var body struct{ Email, Password string }
	_ = json.NewDecoder(r.Body).Decode(&body)
	if body.Password != f.password {
		jsonAnswer(w, http.StatusUnauthorized, map[string]string{"message": "Invalid email or password"})
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "better-auth.session_token", Value: f.cookie, Path: "/", HttpOnly: true}) //nolint:gosec // G124: a plain-HTTP test server; a Secure cookie would never come back
	jsonAnswer(w, http.StatusOK, map[string]any{"user": map[string]string{"email": body.Email}})
}

func (f *fakeLangWatch) approve(w http.ResponseWriter, r *http.Request) {
	c, err := r.Cookie("better-auth.session_token")
	if err != nil || c.Value != f.cookie {
		jsonAnswer(w, http.StatusUnauthorized, map[string]string{"error": "Unauthorized"})
		return
	}
	var body map[string]string
	_ = json.NewDecoder(r.Body).Decode(&body)
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.clients[body["client_id"]] != body["redirect_uri"] || body["projectId"] == "" {
		jsonAnswer(w, http.StatusBadRequest, map[string]string{"error": "Unknown or unregistered client_id"})
		return
	}
	code := f.next("code")
	f.codes[code] = fakeCode{clientID: body["client_id"], redirect: body["redirect_uri"], challenge: body["code_challenge"]}
	jsonAnswer(w, http.StatusOK, map[string]string{"redirect": body["redirect_uri"] + "?code=" + code + "&state=" + url.QueryEscape(body["state"])})
}

func (f *fakeLangWatch) token(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
		jsonAnswer(w, http.StatusBadRequest, map[string]string{"error": "invalid_request"})
		return
	}
	_ = r.ParseForm()
	f.mu.Lock()
	defer f.mu.Unlock()
	switch r.Form.Get("grant_type") {
	case "authorization_code":
		code, ok := f.codes[r.Form.Get("code")]
		delete(f.codes, r.Form.Get("code"))
		sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
		if !ok || code.redirect != r.Form.Get("redirect_uri") || base64.RawURLEncoding.EncodeToString(sum[:]) != code.challenge {
			jsonAnswer(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
			return
		}
		owner := f.next("grant")
		jsonAnswer(w, http.StatusOK, f.mint(owner, code.clientID))
	case "refresh_token":
		rt := f.refresh[r.Form.Get("refresh_token")]
		switch {
		case rt == nil:
			jsonAnswer(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant"})
		case rt.used && f.refreshCalm:
			jsonAnswer(w, http.StatusOK, map[string]any{"access_token": rt.nextAccess, "token_type": "Bearer", "expires_in": 3600, "refresh_token": rt.nextRT})
		case rt.used:
			jsonAnswer(w, http.StatusBadRequest, map[string]string{"error": "invalid_grant", "error_description": "refresh token already used"})
		default:
			pair := f.mint(rt.owner, rt.clientID)
			rt.used, rt.nextAccess, rt.nextRT = true, pair["access_token"].(string), pair["refresh_token"].(string)
			jsonAnswer(w, http.StatusOK, pair)
		}
	default:
		jsonAnswer(w, http.StatusBadRequest, map[string]string{"error": "unsupported_grant_type"})
	}
}

// mint issues a token pair for owner; the caller holds f.mu.
func (f *fakeLangWatch) mint(owner, clientID string) map[string]any {
	access, rt := f.next("access"), f.next("refresh")
	f.access[access] = owner
	f.refresh[rt] = &fakeRefresh{owner: owner, clientID: clientID}
	return map[string]any{"access_token": access, "token_type": "Bearer", "expires_in": 3600, "refresh_token": rt}
}

// owner is who the bearer is: the project key, or the grant an access token belongs to.
func (f *fakeLangWatch) owner(r *http.Request) (string, bool) {
	token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !ok {
		return "", false
	}
	if token == f.apiKey {
		return "key", true
	}
	o, ok := f.access[token]
	return o, ok
}

func (f *fakeLangWatch) log(r *http.Request, status int) {
	f.requests = append(f.requests, fmt.Sprintf("%s %s %d", r.Method, r.URL.Path, status))
}

// gate is the checks every transport request passes: 503 faults, the bearer, the session.
func (f *fakeLangWatch) gate(w http.ResponseWriter, r *http.Request, needSession bool) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.fail503 > 0 {
		f.fail503--
		f.log(r, 503)
		w.Header().Set("Retry-After", "0")
		jsonAnswer(w, http.StatusServiceUnavailable, map[string]string{"error": "temporarily unavailable"})
		return "", false
	}
	owner, ok := f.owner(r)
	if !ok {
		f.log(r, 401)
		f.unauthorized(w, "Invalid API key")
		return "", false
	}
	if !needSession {
		return owner, true
	}
	id := r.Header.Get("mcp-session-id")
	held, ok := f.sessions[id]
	switch {
	case !ok && f.lostStatus == http.StatusUnauthorized:
		f.log(r, 401)
		f.unauthorized(w, "Session expired or not found")
		return "", false
	case !ok:
		f.log(r, 404)
		jsonAnswer(w, http.StatusNotFound, map[string]any{"jsonrpc": "2.0", "error": map[string]any{"code": -32001, "message": "Session not found"}})
		return "", false
	case held != owner:
		f.log(r, 401)
		f.unauthorized(w, "Bearer token does not match session")
		return "", false
	}
	f.log(r, 200)
	return id, true
}

func (f *fakeLangWatch) post(w http.ResponseWriter, r *http.Request) {
	if !strings.Contains(r.Header.Get("Accept"), "text/event-stream") || !strings.Contains(r.Header.Get("Accept"), "application/json") {
		jsonAnswer(w, http.StatusNotAcceptable, map[string]string{"error": "Not Acceptable"})
		return
	}
	body, _ := io.ReadAll(r.Body)
	var msg rpcMessage
	if json.Unmarshal(body, &msg) != nil {
		jsonAnswer(w, http.StatusBadRequest, map[string]string{"error": "parse error"})
		return
	}
	if msg.Method == "initialize" {
		owner, ok := f.gate(w, r, false)
		if !ok {
			return
		}
		f.mu.Lock()
		id := f.next("session")
		f.sessions[id] = owner
		f.mu.Unlock()
		w.Header().Set("mcp-session-id", id)
		f.answer(w, msg.ID, map[string]any{"protocolVersion": "2025-06-18", "capabilities": map[string]any{"tools": map[string]any{}}, "serverInfo": map[string]any{"name": "fake"}})
		return
	}
	if _, ok := f.gate(w, r, true); !ok {
		return
	}
	if r.Header.Get("MCP-Protocol-Version") == "" {
		f.t.Errorf("%s came without MCP-Protocol-Version", msg.Method)
	}
	switch msg.Method {
	case "notifications/initialized":
		w.WriteHeader(http.StatusAccepted)
	case "tools/list":
		f.answer(w, msg.ID, map[string]any{"tools": []map[string]any{{"name": "fetch_langwatch_docs"}, {"name": "search_traces"}}})
	case "tools/call":
		f.answer(w, msg.ID, map[string]any{"content": []map[string]any{{"type": "text", "text": "# LangWatch docs"}}})
	default:
		f.answer(w, msg.ID, nil)
	}
}

func (f *fakeLangWatch) answer(w http.ResponseWriter, id json.RawMessage, result any) {
	reply, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	f.mu.Lock()
	sse := f.sseBodies
	f.mu.Unlock()
	if !sse {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(reply)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	_, _ = fmt.Fprintf(w, ": warming up\n\nevent: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\"}\n\nevent: message\ndata: %s\n\n", reply)
}

func (f *fakeLangWatch) get(w http.ResponseWriter, r *http.Request) {
	if _, ok := f.gate(w, r, true); !ok {
		return
	}
	f.mu.Lock()
	drop := f.dropAfter
	f.mu.Unlock()
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(http.StatusOK)
	_, _ = io.WriteString(w, ": open\n\n")
	w.(http.Flusher).Flush()
	if drop > 0 {
		select {
		case <-time.After(drop):
		case <-r.Context().Done():
		}
		return
	}
	<-r.Context().Done()
}

func (f *fakeLangWatch) delete(w http.ResponseWriter, r *http.Request) {
	id, ok := f.gate(w, r, true)
	if !ok {
		return
	}
	f.mu.Lock()
	delete(f.sessions, id)
	f.mu.Unlock()
	jsonAnswer(w, http.StatusOK, map[string]string{"status": "session closed"})
}
