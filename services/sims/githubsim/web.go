package githubsim

import (
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type user struct {
	Login string `json:"login"`
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

// handleAuthorize is OAuth's authorize step: it signs `login` (default octocat) straight in and redirects back with a code.
func (s *Server) handleAuthorize(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	redirect := q.Get("redirect_uri")
	if redirect == "" {
		writeMessage(w, http.StatusUnprocessableEntity, "redirect_uri is required")
		return
	}
	login := firstNonEmpty(q.Get("login"), "octocat")
	s.mu.Lock()
	if _, ok := s.users[login]; !ok {
		s.mu.Unlock()
		writeMessage(w, http.StatusNotFound, "No simulated GitHub user "+login)
		return
	}
	code := randomHex(10)
	s.codes[code] = login
	s.mu.Unlock()
	target, err := url.Parse(redirect)
	if err != nil {
		writeMessage(w, http.StatusUnprocessableEntity, "redirect_uri is not a URL")
		return
	}
	query := target.Query()
	query.Set("code", code)
	if state := q.Get("state"); state != "" {
		query.Set("state", state)
	}
	target.RawQuery = query.Encode()
	http.Redirect(w, r, target.String(), http.StatusFound) //nolint:gosec // G710: OAuth sends the browser back to redirect_uri; the sim mirrors GitHub
}

// handleAccessToken is OAuth's code exchange. GitHub answers a bad code with 200 and an error body.
func (s *Server) handleAccessToken(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	if code == "" && strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		var body struct {
			Code string `json:"code"`
		}
		_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<14)).Decode(&body)
		code = body.Code
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	login, ok := s.codes[code]
	delete(s.codes, code)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]string{
			"error": "bad_verification_code", "error_description": "The code passed is incorrect or expired.",
		})
		return
	}
	value := "gho_" + randomHex(18)
	s.tokens[value] = &token{Expires: s.now().Add(8 * time.Hour), Login: login}
	writeJSON(w, http.StatusOK, map[string]string{"access_token": value, "token_type": "bearer", "scope": "read:user,user:email"})
}

func (s *Server) oauthUser(w http.ResponseWriter, r *http.Request) *user {
	tok, ok := s.tokens[bearer(r)]
	if !ok || tok.Login == "" || !s.now().Before(tok.Expires) {
		writeMessage(w, http.StatusUnauthorized, "Bad credentials")
		return nil
	}
	return s.users[tok.Login]
}

func (s *Server) handleUser(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.oauthUser(w, r)
	if u == nil {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"login": u.Login, "id": u.ID, "name": u.Name, "email": u.Email,
		"avatar_url": s.webBase() + "/avatars/" + u.Login, "type": "User",
	})
}

func (s *Server) handleUserEmails(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	u := s.oauthUser(w, r)
	if u == nil {
		return
	}
	writeJSON(w, http.StatusOK, []map[string]any{{"email": u.Email, "primary": true, "verified": true}})
}

// handleInstallPage is the App's install page. With ?account=<login> it installs there and redirects to the
// stack's setup URL as GitHub does; without it, it lists the accounts to choose from.
func (s *Server) handleInstallPage(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	account := q.Get("account")
	if account == "" {
		s.renderInstallChoices(w, r)
		return
	}
	in := s.installOn(account, q.Get("type"))
	if s.cfg.SetupURL == "" {
		writeJSON(w, http.StatusOK, map[string]any{"installation_id": in.ID, "note": "GITHUBSIM_SETUP_URL is not set; nothing to redirect to"})
		return
	}
	target, err := url.Parse(s.cfg.SetupURL)
	if err != nil {
		writeMessage(w, http.StatusInternalServerError, "GITHUBSIM_SETUP_URL is not a URL")
		return
	}
	query := target.Query()
	query.Set("installation_id", strconv.FormatInt(in.ID, 10))
	query.Set("setup_action", "install")
	if state := q.Get("state"); state != "" {
		query.Set("state", state)
	}
	target.RawQuery = query.Encode()
	http.Redirect(w, r, target.String(), http.StatusFound)
}

