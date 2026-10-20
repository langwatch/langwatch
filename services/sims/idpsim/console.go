package idpsim

import (
	"io"
	"io/fs"
	"net/http"

	"github.com/langwatch/langwatch/pkg/webconsole"
	"github.com/langwatch/langwatch/services/sims/simconsole"
)

// consoleBuildCommand is what the not-built page tells a developer to run.
const consoleBuildCommand = simconsole.BuildCommand

// embeddedConsole is the idp page of the apps/sims build this binary embeds (ADR-160).
func embeddedConsole() fs.FS {
	return simconsole.Page("idp")
}

// routeConsole is what a person opens: the landing page at / and a tenant's
// page at /t/{tenant}. Every other unmatched path also reaches the bundle, so
// the app's own router answers it.
func (s *Server) routeConsole(mux *http.ServeMux) {
	mux.HandleFunc("GET /t/{tenant}", s.handleTenantConsole)
	mux.HandleFunc("GET /t/{tenant}/{$}", s.handleTenantConsole)
	mux.HandleFunc("/", s.console.ServeHTTP)
}

// handleTenantConsole serves the bundle for a tenant that exists, and the same
// bundle under a 404 for one that does not, so the page can say so.
func (s *Server) handleTenantConsole(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.tenantFor(r); !ok {
		s.serveConsolePage(w, r, http.StatusNotFound)
		return
	}
	s.console.ServeHTTP(w, r)
}

// serveConsolePage answers with the app under a status of the caller's
// choosing: a protocol endpoint that refuses in the browser still says so in
// its status line, and the page it serves explains why.
func (s *Server) serveConsolePage(w http.ResponseWriter, r *http.Request, status int) {
	if status == http.StatusOK {
		s.console.ServeHTTP(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	page, err := fs.ReadFile(s.bundle, "index.html")
	if err != nil {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(status)
		if r.Method != http.MethodHead {
			_, _ = io.WriteString(w, webconsole.NotBuiltPage(consoleBuildCommand))
		}
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if r.Method != http.MethodHead {
		_, _ = w.Write(page)
	}
}
