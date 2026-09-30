package storagesim

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/langwatch/langwatch/pkg/webconsole"
)

// consoleBuildCommand is what the not-built page tells a developer to run.
const consoleBuildCommand = "pnpm --filter @langwatch/storagesim-web build"

// consoleFiles is apps/storagesim-web's Vite build (ADR-160), built with base
// /_sim/. Only web/dist/.gitkeep is committed, so a binary built before the
// bundle serves the not-built page instead.
//
//go:embed all:web/dist
var consoleFiles embed.FS

// embeddedConsole is the bundle this binary was built with.
func embeddedConsole() fs.FS {
	bundle, err := fs.Sub(consoleFiles, "web/dist")
	if err != nil {
		panic(err) // the path is a constant that go:embed has already resolved
	}
	return bundle
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
