package mcpsim

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
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
