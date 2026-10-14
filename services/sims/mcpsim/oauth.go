package mcpsim

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

const (
	contentType     = "Content-Type"
	applicationJSON = "application/json"
)

// grant is the OAuth grant the sim holds after a connect: what a real MCP
// client keeps in its credential store. Tokens never leave the sim.
type grant struct {
	endpoint, clientID, projectID, tokenURL string
	access, refresh                         string
	obtainedAt, expiresAt, lastRefresh      time.Time
	refreshes                               int
}

// grantStore guards the one grant. refreshMu serializes refreshes, so many
// clients that all meet a 401 refresh once, as a real client's token store does.
type grantStore struct {
	mu        sync.Mutex
	refreshMu sync.Mutex
	g         *grant
}

func (gs *grantStore) current() *grant {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	if gs.g == nil {
		return nil
	}
	g := *gs.g
	return &g
}

func (gs *grantStore) accessToken() string {
	if g := gs.current(); g != nil {
		return g.access
	}
	return ""
}

func (gs *grantStore) set(g *grant) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	gs.g = g
}

func (gs *grantStore) status() GrantStatus {
	g := gs.current()
	if g == nil {
		return GrantStatus{}
	}
	return GrantStatus{
		Connected: true, Endpoint: g.endpoint, ClientID: g.clientID, ProjectID: g.projectID,
		AccessHint: hint(g.access), RefreshHint: hint(g.refresh), Refreshes: g.refreshes,
		ObtainedAt: timePtr(g.obtainedAt), ExpiresAt: timePtr(g.expiresAt), LastRefreshAt: timePtr(g.lastRefresh),
	}
}

func timePtr(t time.Time) *time.Time {
	if t.IsZero() {
		return nil
	}
	return &t
}

// adopt keeps a refreshed pair, if the grant still holds the refresh token it was redeemed from.
func (gs *grantStore) adopt(from string, ans tokenAnswer) {
	gs.mu.Lock()
	defer gs.mu.Unlock()
	if gs.g == nil || gs.g.refresh != from {
		return
	}
	gs.g.access, gs.g.lastRefresh = ans.AccessToken, time.Now().UTC()
	if ans.RefreshToken != "" {
		gs.g.refresh = ans.RefreshToken
	}
	if ans.ExpiresIn > 0 {
		gs.g.expiresAt = time.Now().UTC().Add(time.Duration(ans.ExpiresIn) * time.Second)
	}
	gs.g.refreshes++
}

