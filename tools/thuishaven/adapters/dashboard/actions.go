package dashboard

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
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
	// Down stops a stack and keeps its databases; Destroy also drops them.
	Down    func(ctx context.Context, slug string) error
	Destroy func(ctx context.Context, slug string) error
	// StartService adds one service to a running stack (`haven up +<service>`);
	// ResetDatabases runs `haven db reset --yes` for it. Both return once spawned.
	StartService   func(slug, service string) error
	ResetDatabases func(slug string) error
	// Seed runs `haven seed --size <size> --persona <persona>` for a stack and
	// returns once spawned; SeedReport is its status line and log tail.
	Seed       func(slug, size, persona string) error
	SeedReport func(slug string) (string, []string)
	// StartKeeper starts a provisioned stack's keeper for the `haven up` that
	// asks, and returns once the keeper holds the stack's record.
	StartKeeper func(ctx context.Context, slug string) error
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
	return guardMethod(w, r, http.MethodPost)
}

// guardMethod is guardAction for an action that is not a POST: the same
// same-page rule, with the one method the route takes.
func guardMethod(w http.ResponseWriter, r *http.Request, method string) bool {
	if r.Method != method {
		http.Error(w, "this action accepts "+method, http.StatusMethodNotAllowed)
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

// handleDown stops a stack and keeps its data: `haven down` for one slug.
func (s *Server) handleDown(w http.ResponseWriter, r *http.Request) {
	if !guardAction(w, r) {
		return
	}
	if s.config.Actions.Down == nil {
		http.Error(w, "this haven cannot stop a stack", http.StatusNotImplemented)
		return
	}
	slug := r.PathValue("slug")
	if !s.knownLogStack(slug) {
		http.Error(w, "unknown stack", http.StatusNotFound)
		return
	}
	writeActionResult(w, "stopped "+slug, s.config.Actions.Down(r.Context(), slug))
}

// handleDestroy stops a stack and drops its databases: `haven destroy <slug>`.
// The body must repeat the slug, the same typed confirmation the hub asks for,
// so a stray POST at the route cannot take data away.
func (s *Server) handleDestroy(w http.ResponseWriter, r *http.Request) {
	if !guardAction(w, r) {
		return
	}
	if s.config.Actions.Destroy == nil {
		http.Error(w, "this haven cannot destroy a stack", http.StatusNotImplemented)
		return
	}
	slug := r.PathValue("slug")
	if !s.knownLogStack(slug) {
		http.Error(w, "unknown stack", http.StatusNotFound)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxActionBody))
	if err != nil {
		http.Error(w, "could not read the request", http.StatusBadRequest)
		return
	}
	var req struct {
		Confirm string `json:"confirm"`
	}
	if jerr := json.Unmarshal(body, &req); jerr != nil || req.Confirm != slug {
		http.Error(w, "type the stack's slug to confirm destroying it", http.StatusBadRequest)
		return
	}
	writeActionResult(w, "destroyed "+slug+" and dropped its databases", s.config.Actions.Destroy(r.Context(), slug))
}

// handleStartService adds a service to a running stack: `haven up +<service>`.
func (s *Server) handleStartService(w http.ResponseWriter, r *http.Request) {
	if !guardAction(w, r) {
		return
	}
	if s.config.Actions.StartService == nil {
		http.Error(w, "this haven cannot add a service to a stack", http.StatusNotImplemented)
		return
	}
	slug := r.PathValue("slug")
	if !s.knownLogStack(slug) {
		http.Error(w, "unknown stack", http.StatusNotFound)
		return
	}
	service := r.URL.Query().Get("service")
	writeActionResult(w, "restarting "+slug+" with "+service+" — it appears here as it comes up", s.config.Actions.StartService(slug, service))
}

// handleResetDatabases gives a stack fresh databases: `haven db reset --yes`.
// The body must repeat the database name, the name `haven db reset` asks for
// on the shared database, so a stray POST cannot drop anything.
func (s *Server) handleResetDatabases(w http.ResponseWriter, r *http.Request) {
	if !guardAction(w, r) {
		return
	}
	if s.config.Actions.ResetDatabases == nil {
		http.Error(w, "this haven cannot reset a stack's databases", http.StatusNotImplemented)
		return
	}
	slug := r.PathValue("slug")
	if !s.knownLogStack(slug) {
		http.Error(w, "unknown stack", http.StatusNotFound)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxActionBody))
	if err != nil {
		http.Error(w, "could not read the request", http.StatusBadRequest)
		return
	}
	var req struct {
		Confirm string `json:"confirm"`
	}
	if jerr := json.Unmarshal(body, &req); jerr != nil || req.Confirm != domain.DatabaseForSlug(slug) {
		http.Error(w, "type the database name to confirm resetting it", http.StatusBadRequest)
		return
	}
	writeActionResult(w, "resetting "+slug+"'s databases: migrating and seeding them fresh", s.config.Actions.ResetDatabases(slug))
}

// handleSeed is the seed console's start: `haven seed` at the chosen size and
// persona. seedgen validates both before anything is spawned.
func (s *Server) handleSeed(w http.ResponseWriter, r *http.Request) {
	if !guardAction(w, r) {
		return
	}
	if s.config.Actions.Seed == nil {
		http.Error(w, "this haven cannot seed a stack", http.StatusNotImplemented)
		return
	}
	slug := r.PathValue("slug")
	if !s.knownLogStack(slug) {
		http.Error(w, "unknown stack", http.StatusNotFound)
		return
	}
	var req struct {
		Size    string `json:"size"`
		Persona string `json:"persona"`
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxActionBody))
	if err != nil || json.Unmarshal(body, &req) != nil || req.Size == "" || req.Persona == "" {
		http.Error(w, "send a size and a persona", http.StatusBadRequest)
		return
	}
	writeActionResult(w, "seeding "+slug+" at the "+req.Size+" size", s.config.Actions.Seed(slug, req.Size, req.Persona))
}

// handleStartKeeper is the hand-over `haven up` asks for (ruling D-S4c-1). The
// CLI passes guardAction with Sec-Fetch-Site: none; a page on a stack's app
// origin is same-site, not same-origin, and is refused like any other page.
func (s *Server) handleStartKeeper(w http.ResponseWriter, r *http.Request) {
	if !guardAction(w, r) {
		return
	}
	if s.config.Actions.StartKeeper == nil {
		http.Error(w, "this haven cannot start a keeper", http.StatusNotImplemented)
		return
	}
	slug := r.PathValue("slug")
	if !s.knownLogStack(slug) {
		http.Error(w, "unknown stack", http.StatusNotFound)
		return
	}
	writeActionResult(w, "started "+slug+"'s keeper", s.config.Actions.StartKeeper(r.Context(), slug))
}
