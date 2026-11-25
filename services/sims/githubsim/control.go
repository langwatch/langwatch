package githubsim

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// fault answers matching GitHub calls with a scripted error. Match is a substring of "METHOD /path"
// (empty matches every GitHub call); Times 0 means until cleared.
type fault struct {
	ID         string `json:"id"`
	Match      string `json:"match"`
	Status     int    `json:"status"`
	RetryAfter int    `json:"retryAfter"`
	Message    string `json:"message"`
	Times      int    `json:"times"`
	Hits       int    `json:"hits"`
}

var faultMessages = map[int]string{
	http.StatusUnauthorized:        "Bad credentials",
	http.StatusForbidden:           "Resource not accessible by integration",
	http.StatusNotFound:            "Not Found",
	http.StatusUnprocessableEntity: "Validation Failed",
	http.StatusTooManyRequests:     "You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
}

// applyFault answers the call with the first live fault matching it, and reports whether it did.
func (s *Server) applyFault(w http.ResponseWriter, r *http.Request) bool {
	key := r.Method + " " + r.URL.Path
	s.mu.Lock()
	var hit *fault
	for i, f := range s.faults {
		if !strings.Contains(key, f.Match) {
			continue
		}
		f.Hits++
		hit = &fault{}
		*hit = *f
		if f.Times > 0 && f.Hits >= f.Times {
			s.faults = append(s.faults[:i], s.faults[i+1:]...)
		}
		break
	}
	s.mu.Unlock()
	if hit == nil {
		return false
	}
	message := firstNonEmpty(hit.Message, faultMessages[hit.Status], "Server Error")
	if hit.RetryAfter > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(hit.RetryAfter))
	}
	if hit.Status == http.StatusTooManyRequests || (hit.Status == http.StatusForbidden && hit.RetryAfter > 0) {
		w.Header().Set("X-RateLimit-Remaining", "0")
		w.Header().Set("X-RateLimit-Reset", strconv.FormatInt(s.now().Add(time.Duration(max(hit.RetryAfter, 60))*time.Second).Unix(), 10))
	}
	writeMessage(w, hit.Status, message)
	return true
}

func (s *Server) controlRoutes(mux *http.ServeMux) {
	c := func(pattern string, h http.HandlerFunc) { mux.HandleFunc(pattern, h) }
	c("GET /_sim/api/info", s.handleInfo)
	c("GET /_sim/api/installations", func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"installations": s.sortedInstalls()})
	})
	c("POST /_sim/api/installations", s.handleCreateInstallation)
	c("POST /_sim/api/installations/{id}/action", s.handleInstallationAction)
	c("GET /_sim/api/pulls", func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"pulls": nonNil(s.pulls)})
	})
	c("POST /_sim/api/pulls", s.handleControlCreatePull)
	c("POST /_sim/api/pulls/transition", s.handlePullTransition)
	c("GET /_sim/api/faults", func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"faults": nonNil(s.faults)})
	})
	c("POST /_sim/api/faults", s.handleAddFault)
	c("DELETE /_sim/api/faults", func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		s.faults = nil
		s.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	})
	c("POST /_sim/api/tokens/expire", func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		for _, t := range s.tokens {
			t.Expires = s.now().Add(-time.Minute)
		}
		writeJSON(w, http.StatusOK, map[string]int{"expired": len(s.tokens)})
	})
	c("POST /_sim/api/users", s.handleAddUser)
	c("GET /_sim/api/calls", func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"calls": nonNil(reversed(s.calls))})
	})
	c("GET /_sim/api/deliveries", func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"deliveries": nonNil(reversed(s.sent))})
	})
	c("DELETE /_sim/api/calls", func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		s.calls, s.sent = nil, nil
		s.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	})
	c("POST /_sim/api/deliver", s.handleDeliver)
	c("POST /_sim/api/reset", func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.resetLocked()
		writeJSON(w, http.StatusOK, map[string]string{"status": "reset"})
	})
	mux.HandleFunc("/_sim/api/", func(w http.ResponseWriter, r *http.Request) {
		writeMessage(w, http.StatusNotFound, "githubsim has no control route "+r.Method+" "+r.URL.Path)
	})
}