// tokenAnswer is a token endpoint's answer.
type tokenAnswer struct {
	AccessToken      string `json:"access_token"`
	TokenType        string `json:"token_type"`
	ExpiresIn        int    `json:"expires_in"`
	RefreshToken     string `json:"refresh_token"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

// refreshAfter refreshes the grant after a 401, unless another client already
// did while this one waited for refreshMu.
func (s *Server) refreshAfter(ctx context.Context, rn *run) error {
	seen := s.grants.accessToken()
	s.grants.refreshMu.Lock()
	defer s.grants.refreshMu.Unlock()
	if now := s.grants.accessToken(); now != "" && now != seen {
		return nil
	}
	return s.refreshNow(ctx, rn)
}

// refreshNow redeems the grant's refresh token once and keeps the new pair.
func (s *Server) refreshNow(ctx context.Context, rn *run) error {
	g := s.grants.current()
	if g == nil {
		return errors.New("no OAuth grant; run the OAuth connect first")
	}
	ans, err := s.redeemRefresh(ctx, rn, refreshCall{g: g, kind: "refresh"})
	if err != nil {
		return err
	}
	s.grants.adopt(g.refresh, ans)
	return nil
}

// refreshCall is one refresh_token redemption: which grant, and what its step is called.
type refreshCall struct {
	g    *grant
	kind string
}

func (s *Server) redeemRefresh(ctx context.Context, rn *run, rc refreshCall) (tokenAnswer, error) {
	form := url.Values{"grant_type": {"refresh_token"}, "refresh_token": {rc.g.refresh}, "client_id": {rc.g.clientID}}
	return s.postToken(ctx, rn, tokenCall{url: rc.g.tokenURL, form: form, kind: rc.kind})
}

// tokenCall is one form-encoded POST to the token endpoint.
type tokenCall struct {
	url  string
	form url.Values
	kind string
}

func (s *Server) postToken(ctx context.Context, rn *run, tc tokenCall) (tokenAnswer, error) {
	var ans tokenAnswer
	x := s.do(ctx, httpCall{method: http.MethodPost, url: tc.url, body: strings.NewReader(tc.form.Encode()), headers: map[string]string{
		contentType: "application/x-www-form-urlencoded", "Accept": applicationJSON,
	}})
	if x.err == nil {
		_ = json.Unmarshal(x.body, &ans)
	}
	ok := x.err == nil && x.status == http.StatusOK && ans.AccessToken != ""
	detail := strings.TrimSpace(ans.Error + " " + ans.ErrorDescription)
	if ok {
		detail = "access " + hint(ans.AccessToken) + ", refresh " + hint(ans.RefreshToken)
	}
	rn.httpStep(Step{Kind: tc.kind, Flow: FlowOAuth, Method: http.MethodPost, URL: tc.url, OK: ok, Detail: detail}, x)
	if !ok {
		return ans, fmt.Errorf("the token endpoint answered %d %s", x.status, firstOf(detail, errText(x)))
	}
	return ans, nil
}

// httpCall is one plain HTTP request for the OAuth steps.
type httpCall struct {
	method, url string
	body        io.Reader
	headers     map[string]string
}

func (s *Server) do(ctx context.Context, hc httpCall) exchange {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, hc.method, hc.url, hc.body)
	if err != nil {
		return exchange{err: err}
	}
	for k, v := range hc.headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("User-Agent", "mcpsim")
	began := time.Now()
	resp, err := s.http.Do(req)
	if err != nil {
		return exchange{err: err, took: time.Since(began)}
	}
	defer func() { _ = resp.Body.Close() }()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, answerBodyLimit))
	return exchange{status: resp.StatusCode, header: resp.Header, body: b, took: time.Since(began)}
}

func (s *Server) getJSON(ctx context.Context, target string) exchange {
	return s.do(ctx, httpCall{method: http.MethodGet, url: target, headers: map[string]string{"Accept": applicationJSON}})
}

// oauthAttempt is one OAuth connect: what discovery, registration and approval found so far.
type oauthAttempt struct {
	s         *Server
	rn        *run
	req       ConnectRequest
	persona   persona
	md        metadata
	clientID  string
	projectID string
	pk        pkce
}

// metadata is what discovery found.
type metadata struct {
	resource, authorizationEndpoint, tokenEndpoint, registrationEndpoint string
}

var resourceMetadataParam = regexp.MustCompile(`resource_metadata="([^"]+)"`)

// discover finds the authorization server the way an MCP client does: an
// unauthenticated initialize for the 401 challenge, the protected-resource
// document (path-suffixed first, RFC 9728), then the authorization server's (RFC 8414).
func (a *oauthAttempt) discover(ctx context.Context) error {
	issuer, err := a.protectedResource(ctx, a.challenge(ctx))
	if err != nil {
		return err
	}
	return a.authorizationServer(ctx, issuer)
}

// challenge is the WWW-Authenticate an unauthenticated initialize answers.
func (a *oauthAttempt) challenge(ctx context.Context) string {
	endpoint := a.req.Endpoint
	initBody := `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"mcpsim","version":"1"}}}`
	x := a.s.do(ctx, httpCall{method: http.MethodPost, url: endpoint + "/mcp", body: strings.NewReader(initBody), headers: map[string]string{
		contentType: applicationJSON, "Accept": "application/json, text/event-stream",
	}})
	challenge := ""
	if x.header != nil {
		challenge = x.header.Get("WWW-Authenticate")
	}
	ok := x.status == http.StatusUnauthorized && strings.Contains(challenge, "resource_metadata=")
	a.rn.httpStep(Step{Kind: "challenge", Flow: FlowOAuth, Transport: "/mcp", Method: http.MethodPost, URL: endpoint + "/mcp", OK: ok,
		Detail: "unauthenticated initialize; WWW-Authenticate: " + firstOf(challenge, "(none)")}, x)
	a.rn.check("unauthenticated initialize answers 401 with a resource_metadata challenge", ok, fmt.Sprintf("%d %s", x.status, challenge))
	return challenge
}

