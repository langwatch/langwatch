package dashboard

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/langwatch/langwatch/pkg/webconsole"
)

// consoleBuildCommand is what the not-built page tells a developer to run.
const consoleBuildCommand = "make haven-web"

// consoleFiles is apps/haven-web's Vite build (ADR-160). Only web/dist/.gitkeep
// is committed, so a binary built before `make haven-web` embeds no index.html
// and serves the not-built page instead.
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
	if bundle == nil {
		bundle = embeddedConsole()
	}
	return webconsole.New(bundle, consoleBuildCommand)
}

// isStackHome reports whether a request's Host is a worktree's home,
// <slug>.langwatch.localhost, rather than the hub.
func (s *Server) isStackHome(r *http.Request) bool {
	_, ok := s.config.Naming.StackHomeSlug(r.Host)
	return ok
}
