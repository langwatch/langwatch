package dashboard

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

// Actions are the lifecycle operations the dashboard may perform. Both are
// optional: a Server built without them renders the same page with no buttons
// on it, which is what a build that should only ever look at the machine gets.
type Actions struct {
	// Restart bounces one running stack's services — all of them when service is
	// empty — and returns the one line describing what it did.
	Restart func(slug, service string) (string, error)
	// Start brings up a worktree that has no stack. It returns as soon as the
	// launcher is spawned; the registry is where progress is read.
	Start func(dir string) error
}

// maxActionBody caps a request body that is only ever a small JSON object, so a
// local process posting at the daemon cannot make it buffer anything large.
const maxActionBody = 4 << 10

// guardAction is what stands between a page on another origin and this
// machine's stacks. The daemon binds loopback and pins the Host header already,
// but a page the developer happens to have open can still issue a cross-origin
// POST to it — and this one starts processes. So: POST only, and the request
// must say it came from this page. A browser attaches Sec-Fetch-Site itself and
// a page cannot forge it; Origin is checked too for anything that sends one and
// not the other. A request with neither is refused rather than trusted, which
// costs a curl user one header and costs an attacker the whole route.
func guardAction(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		http.Error(w, "this action accepts POST", http.StatusMethodNotAllowed)
		return false
	}
	site := r.Header.Get("Sec-Fetch-Site")
	origin := r.Header.Get("Origin")
	sameSite := site == "same-origin" || site == "none"
	sameOrigin := origin != "" && strings.HasSuffix(origin, "//"+r.Host)
	if !sameSite && !sameOrigin {
		http.Error(w, "this action may only be taken from the dashboard itself", http.StatusForbidden)
		return false
	}
	return true
}

// writeActionResult answers an action with the one line a toast shows.
func writeActionResult(w http.ResponseWriter, message string, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]string{"message": message})
}

// handleRestart bounces a running stack. The slug comes from the path and the
// optional service from the query, so the body is empty and unread.
func (s *Server) handleRestart(w http.ResponseWriter, r *http.Request) {
	if !guardAction(w, r) {
		return
	}
	if s.config.Actions.Restart == nil {
		http.Error(w, "this haven cannot restart a stack", http.StatusNotImplemented)
		return
	}
	slug := r.PathValue("slug")
	if !s.knownLogStack(slug) {
		http.Error(w, "unknown stack", http.StatusNotFound)
		return
	}
	message, err := s.config.Actions.Restart(slug, r.URL.Query().Get("service"))
	if message == "" && err == nil {
		message = "restarted " + slug
	}
	writeActionResult(w, message, err)
}

// handleStart brings up a worktree with no stack. The directory is checked
// against git's own worktree list in the app layer — this handler passes it
// through and never decides whether a path is legitimate.
func (s *Server) handleStart(w http.ResponseWriter, r *http.Request) {
	if !guardAction(w, r) {
		return
	}
	if s.config.Actions.Start == nil {
		http.Error(w, "this haven cannot start a stack", http.StatusNotImplemented)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxActionBody))
	if err != nil {
		http.Error(w, "could not read the request", http.StatusBadRequest)
		return
	}
	var req struct {
		Dir string `json:"dir"`
	}
	if jerr := json.Unmarshal(body, &req); jerr != nil || req.Dir == "" {
		http.Error(w, "name the worktree directory to start", http.StatusBadRequest)
		return
	}
	writeActionResult(w, "starting a stack — it appears here as its services come up", s.config.Actions.Start(req.Dir))
}
