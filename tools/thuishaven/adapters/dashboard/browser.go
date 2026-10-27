package dashboard

import (
	"context"
	"fmt"
	"net/http"
)

// Browser looks at the stack's shared headless browser, as `haven browser
// snapshot|screenshot --lane <lane>` does. Either nil answers 501.
type Browser struct {
	Snapshot   func(ctx context.Context, slug, lane string) (any, error)
	Screenshot func(ctx context.Context, slug, lane string) ([]byte, error)
}

func (s *Server) knownHome(w http.ResponseWriter, slug string) bool {
	if _, _, found := s.findHome(slug, s.extras()); found {
		return true
	}
	writeJSON(w, http.StatusNotFound, notFoundJSON{
		Error: fmt.Sprintf("no stack is registered for %q", slug), Slug: slug, HubURL: s.hubURL(),
	})
	return false
}

// handleBrowserSnapshot is GET /api/stacks/{slug}/browser/{lane}/snapshot.
func (s *Server) handleBrowserSnapshot(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if s.config.Browser.Snapshot == nil {
		http.Error(w, "this haven cannot read a browser", http.StatusNotImplemented)
		return
	}
	if !s.knownHome(w, slug) {
		return
	}
	reply, err := s.config.Browser.Snapshot(r.Context(), slug, r.PathValue("lane"))
	if err != nil {
		writeJSON(w, http.StatusBadGateway, cliReadErrorJSON{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, cliReadJSON{V: 1, Stack: slug, Rows: reply})
}

// handleBrowserScreenshot is GET /api/stacks/{slug}/browser/{lane}/screenshot: a PNG.
func (s *Server) handleBrowserScreenshot(w http.ResponseWriter, r *http.Request) {
	slug := r.PathValue("slug")
	if s.config.Browser.Screenshot == nil {
		http.Error(w, "this haven cannot read a browser", http.StatusNotImplemented)
		return
	}
	if !s.knownHome(w, slug) {
		return
	}
	png, err := s.config.Browser.Screenshot(r.Context(), slug, r.PathValue("lane"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(png)
}
