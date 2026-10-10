package analyticssim

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/langwatch/langwatch/pkg/webconsole"
)

// consoleBuildCommand is what the not-built page tells a developer to run.
const consoleBuildCommand = "pnpm --filter @langwatch/analyticssim-web build"

// consoleFiles is apps/analyticssim-web's Vite build (ADR-160). Only web/dist/.gitkeep
// is committed, so a binary built before the bundle embeds no index.html and
// serves the not-built page instead.
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
	return webconsole.New(bundle, consoleBuildCommand)
}

// handleConsole serves the console bundle at every path the API does not take.
func (s *Server) handleConsole(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy",
		"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
	s.console.ServeHTTP(w, r)
}