// protectedResource reads the protected-resource document and answers its authorization server.
func (a *oauthAttempt) protectedResource(ctx context.Context, challenge string) (string, error) {
	var prm struct {
		Resource             string   `json:"resource"`
		AuthorizationServers []string `json:"authorization_servers"`
	}
	candidates := []string{a.req.Endpoint + "/.well-known/oauth-protected-resource/mcp"}
	if m := resourceMetadataParam.FindStringSubmatch(challenge); m != nil {
		candidates = append(candidates, m[1])
	}
	found := false
	for _, u := range candidates {
		x := a.s.getJSON(ctx, u)
		found = x.status == http.StatusOK && json.Unmarshal(x.body, &prm) == nil && len(prm.AuthorizationServers) > 0
		a.rn.httpStep(Step{Kind: "discover", Flow: FlowOAuth, Method: http.MethodGet, URL: u, OK: found, Detail: "protected-resource metadata"}, x)
		if found {
			break
		}
	}
	a.rn.check("protected-resource metadata names an authorization server", found, strings.Join(prm.AuthorizationServers, ", "))
	if !found {
		return "", errors.New("no protected-resource metadata with an authorization server")
	}
	a.md.resource = prm.Resource
	return strings.TrimRight(prm.AuthorizationServers[0], "/"), nil
}

func (a *oauthAttempt) authorizationServer(ctx context.Context, issuer string) error {
	var asm struct {
		AuthorizationEndpoint string   `json:"authorization_endpoint"`
		TokenEndpoint         string   `json:"token_endpoint"`
		RegistrationEndpoint  string   `json:"registration_endpoint"`
		Methods               []string `json:"code_challenge_methods_supported"`
	}
	asURL := wellKnown(issuer, "oauth-authorization-server")
	x := a.s.getJSON(ctx, asURL)
	good := x.status == http.StatusOK && json.Unmarshal(x.body, &asm) == nil &&
		asm.TokenEndpoint != "" && asm.AuthorizationEndpoint != "" && asm.RegistrationEndpoint != ""
	a.rn.httpStep(Step{Kind: "discover", Flow: FlowOAuth, Method: http.MethodGet, URL: asURL, OK: good, Detail: "authorization-server metadata"}, x)
	a.rn.check("authorization-server metadata has the endpoints and PKCE S256", good && contains(asm.Methods, "S256"),
		fmt.Sprintf("authorize %s, token %s, register %s, methods %v", asm.AuthorizationEndpoint, asm.TokenEndpoint, asm.RegistrationEndpoint, asm.Methods))
	if !good {
		return errors.New("the authorization-server metadata is incomplete")
	}
	a.md.authorizationEndpoint, a.md.tokenEndpoint, a.md.registrationEndpoint = asm.AuthorizationEndpoint, asm.TokenEndpoint, asm.RegistrationEndpoint
	return nil
}

// wellKnown is RFC 8414's metadata URL: the well-known segment goes between the host and any issuer path.
func wellKnown(issuer, name string) string {
	u, err := url.Parse(issuer)
	if err != nil {
		return issuer + "/.well-known/" + name
	}
	u.Path = "/.well-known/" + name + strings.TrimRight(u.Path, "/")
	return u.String()
}

