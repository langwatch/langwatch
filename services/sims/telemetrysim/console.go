package telemetrysim

import (
	"io/fs"
	"net/http"

	"github.com/langwatch/langwatch/services/sims/simconsole"
)

// consoleBuildCommand is what the not-built page tells a developer to run.
const consoleBuildCommand = simconsole.BuildCommand

// embeddedConsole is the telemetry page of the apps/sims build this binary embeds (ADR-160).
func embeddedConsole() fs.FS {
	return simconsole.Page("telemetry")
}

// handleConsole serves the console bundle at every path the API does not take.
func (s *Server) handleConsole(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Security-Policy",
		"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
	s.console.ServeHTTP(w, r)
}