func reversed[T any](in []T) []T {
	out := make([]T, len(in))
	for i, v := range in {
		out[len(in)-1-i] = v
	}
	return out
}

func (s *Server) resetLocked() {
	s.nextID = 9000
	s.installs, s.repos = map[int64]*installation{}, map[string]*repository{}
	s.pulls, s.checks, s.faults, s.calls, s.sent = nil, nil, nil, nil, nil
	s.tokens, s.codes = map[string]*token{}, map[string]string{}
	if s.cfg.Seed {
		s.seed()
	}
}

func decode(w http.ResponseWriter, r *http.Request, into any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<16)).Decode(into); err != nil {
		writeMessage(w, http.StatusBadRequest, "body is not the expected JSON: "+err.Error())
		return false
	}
	return true
}

func (s *Server) handleInfo(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"sim": "github", "stack": s.cfg.Stack, "appId": s.cfg.AppID, "appSlug": s.cfg.AppSlug,
		"webhookUrl": s.cfg.WebhookURL, "setupUrl": s.cfg.SetupURL, "installations": len(s.installs),
		"pulls": len(s.pulls), "faults": len(s.faults), "calls": len(s.calls), "deliveries": len(s.sent),
	})
}

func (s *Server) handleCreateInstallation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Account string   `json:"account"`
		Type    string   `json:"type"`
		Repos   []string `json:"repos"`
		Deliver bool     `json:"deliver"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Account == "" {
		writeMessage(w, http.StatusUnprocessableEntity, "account is required")
		return
	}
	s.mu.Lock()
	if len(body.Repos) == 0 {
		body.Repos = []string{body.Account + "/app"}
	}
	in := &installation{
		ID: s.id(), Account: account{Login: body.Account, ID: s.id(), Type: firstNonEmpty(body.Type, "Organization")},
		Selection: "all", CreatedAt: s.stamp(), Permissions: copyMap(defaultPermissions),
	}
	for _, name := range body.Repos {
		in.Repos = append(in.Repos, s.addRepo(name, 0).FullName)
	}
	s.installs[in.ID] = in
	s.mu.Unlock()
	if body.Deliver {
		_, _ = s.deliver(deliverRequest{Event: "installation", Action: "created", InstallationID: in.ID})
	}
	writeJSON(w, http.StatusCreated, in)
}

func (s *Server) handleInstallationAction(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.ParseInt(r.PathValue("id"), 10, 64)
	var body struct {
		Action      string            `json:"action"`
		Repo        string            `json:"repo"`
		Permissions map[string]string `json:"permissions"`
		Deliver     bool              `json:"deliver"`
	}
	if !decode(w, r, &body) {
		return
	}
	s.mu.Lock()
	in := s.installs[id]
	if in == nil {
		s.mu.Unlock()
		writeMessage(w, http.StatusNotFound, "no installation "+r.PathValue("id"))
		return
	}
	event, action := "installation", body.Action
	switch body.Action {
	case "suspend":
		in.Suspended = true
	case "unsuspend":
		in.Suspended = false
	case "delete":
		action = "deleted"
	case "add-repo":
		in.Repos, event, action = append(in.Repos, s.addRepo(body.Repo, 0).FullName), "installation_repositories", "added"
	case "remove-repo":
		in.Repos, event, action = without(in.Repos, body.Repo), "installation_repositories", "removed"
	case "permissions":
		in.Permissions = body.Permissions
		action = "new_permissions_accepted"
	default:
		s.mu.Unlock()
		writeMessage(w, http.StatusUnprocessableEntity, "action is one of suspend, unsuspend, delete, add-repo, remove-repo, permissions")
		return
	}
	s.mu.Unlock()
	var delivered *delivery
	if body.Deliver {
		d, _ := s.deliver(deliverRequest{Event: event, Action: action, InstallationID: id, RepositoriesAdd: []string{body.Repo}})
		delivered = &d
	}
	if action == "deleted" {
		s.mu.Lock()
		delete(s.installs, id)
		s.mu.Unlock()
	}
	writeJSON(w, http.StatusOK, map[string]any{"installation": in, "delivery": delivered})
}

func without(list []string, drop string) []string {
	out := []string{}
	for _, v := range list {
		if !strings.EqualFold(v, drop) {
			out = append(out, v)
		}
	}
	return out
}

func (s *Server) handleControlCreatePull(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Repo    string `json:"repo"`
		Title   string `json:"title"`
		Head    string `json:"head"`
		User    string `json:"user"`
		Draft   bool   `json:"draft"`
		Deliver bool   `json:"deliver"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Repo == "" || body.Head == "" {
		writeMessage(w, http.StatusUnprocessableEntity, "repo and head are required")
		return
	}
	s.mu.Lock()
	s.addRepo(body.Repo, 0)
	p := s.addPull(&pull{Repo: body.Repo, Title: firstNonEmpty(body.Title, "Change from "+body.Head), HeadRef: body.Head, User: firstNonEmpty(body.User, "octocat"), Draft: body.Draft})
	s.mu.Unlock()
	var delivered *delivery
	if body.Deliver {
		d, _ := s.deliver(deliverRequest{Event: "pull_request", Action: "opened", Repo: p.Repo, Number: p.Number})
		delivered = &d
	}
	writeJSON(w, http.StatusCreated, map[string]any{"pull": p, "delivery": delivered})
}