// register is dynamic client registration (RFC 7591) with the sim's callback.
func (a *oauthAttempt) register(ctx context.Context) error {
	doc, _ := json.Marshal(map[string]any{
		"client_name": "mcpsim (" + a.persona.name + ")", "redirect_uris": []string{a.s.callbackURL()},
		"grant_types": []string{"authorization_code", "refresh_token"}, "response_types": []string{"code"},
		"token_endpoint_auth_method": "none",
	})
	x := a.s.do(ctx, httpCall{method: http.MethodPost, url: a.md.registrationEndpoint, body: bytes.NewReader(doc), headers: map[string]string{contentType: applicationJSON}})
	var ans struct {
		ClientID string `json:"client_id"`
	}
	ok := (x.status == http.StatusCreated || x.status == http.StatusOK) && json.Unmarshal(x.body, &ans) == nil && ans.ClientID != ""
	a.rn.httpStep(Step{Kind: "register", Flow: FlowOAuth, Method: http.MethodPost, URL: a.md.registrationEndpoint, OK: ok, Detail: "client " + ans.ClientID}, x)
	a.rn.check("dynamic client registration answers a client_id", ok, fmt.Sprintf("%d %s", x.status, ans.ClientID))
	if !ok {
		return fmt.Errorf("registration answered %d", x.status)
	}
	a.clientID = ans.ClientID
	return nil
}

// pkce is one authorization request's verifier, challenge and state.
type pkce struct{ verifier, challenge, state string }

func newPKCE() pkce {
	v := randomToken(48)
	sum := sha256.Sum256([]byte(v))
	return pkce{verifier: v, challenge: base64.RawURLEncoding.EncodeToString(sum[:]), state: randomToken(16)}
}

func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func (a *oauthAttempt) authorizeURL() string {
	q := url.Values{
		"response_type": {"code"}, "client_id": {a.clientID}, "redirect_uri": {a.s.callbackURL()},
		"code_challenge": {a.pk.challenge}, "code_challenge_method": {"S256"}, "state": {a.pk.state}, "scope": {"mcp:tools"},
	}
	if a.md.resource != "" {
		q.Set("resource", a.md.resource)
	}
	sep := "?"
	if strings.Contains(a.md.authorizationEndpoint, "?") {
		sep = "&"
	}
	return a.md.authorizationEndpoint + sep + q.Encode()
}

// approve does what the consent page does for a signed-in person: POST
// /api/mcp/authorize with the browser session, and read the code off the redirect.
func (a *oauthAttempt) approve(ctx context.Context, cookie string) (string, error) {
	body, _ := json.Marshal(map[string]string{
		"projectId": a.projectID, "redirect_uri": a.s.callbackURL(), "client_id": a.clientID,
		"code_challenge": a.pk.challenge, "code_challenge_method": "S256", "state": a.pk.state,
	})
	target := a.req.Endpoint + "/api/mcp/authorize"
	x := a.s.do(ctx, httpCall{method: http.MethodPost, url: target, body: bytes.NewReader(body), headers: map[string]string{
		contentType: applicationJSON, "Cookie": cookie, "Origin": originOf(a.req.Endpoint),
	}})
	code, problem := a.readApproval(x)
	ok := x.err == nil && problem == ""
	a.rn.httpStep(Step{Kind: "approve", Flow: FlowOAuth, Method: http.MethodPost, URL: target, OK: ok, Detail: firstOf(problem, "approved for project "+a.projectID)}, x)
	a.rn.check("the signed-in approval answers a redirect with the code and state", ok, firstOf(problem, errText(x)))
	if !ok {
		return "", fmt.Errorf("approval answered %d: %s", x.status, firstOf(problem, errText(x)))
	}
	return code, nil
}

// readApproval is the code an approval answered, or what is wrong with the answer.
func (a *oauthAttempt) readApproval(x exchange) (string, string) {
	var ans struct {
		Redirect         string `json:"redirect"`
		Error            string `json:"error"`
		ErrorDescription string `json:"error_description"`
	}
	_ = json.Unmarshal(x.body, &ans)
	if x.status != http.StatusOK {
		problem := strings.TrimSpace(ans.Error + " " + ans.ErrorDescription)
		if x.status == http.StatusUnauthorized {
			problem = "the session cookie is not signed in (401); " + problem
		}
		return "", firstOf(problem, fmt.Sprintf("answered %d", x.status))
	}
	u, err := url.Parse(ans.Redirect)
	if err != nil || u.Query().Get("code") == "" {
		return "", "the redirect carries no code"
	}
	if u.Query().Get("state") != a.pk.state {
		return "", "the redirect's state does not match the request's"
	}
	return u.Query().Get("code"), ""
}

