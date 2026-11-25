package mcpsim

import (
	"cmp"
	"context"
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
	modeAuto        = "auto"
	modeInteractive = "interactive"
)

func (s *Server) handleConnect(w http.ResponseWriter, r *http.Request) {
	var req ConnectRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "the connect request is not JSON: "+err.Error())
		return
	}
	if err := s.checkConnect(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rn, err := s.start(RunStatus{Scenario: ScenarioOAuthConnect, Flow: FlowOAuth, Client: req.Client, Endpoint: req.Endpoint, Transports: []string{"/mcp"}},
		func(ctx context.Context, rn *run) error { return s.connectOAuth(ctx, rn, req) })
	if err != nil {
		writeError(w, http.StatusConflict, err.Error())
		return
	}
	if !req.Wait && req.Mode == modeInteractive {
		rn.awaitAuthorizeURL()
	}
	reply{w, r}.answer(rn, req.Wait)
}

// awaitAuthorizeURL waits (up to ten seconds) until an interactive connect has its authorize URL, so the caller can show it at once.
func (r *run) awaitAuthorizeURL() {
	for i := 0; i < 200 && r.snapshot(false).AuthorizeURL == "" && r.active(); i++ {
		time.Sleep(50 * time.Millisecond)
	}
}

// checkConnect fills a connect request's defaults and refuses one the sim cannot carry out.
func (s *Server) checkConnect(req *ConnectRequest) error {
	req.Endpoint = strings.TrimRight(cmp.Or(req.Endpoint, s.cfg.Endpoint), "/")
	req.Client = cmp.Or(req.Client, "claude-code")
	if err := checkEndpoint(req.Endpoint); err != nil {
		return err
	}
	if _, ok := personas[req.Client]; !ok {
		return fmt.Errorf("client %q is not claude-code, claude-desktop or cursor", req.Client)
	}
	if s.cfg.PublicURL == "" {
		return errors.New("the sim has no public URL for the OAuth callback (MCPSIM_PUBLIC_URL)")
	}
	return s.checkMode(req)
}

// checkMode defaults the approval mode to auto when the sim has a session to approve with.
func (s *Server) checkMode(req *ConnectRequest) error {
	hasSession := req.Cookie != "" || s.cfg.Cookie != "" || (s.cfg.SignInEmail != "" && s.cfg.SignInPassword != "")
	if req.Mode == "" {
		req.Mode = modeInteractive
		if hasSession {
			req.Mode = modeAuto
		}
	}
	switch {
	case req.Mode != modeAuto && req.Mode != modeInteractive:
		return fmt.Errorf("mode %q is neither auto nor interactive", req.Mode)
	case req.Mode == modeAuto && !hasSession:
		return errors.New("auto approval needs a LangWatch session: pass cookie, or set MCPSIM_COOKIE or MCPSIM_SIGNIN_EMAIL and MCPSIM_SIGNIN_PASSWORD")
	}
	return nil
}

func checkEndpoint(endpoint string) error {
	if u, err := url.Parse(endpoint); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return fmt.Errorf("endpoint %q is not an http(s) URL; pass endpoint or set MCPSIM_ENDPOINT", endpoint)
	}
	return nil
}