func (s *Server) handlePullTransition(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Repo    string `json:"repo"`
		Number  int    `json:"number"`
		Action  string `json:"action"`
		Title   string `json:"title"`
		Deliver bool   `json:"deliver"`
	}
	if !decode(w, r, &body) {
		return
	}
	s.mu.Lock()
	p := s.findPull(body.Repo, body.Number)
	if p == nil {
		s.mu.Unlock()
		writeMessage(w, http.StatusNotFound, "no pull request "+body.Repo+"#"+strconv.Itoa(body.Number))
		return
	}
	event := body.Action
	switch body.Action {
	case "close":
		p.State, p.ClosedAt, event = "closed", s.stamp(), "closed"
	case "merge":
		p.State, p.ClosedAt, p.Merged, event = "closed", s.stamp(), true, "closed"
	case "reopen":
		p.State, p.ClosedAt, p.Merged, event = "open", "", false, "reopened"
	case "draft":
		p.Draft, event = true, "converted_to_draft"
	case "ready":
		p.Draft, event = false, "ready_for_review"
	case "edit":
		p.Title, event = firstNonEmpty(body.Title, p.Title), "edited"
	case "synchronize":
	default:
		s.mu.Unlock()
		writeMessage(w, http.StatusUnprocessableEntity, "action is one of close, merge, reopen, draft, ready, edit, synchronize")
		return
	}
	p.UpdatedAt = s.stamp()
	s.mu.Unlock()
	var delivered *delivery
	if body.Deliver {
		d, _ := s.deliver(deliverRequest{Event: "pull_request", Action: event, Repo: body.Repo, Number: body.Number})
		delivered = &d
	}
	writeJSON(w, http.StatusOK, map[string]any{"pull": p, "delivery": delivered})
}

func (s *Server) handleAddFault(w http.ResponseWriter, r *http.Request) {
	var f fault
	if !decode(w, r, &f) {
		return
	}
	if f.Status < 400 || f.Status > 599 {
		writeMessage(w, http.StatusUnprocessableEntity, "status is a 4xx or 5xx code")
		return
	}
	f.ID, f.Hits = randomHex(4), 0
	s.mu.Lock()
	s.faults = append(s.faults, &f)
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, f)
}

func (s *Server) handleAddUser(w http.ResponseWriter, r *http.Request) {
	var u user
	if !decode(w, r, &u) {
		return
	}
	if u.Login == "" {
		writeMessage(w, http.StatusUnprocessableEntity, "login is required")
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	u.ID = firstPositive(u.ID, s.id())
	u.Email = firstNonEmpty(u.Email, u.Login+"@example.com")
	s.users[u.Login] = &u
	writeJSON(w, http.StatusCreated, u)
}

func firstPositive(a, b int64) int64 {
	if a > 0 {
		return a
	}
	return b
}

func (s *Server) handleDeliver(w http.ResponseWriter, r *http.Request) {
	var req deliverRequest
	if !decode(w, r, &req) {
		return
	}
	d, err := s.deliver(req)
	if err != nil && d.Status == 0 {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{"message": err.Error(), "delivery": d})
		return
	}
	writeJSON(w, http.StatusOK, d)
}
