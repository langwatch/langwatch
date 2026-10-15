package githubsim

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// routes is the GitHub surface twice: at the root (how the github module calls it) and under
// /api/v3 with /api/graphql (how gh calls a GitHub Enterprise host), plus git smart-HTTP.
func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	api := func(pattern string, h http.HandlerFunc) { mux.HandleFunc(pattern, s.wrap(h)) }
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	api("GET /app/installations/{id}", s.handleGetInstallation)
	api("POST /app/installations/{id}/access_tokens", s.handleMintToken)
	api("GET /installation/repositories", s.handleInstallationRepos)
	api("GET /repos/{owner}/{repo}/pulls", s.handleListPulls)
	api("POST /repos/{owner}/{repo}/pulls", s.handleCreatePull)
	api("GET /repos/{owner}/{repo}/pulls/{number}", s.handleGetPull)
	api("POST /repos/{owner}/{repo}/check-runs", s.handleCreateCheckRun)
	api("GET /repos/{owner}/{repo}/commits/{ref}/check-runs", s.handleListCheckRuns)
	api("GET /login/oauth/authorize", s.handleAuthorize)
	api("POST /login/oauth/access_token", s.handleAccessToken)
	api("GET /user", s.handleUser)
	api("GET /user/emails", s.handleUserEmails)
	api("GET /apps/{slug}/installations/new", s.handleInstallPage)
	api("GET /github-apps/{slug}/installations/new", s.handleInstallPage)
	api("POST /api/graphql", s.handleGraphQL)
	api("GET /meta", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"installed_version": "3.17.0", "verifiable_password_authentication": false})
	})
	s.controlRoutes(mux)
	mux.HandleFunc("GET /{$}", s.handlePage)
	// A GitHub path githubsim does not fake is GitHub's own 404 JSON, never the page.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeMessage(w, http.StatusNotFound, "githubsim does not fake "+r.Method+" "+r.URL.Path)
	})
	git := s.wrap(s.handleGit)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if owner, repo, ok := gitPath(r.URL.Path); ok {
			r.SetPathValue("owner", owner)
			r.SetPathValue("repo", repo)
			git(w, r)
			return
		}
		if rest, ok := strings.CutPrefix(r.URL.Path, "/api/v3/"); ok {
			r.URL.Path, r.URL.RawPath = "/"+rest, ""
		}
		mux.ServeHTTP(w, r)
	})
}

// gitPath matches /{owner}/{repo}/info/refs, /git-upload-pack and /git-receive-pack (repo with or without .git).
func gitPath(path string) (owner, repo string, ok bool) {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	switch {
	case len(parts) == 4 && parts[2] == "info" && parts[3] == "refs":
	case len(parts) == 3 && (parts[2] == "git-upload-pack" || parts[2] == "git-receive-pack"):
	default:
		return "", "", false
	}
	if parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// statusWriter remembers the status so the call history can record it.
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// wrap applies the scripted faults, then records the call.
func (s *Server) wrap(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		faulted := s.applyFault(sw, r)
		if !faulted {
			h(sw, r)
		}
		s.record(callRecord{
			At: s.stamp(), Method: r.Method, Path: r.URL.RequestURI(), Status: sw.status,
			Auth: authKind(r), Fault: faulted,
		})
	}
}

func authKind(r *http.Request) string {
	header := r.Header.Get("Authorization")
	switch {
	case header == "":
		return "none"
	case strings.Count(strings.TrimPrefix(header, "Bearer "), ".") == 2:
		return "app-jwt"
	default:
		return "token"
	}
}

// bearer is the token of a Bearer/token header, or the password of Basic auth (how git sends it).
func bearer(r *http.Request) string {
	if _, password, ok := r.BasicAuth(); ok {
		return password
	}
	header := r.Header.Get("Authorization")
	for _, prefix := range []string{"Bearer ", "bearer ", "token "} {
		if strings.HasPrefix(header, prefix) {
			return strings.TrimSpace(strings.TrimPrefix(header, prefix))
		}
	}
	return ""
}