// signIn gets a browser session the way haven's browser login does: the app's
// email sign-in, on a local stack only, so a dev password never travels further.
func (a *oauthAttempt) signIn(ctx context.Context) (string, error) {
	cfg := a.s.cfg
	u, err := url.Parse(a.req.Endpoint)
	if err != nil {
		return "", err
	}
	if host := u.Hostname(); host != "localhost" && host != "127.0.0.1" && !strings.HasSuffix(host, ".localhost") {
		return "", fmt.Errorf("refusing to sign in to %s: the sim only signs in to a local stack", host)
	}
	if a.req.Endpoint != cfg.Endpoint {
		return "", fmt.Errorf("refusing to sign in to %s: the configured login only goes to %s", a.req.Endpoint, cfg.Endpoint)
	}
	body, _ := json.Marshal(map[string]string{"email": cfg.SignInEmail, "password": cfg.SignInPassword})
	target := originOf(a.req.Endpoint) + "/api/auth/sign-in/email"
	x := a.s.do(ctx, httpCall{method: http.MethodPost, url: target, body: bytes.NewReader(body), headers: map[string]string{
		contentType: applicationJSON, "Origin": originOf(a.req.Endpoint),
	}})
	var parts []string
	if x.header != nil {
		for _, c := range (&http.Response{Header: x.header}).Cookies() {
			parts = append(parts, c.Name+"="+c.Value)
		}
	}
	ok := x.status == http.StatusOK && len(parts) > 0
	a.rn.httpStep(Step{Kind: "sign-in", Flow: FlowOAuth, Method: http.MethodPost, URL: target, OK: ok, Detail: "as " + cfg.SignInEmail}, x)
	if !ok {
		return "", fmt.Errorf("sign-in as %s answered %d", cfg.SignInEmail, x.status)
	}
	return strings.Join(parts, "; "), nil
}

func originOf(endpoint string) string {
	u, err := url.Parse(endpoint)
	if err != nil {
		return endpoint
	}
	return u.Scheme + "://" + u.Host
}

// exchangeCode redeems the authorization code with the PKCE verifier and keeps the grant.
func (a *oauthAttempt) exchangeCode(ctx context.Context, code string) error {
	form := url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "code_verifier": {a.pk.verifier},
		"redirect_uri": {a.s.callbackURL()}, "client_id": {a.clientID},
	}
	ans, err := a.s.postToken(ctx, a.rn, tokenCall{url: a.md.tokenEndpoint, form: form, kind: "token"})
	a.rn.check("the code exchange answers an access and a refresh token", err == nil && ans.RefreshToken != "", firstOf(errString(err), "access "+hint(ans.AccessToken)))
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	g := &grant{endpoint: a.req.Endpoint, clientID: a.clientID, projectID: a.projectID, tokenURL: a.md.tokenEndpoint,
		access: ans.AccessToken, refresh: ans.RefreshToken, obtainedAt: now}
	if ans.ExpiresIn > 0 {
		g.expiresAt = now.Add(time.Duration(ans.ExpiresIn) * time.Second)
	}
	a.s.grants.set(g)
	return nil
}

// callbackResult is what the browser brought back to /callback.
type callbackResult struct{ code, state, err string }

// handleCallback is the redirect_uri: it hands the code to the connect waiting on its state.
func (s *Server) handleCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	res := callbackResult{code: q.Get("code"), state: q.Get("state"), err: strings.TrimSpace(q.Get("error") + " " + q.Get("error_description"))}
	s.mu.Lock()
	ch, ok := s.pending[res.state]
	delete(s.pending, res.state)
	s.mu.Unlock()
	w.Header().Set(contentType, "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(w, "<!doctype html><title>mcpsim</title><p>mcpsim is not waiting for this approval (unknown or used state).</p>")
		return
	}
	ch <- res
	msg := "mcpsim received the approval and is exchanging the code. You can close this tab."
	if res.err != "" || res.code == "" {
		msg = "mcpsim received a refusal. The run in the console says why."
	}
	_, _ = io.WriteString(w, "<!doctype html><title>mcpsim</title><p>"+msg+"</p>")
}

