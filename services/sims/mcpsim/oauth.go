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
	"strings"
	"time"
)

const (
	contentType     = "Content-Type"
	applicationJSON = "application/json"
)

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
	projectID, err := s.approvedProjectID(ctx, req)
	if err != nil {
		return err
	}
	a := &oauthAttempt{s: s, rn: rn, req: req, persona: personas[req.Client], projectID: projectID, pk: newPKCE()}
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
		return "", errors.New("auto approval needs a project id (projectId, MCPSIM_PROJECT_ID or MCPSIM_PROJECT_SLUG)")
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

// approvedProjectID is the project an approval grants: the request's, the configured id, or the
// configured slug looked up through GET /api/projects (seeded ids are random, ADR-180).
func (s *Server) approvedProjectID(ctx context.Context, req ConnectRequest) (string, error) {
	if id := firstOf(req.ProjectID, s.cfg.ProjectID); id != "" || s.cfg.ProjectSlug == "" {
		return id, nil
	}
	if s.cfg.AccessToken == "" || s.cfg.Endpoint == "" {
		return "", fmt.Errorf("project %q has no id and no access token to look it up", s.cfg.ProjectSlug)
	}
	return s.projectIDBySlug(ctx)
}

// projectIDBySlug looks the configured project slug up through GET /api/projects.
func (s *Server) projectIDBySlug(ctx context.Context) (string, error) {
	call, err := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.Endpoint+"/api/projects?limit=1000", nil)
	if err != nil {
		return "", err
	}
	call.Header.Set("Authorization", "Bearer "+s.cfg.AccessToken)
	res, err := s.http.Do(call)
	if err != nil {
		return "", fmt.Errorf("looking up project %q: %w", s.cfg.ProjectSlug, err)
	}
	defer res.Body.Close()
	var page struct {
		Data []struct{ ID, Slug string }
	}
	if res.StatusCode != http.StatusOK {
		return "", fmt.Errorf("looking up project %q: GET /api/projects answered %d", s.cfg.ProjectSlug, res.StatusCode)
	}
	if err := json.NewDecoder(res.Body).Decode(&page); err != nil {
		return "", fmt.Errorf("looking up project %q: %w", s.cfg.ProjectSlug, err)
	}
	for _, p := range page.Data {
		if p.Slug == s.cfg.ProjectSlug {
			return p.ID, nil
		}
	}
	return "", fmt.Errorf("no project %q in GET /api/projects", s.cfg.ProjectSlug)
}
