package dashboard

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"os/exec"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/orbstore"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// orbMaxBody bounds one orb post: a note plus two 200-entry buffers.
const orbMaxBody = 1 << 20

// orbLink is one console the orb's panel links.
type orbLink struct {
	Label string `json:"label"`
	Href  string `json:"href"`
}

// orbFacts is what the orb's panel shows about its stack.
type orbFacts struct {
	Slug   string    `json:"slug"`
	Branch string    `json:"branch"`
	Commit string    `json:"commit"`
	Links  []orbLink `json:"links"`
}

// handleOrbFacts answers the orb's panel: the stack's branch, commit and consoles.
func (s *Server) handleOrbFacts(w http.ResponseWriter, r *http.Request) {
	st, ok := s.orbStack(w, r)
	if !ok {
		return
	}
	writeOrbJSON(w, http.StatusOK, orbFacts{
		Slug:   st.Slug,
		Branch: st.Branch,
		Commit: orbHeadCommit(r.Context(), st.WorktreeDir),
		Links:  s.orbLinks(st),
	})
}

// handleOrbFeedback stores one reader's note; the note is the one field it needs.
func (s *Server) handleOrbFeedback(w http.ResponseWriter, r *http.Request) {
	st, ok := s.orbStack(w, r)
	if !ok {
		return
	}
	var report orbstore.Report
	if !decodeOrbBody(w, r, &report) {
		return
	}
	if strings.TrimSpace(report.Note) == "" {
		http.Error(w, "feedback needs a note", http.StatusBadRequest)
		return
	}
	item, err := orbstore.At(s.config.LogDir(st.Slug)).Add(report, time.Now())
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeOrbJSON(w, http.StatusCreated, map[string]string{"id": item.ID})
}

// handleOrbPage replaces the page buffer an agent reads with `haven page`.
func (s *Server) handleOrbPage(w http.ResponseWriter, r *http.Request) {
	st, ok := s.orbStack(w, r)
	if !ok {
		return
	}
	var page orbstore.Page
	if !decodeOrbBody(w, r, &page) {
		return
	}
	if err := orbstore.At(s.config.LogDir(st.Slug)).SavePage(page); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleOrbPreflight lets the stack's own app page post JSON to the orb routes.
func (s *Server) handleOrbPreflight(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.orbStack(w, r); !ok {
		return
	}
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.WriteHeader(http.StatusNoContent)
}

// orbStack answers the stack an orb request names and allows the response to
// its app origin. Another origin, an unknown stack or no log capture is a 403.
func (s *Server) orbStack(w http.ResponseWriter, r *http.Request) (domain.Stack, bool) {
	slug := r.PathValue("slug")
	origin := r.Header.Get("Origin")
	st, found := s.orbStackBySlug(slug)
	if !found || s.config.LogDir == nil || !s.isOrbAppOrigin(origin, slug) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return domain.Stack{}, false
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Add("Vary", "Origin")
	return st, true
}

// isOrbAppOrigin reports whether origin is app.<slug> under haven's domain,
// the one page the orb runs on.
func (s *Server) isOrbAppOrigin(origin, slug string) bool {
	u, err := url.Parse(origin)
	if err != nil || origin == "" {
		return false
	}
	base, err := url.Parse(s.config.SharedURL("langwatch"))
	if err != nil || base.Hostname() == "" {
		return false
	}
	return strings.EqualFold(u.Hostname(), "app."+slug+"."+base.Hostname())
}

func (s *Server) orbStackBySlug(slug string) (domain.Stack, bool) {
	if !domain.ValidSlug(slug) {
		return domain.Stack{}, false
	}
	stacks := s.config.Stacks()
	for i := range stacks {
		if stacks[i].Slug == slug {
			return stacks[i], true
		}
	}
	return domain.Stack{}, false
}

// orbLinks are the hub, this stack's logs page and every service haven routes for it.
func (s *Server) orbLinks(st domain.Stack) []orbLink {
	hub := strings.TrimRight(s.hubURL(), "/")
	links := []orbLink{
		{Label: "Hub", Href: hub},
		{Label: "Logs", Href: hub + "/logs/" + url.PathEscape(st.Slug)},
	}
	for _, svc := range st.Services {
		if svc.URL != "" {
			links = append(links, orbLink{Label: svc.Name, Href: svc.URL})
		}
	}
	return links
}

// decodeOrbBody reads a JSON body of at most orbMaxBody into v, or answers the error.
func decodeOrbBody(w http.ResponseWriter, r *http.Request, v any) bool {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		http.Error(w, "want application/json", http.StatusUnsupportedMediaType)
		return false
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, orbMaxBody)).Decode(v); err != nil {
		http.Error(w, "bad orb body: "+err.Error(), http.StatusBadRequest)
		return false
	}
	return true
}

func writeOrbJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// orbHeadCommit is the worktree's short HEAD, or empty when git cannot say in time.
func orbHeadCommit(ctx context.Context, dir string) string {
	if dir == "" {
		return ""
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, "git", "-C", dir, "rev-parse", "--short", "HEAD").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}