// connectOAuth is the oauth-connect run.
func (s *Server) connectOAuth(ctx context.Context, rn *run, req ConnectRequest) error {
	a := &oauthAttempt{s: s, rn: rn, req: req, persona: personas[req.Client], projectID: firstOf(req.ProjectID, s.cfg.ProjectID), pk: newPKCE()}
	if err := a.discover(ctx); err != nil {
		return err
	}
	if err := a.register(ctx); err != nil {
		return err
	}
	code, err := a.obtainCode(ctx)
	if err != nil {
		return err
	}
	if err := a.exchangeCode(ctx, code); err != nil {
		return err
	}
	a.verify(ctx)
	return nil
}

// obtainCode is the approval step: by the sim with a session (auto), or by a person in the browser.
func (a *oauthAttempt) obtainCode(ctx context.Context) (string, error) {
	if a.req.Mode != modeAuto {
		return a.awaitBrowser(ctx)
	}
	if a.projectID == "" {
		return "", errors.New("auto approval needs a project id (projectId, or MCPSIM_PROJECT_ID)")
	}
	// The configured session only ever goes to the configured endpoint.
	cookie := a.req.Cookie
	if cookie == "" && a.req.Endpoint == a.s.cfg.Endpoint {
		cookie = a.s.cfg.Cookie
	}
	if cookie == "" {
		var err error
		if cookie, err = a.signIn(ctx); err != nil {
			return "", err
		}
	}
	return a.approve(ctx, cookie)
}

// verify uses the new token the way the client's first use of it would.
func (a *oauthAttempt) verify(ctx context.Context) {
	c := a.s.newClient(a.rn, &plan{RunRequest: RunRequest{Endpoint: a.req.Endpoint, Flow: FlowOAuth}, persona: a.persona}, "/mcp")
	err := c.initialize(ctx)
	if err == nil {
		_, err = c.call(ctx, kindToolsList, map[string]any{})
	}
	a.rn.check("the new access token opens a session and lists tools", err == nil, errString(err))
	if err == nil {
		_ = c.end(ctx)
	}
}

// awaitBrowser waits until a person approves at the authorize URL and the browser lands on /callback.
func (a *oauthAttempt) awaitBrowser(ctx context.Context) (string, error) {
	s, rn := a.s, a.rn
	ch := make(chan callbackResult, 1)
	s.mu.Lock()
	s.pending[a.pk.state] = ch
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.pending, a.pk.state)
		s.mu.Unlock()
	}()
	authURL := a.authorizeURL()
	rn.update(func(st *RunStatus) { st.State, st.AuthorizeURL = StateWaiting, authURL })
	rn.step(Step{Kind: "authorize", Flow: FlowOAuth, URL: authURL, OK: true,
		Detail: "open this URL, sign in and approve; the browser returns to " + s.callbackURL()})
	began := time.Now()
	timeout := time.NewTimer(s.cfg.ApprovalTimeout)
	defer timeout.Stop()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case <-timeout.C:
		rn.check("a person approved in the browser", false, "no approval within "+s.cfg.ApprovalTimeout.String())
		return "", errors.New("timed out waiting for the browser approval")
	case res := <-ch:
		return a.callbackCode(res, time.Since(began))
	}
}

func (a *oauthAttempt) callbackCode(res callbackResult, waited time.Duration) (string, error) {
	a.rn.update(func(st *RunStatus) { st.State = StateRunning })
	ok := res.err == "" && res.code != ""
	a.rn.step(Step{Kind: "callback", Flow: FlowOAuth, URL: a.s.callbackURL(), OK: ok, LatencyMs: ms(waited),
		Detail: firstOf(res.err, "the browser returned the code")})
	a.rn.check("a person approved in the browser and the callback carried the code", ok, res.err)
	if !ok {
		return "", fmt.Errorf("the approval came back refused: %s", firstOf(res.err, "no code"))
	}
	return res.code, nil
}
