package storagesim

import (
	"io/fs"
	"net/http"

	"github.com/langwatch/langwatch/pkg/webconsole"
	"github.com/langwatch/langwatch/services/sims/simconsole"
)

// consoleBuildCommand is what the not-built page tells a developer to run.
const consoleBuildCommand = simconsole.BuildCommand

// embeddedConsole is the storage page of the apps/sims build this binary embeds (ADR-160).
func embeddedConsole() fs.FS {
	return simconsole.Page("storage")
}

func newConsole(bundle fs.FS) http.Handler {
	return http.StripPrefix("/_sim", webconsole.New(bundle, consoleBuildCommand))
}

// serveConsole answers everything under /_sim: the JSON API, else the bundle.
// Buckets are the first path segment of an S3 call, so the console lives on
// the one prefix a bucket may not use.
func (s *Server) serveConsole(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/_sim" {
		http.Redirect(w, r, "/_sim/", http.StatusFound)
		return
	}
	if api, ok := s.consoleAPI(r.URL.Path); ok {
		api(w, r)
		return
	}
	s.console.ServeHTTP(w, r)
}