// appAuth accepts an App JWT: three segments, a payload that names the App, not expired.
func (s *Server) appAuth(w http.ResponseWriter, r *http.Request) bool {
	parts := strings.Split(bearer(r), ".")
	if len(parts) != 3 {
		writeMessage(w, http.StatusUnauthorized, "A JSON web token could not be decoded")
		return false
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	var claims struct {
		Iss any   `json:"iss"`
		Exp int64 `json:"exp"`
	}
	if err != nil || json.Unmarshal(raw, &claims) != nil {
		writeMessage(w, http.StatusUnauthorized, "A JSON web token could not be decoded")
		return false
	}
	if claims.Exp != 0 && claims.Exp < s.now().Unix() {
		writeMessage(w, http.StatusUnauthorized, "'Expiration time' claim ('exp') must be a numeric value representing the future time at which the assertion expires")
		return false
	}
	iss := claimString(claims.Iss)
	if iss == "" {
		iss = strconv.FormatFloat(toFloat(claims.Iss), 'f', -1, 64)
	}
	if s.cfg.AppID != "" && iss != s.cfg.AppID {
		writeMessage(w, http.StatusUnauthorized, "Issuer does not match an App installed here")
		return false
	}
	return true
}

func toFloat(v any) float64 {
	f, _ := v.(float64)
	return f
}

func claimString(v any) string {
	str, _ := v.(string)
	return str
}

// tokenAuth resolves an installation token and checks permission (name -> "read"/"write") and, when repo is set, access to it. The caller holds s.mu.
func (s *Server) tokenAuth(w http.ResponseWriter, r *http.Request, permission, level, repo string) *token {
	tok, ok := s.tokens[bearer(r)]
	if !ok || tok.Installation == 0 {
		writeMessage(w, http.StatusUnauthorized, "Bad credentials")
		return nil
	}
	if !s.now().Before(tok.Expires) {
		writeMessage(w, http.StatusUnauthorized, "Bad credentials")
		return nil
	}
	in := s.installs[tok.Installation]
	if in == nil {
		writeMessage(w, http.StatusUnauthorized, "Bad credentials")
		return nil
	}
	if in.Suspended {
		writeMessage(w, http.StatusForbidden, "This installation has been suspended")
		return nil
	}
	if permission != "" && !grants(tok.Permissions, permission, level) {
		writeMessage(w, http.StatusForbidden, "Resource not accessible by integration")
		return nil
	}
	if repo != "" && !s.tokenSees(tok, in, repo) {
		writeMessage(w, http.StatusNotFound, "Not Found")
		return nil
	}
	return tok
}

func grants(have map[string]string, permission, level string) bool {
	got, ok := have[permission]
	if !ok {
		return false
	}
	return got == "write" || level == "read"
}

func (s *Server) tokenSees(tok *token, in *installation, repo string) bool {
	for _, name := range in.Repos {
		if !strings.EqualFold(name, repo) {
			continue
		}
		if len(tok.RepoIDs) == 0 {
			return true
		}
		for _, id := range tok.RepoIDs {
			if r := s.repos[strings.ToLower(name)]; r != nil && r.ID == id {
				return true
			}
		}
	}
	return false
}

func (s *Server) handleGetInstallation(w http.ResponseWriter, r *http.Request) {
	if !s.appAuth(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	s.mu.Lock()
	defer s.mu.Unlock()
	in := s.installs[id]
	if in == nil {
		writeMessage(w, http.StatusNotFound, "Not Found")
		return
	}
	writeJSON(w, http.StatusOK, installationJSON(in))
}

func installationJSON(in *installation) map[string]any {
	return map[string]any{
		"id": in.ID, "account": in.Account, "repository_selection": in.Selection,
		"created_at": in.CreatedAt, "permissions": in.Permissions, "suspended_at": suspendedAt(in),
	}
}

func suspendedAt(in *installation) any {
	if in.Suspended {
		return in.CreatedAt
	}
	return nil
}

func (s *Server) handleMintToken(w http.ResponseWriter, r *http.Request) {
	if !s.appAuth(w, r) {
		return
	}
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var body struct {
		Permissions   map[string]string `json:"permissions"`
		RepositoryIDs []int64           `json:"repository_ids"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body)
	s.mu.Lock()
	defer s.mu.Unlock()
	in := s.installs[id]
	if in == nil {
		writeMessage(w, http.StatusNotFound, "Not Found")
		return
	}
	if in.Suspended {
		writeMessage(w, http.StatusForbidden, "This installation has been suspended")
		return
	}
	for name, level := range body.Permissions {
		if !grants(in.Permissions, name, level) {
			writeMessage(w, http.StatusUnprocessableEntity, "The permissions requested are not granted to this installation.")
			return
		}
	}
	perms := body.Permissions
	if len(perms) == 0 {
		perms = copyMap(in.Permissions)
	}
	value := "ghs_" + randomHex(18)
	expires := s.now().Add(time.Hour)
	s.tokens[value] = &token{Installation: id, Expires: expires, Permissions: perms, RepoIDs: body.RepositoryIDs}
	writeJSON(w, http.StatusCreated, map[string]any{
		"token": value, "expires_at": expires.Format(time.RFC3339), "permissions": perms,
		"repository_selection": in.Selection,
	})
}

func (s *Server) handleInstallationRepos(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tok := s.tokenAuth(w, r, "", "", "")
	if tok == nil {
		return
	}
	in := s.installs[tok.Installation]
	var visible []map[string]any
	for _, name := range in.Repos {
		if s.tokenSees(tok, in, name) {
			repo := s.repos[strings.ToLower(name)]
			visible = append(visible, map[string]any{"id": repo.ID, "full_name": repo.FullName, "private": repo.Private})
		}
	}
	perPage := intParam(r, "per_page", 30)
	page := intParam(r, "page", 1)
	start := min((page-1)*perPage, len(visible))
	end := min(start+perPage, len(visible))
	writeJSON(w, http.StatusOK, map[string]any{"total_count": len(visible), "repositories": nonNil(visible[start:end])})
}

func nonNil[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}

func intParam(r *http.Request, key string, fallback int) int {
	if n, err := strconv.Atoi(r.URL.Query().Get(key)); err == nil && n > 0 {
		return n
	}
	return fallback
}

func (s *Server) pullJSON(p *pull) map[string]any {
	var mergedAt, closedAt any
	if p.Merged {
		mergedAt = p.ClosedAt
	}
	if p.ClosedAt != "" {
		closedAt = p.ClosedAt
	}
	return map[string]any{
		"number": p.Number, "html_url": s.webBase() + "/" + p.Repo + "/pull/" + strconv.Itoa(p.Number),
		"title": p.Title, "state": p.State, "draft": p.Draft, "merged": p.Merged, "merged_at": mergedAt,
		"closed_at": closedAt, "created_at": p.CreatedAt, "updated_at": p.UpdatedAt,
		"user": map[string]any{"login": p.User},
		"head": map[string]any{"ref": p.HeadRef, "repo": map[string]any{"full_name": p.HeadRepo}},
	}
}

func (s *Server) webBase() string {
	if s.cfg.PublicURL != "" {
		return strings.TrimRight(s.cfg.PublicURL, "/")
	}
	return "https://github.sim"
}

func (s *Server) handleListPulls(w http.ResponseWriter, r *http.Request) {
	repo := r.PathValue("owner") + "/" + r.PathValue("repo")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tokenAuth(w, r, "pull_requests", "read", repo) == nil {
		return
	}
	state := r.URL.Query().Get("state")
	head := r.URL.Query().Get("head")
	out := []map[string]any{}
	for _, p := range s.pulls {
		if !strings.EqualFold(p.Repo, repo) {
			continue
		}
		if state != "all" && p.State != firstNonEmpty(state, "open") {
			continue
		}
		if head != "" && !strings.EqualFold(head, s.ownerOf(p.HeadRepo)+":"+p.HeadRef) {
			continue
		}
		out = append(out, s.pullJSON(p))
	}
	writeJSON(w, http.StatusOK, out)
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

func (s *Server) handleGetPull(w http.ResponseWriter, r *http.Request) {
	repo := r.PathValue("owner") + "/" + r.PathValue("repo")
	number, _ := strconv.Atoi(r.PathValue("number"))
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tokenAuth(w, r, "pull_requests", "read", repo) == nil {
		return
	}
	p := s.findPull(repo, number)
	if p == nil {
		writeMessage(w, http.StatusNotFound, "Not Found")
		return
	}
	writeJSON(w, http.StatusOK, s.pullJSON(p))
}

func (s *Server) handleCreatePull(w http.ResponseWriter, r *http.Request) {
	repo := r.PathValue("owner") + "/" + r.PathValue("repo")
	var body struct {
		Title string `json:"title"`
		Head  string `json:"head"`
		Base  string `json:"base"`
		Draft bool   `json:"draft"`
	}
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tokenAuth(w, r, "pull_requests", "write", repo) == nil {
		return
	}
	if body.Title == "" || body.Head == "" || body.Base == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"message": "Validation Failed", "errors": []string{"title, head and base are required"}})
		return
	}
	_, head, hasOwner := strings.Cut(body.Head, ":")
	if !hasOwner {
		head = body.Head
	}
	for _, p := range s.pulls {
		if strings.EqualFold(p.Repo, repo) && p.HeadRef == head && p.State == "open" {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"message": "Validation Failed", "errors": []string{"A pull request already exists for " + body.Head}})
			return
		}
	}
	p := s.addPull(&pull{Repo: repo, Title: body.Title, HeadRef: head, Draft: body.Draft, User: "langwatch[bot]"})
	writeJSON(w, http.StatusCreated, s.pullJSON(p))
}

func (s *Server) handleCreateCheckRun(w http.ResponseWriter, r *http.Request) {
	repo := r.PathValue("owner") + "/" + r.PathValue("repo")
	var body checkRun
	_ = json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(&body)
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tokenAuth(w, r, "checks", "write", repo) == nil {
		return
	}
	if body.Name == "" || body.HeadSHA == "" {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"message": "Validation Failed", "errors": []string{"name and head_sha are required"}})
		return
	}
	body.ID, body.Repo, body.StartedAt = s.id(), repo, s.stamp()
	if body.Status == "" {
		body.Status = "queued"
	}
	s.checks = append(s.checks, &body)
	writeJSON(w, http.StatusCreated, body)
}

func (s *Server) handleListCheckRuns(w http.ResponseWriter, r *http.Request) {
	repo := r.PathValue("owner") + "/" + r.PathValue("repo")
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tokenAuth(w, r, "checks", "read", repo) == nil {
		return
	}
	runs := []*checkRun{}
	for _, c := range s.checks {
		if strings.EqualFold(c.Repo, repo) && c.HeadSHA == r.PathValue("ref") {
			runs = append(runs, c)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"total_count": len(runs), "check_runs": runs})
}