// installOn is the installation on an account, created (with a default repository) when it has none.
// An existing one is dated now, as a reinstall is on GitHub: the stack accepts only an installation
// created during its own connect flow, so a seed-time stamp refused every later connect.
func (s *Server) installOn(login, kind string) *installation {
	s.mu.Lock()
	for _, in := range s.installs {
		if strings.EqualFold(in.Account.Login, login) {
			in.Suspended = false
			in.CreatedAt = s.stamp()
			s.mu.Unlock()
			return in
		}
	}
	if kind == "" {
		kind = "Organization"
	}
	repo := s.addRepo(login+"/app", 0)
	in := &installation{
		ID: s.id(), Account: account{Login: login, ID: s.id(), Type: kind}, Selection: "all", CreatedAt: s.stamp(),
		Permissions: copyMap(defaultPermissions), Repos: []string{repo.FullName},
	}
	s.installs[in.ID] = in
	s.mu.Unlock()
	s.deliverAsync(deliverRequest{Event: "installation", Action: "created", InstallationID: in.ID})
	return in
}

func (s *Server) renderInstallChoices(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	var logins []string
	for _, in := range s.installs {
		logins = append(logins, in.Account.Login)
	}
	s.mu.Unlock()
	sort.Strings(logins)
	var b strings.Builder
	b.WriteString("<h1>Install " + html.EscapeString(r.PathValue("slug")) + "</h1><p>Pick the account to install the simulated GitHub App on.</p><ul>")
	for _, login := range logins {
		b.WriteString(installLink(r, login, ""))
	}
	b.WriteString(installLink(r, "new-org", " (a new organization)"))
	b.WriteString("</ul>")
	writePage(w, "githubsim install", b.String())
}

func installLink(r *http.Request, login, note string) string {
	q := r.URL.Query()
	q.Set("account", login)
	return fmt.Sprintf(`<li><a data-account=%q href="?%s">%s</a>%s</li>`, login, html.EscapeString(q.Encode()), html.EscapeString(login), note)
}

func writePage(w http.ResponseWriter, title, body string) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
	fmt.Fprintf(w, `<!doctype html><meta charset=utf-8><title>%s</title><body style="font:14px system-ui;margin:2rem;max-width:60rem">%s`, html.EscapeString(title), body)
}

// handlePage is the sim's overview: what it holds, and the control API that scripts it.
func (s *Server) handlePage(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var b strings.Builder
	fmt.Fprintf(&b, "<h1>githubsim</h1><p>Stack %s. Webhooks go to %s. Control API: <code>/_sim/api/info</code>.</p>",
		html.EscapeString(s.cfg.Stack), html.EscapeString(firstNonEmpty(s.cfg.WebhookURL, "(nowhere: GITHUBSIM_WEBHOOK_URL unset)")))
	b.WriteString("<h2>Installations</h2><ul>")
	for _, in := range s.sortedInstalls() {
		fmt.Fprintf(&b, "<li>%d %s (%s) suspended=%v repos=%s</li>", in.ID, html.EscapeString(in.Account.Login), in.Account.Type, in.Suspended, html.EscapeString(strings.Join(in.Repos, ", ")))
	}
	b.WriteString("</ul><h2>Pull requests</h2><ul>")
	for _, p := range s.pulls {
		fmt.Fprintf(&b, "<li>%s#%d %s [%s] head=%s</li>", html.EscapeString(p.Repo), p.Number, html.EscapeString(p.Title), p.State, html.EscapeString(p.HeadRef))
	}
	fmt.Fprintf(&b, "</ul><h2>Faults</h2><p>%d scripted. Calls kept: %d. Deliveries kept: %d.</p>", len(s.faults), len(s.calls), len(s.sent))
	writePage(w, "githubsim", b.String())
}

func (s *Server) sortedInstalls() []*installation {
	out := make([]*installation, 0, len(s.installs))
	for _, in := range s.installs {
		out = append(out, in)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}
