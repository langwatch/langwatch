package dashboard

import (
	"errors"
	"net/http"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/orbstore"
)

// cliReads is config.CLIReads plus `orb feedback list`, `orb console` and
// `orb network`, read from the same orb store the CLI reads.
func (s *Server) cliReads() map[string]CLIRead {
	reads := make(map[string]CLIRead, len(s.config.CLIReads)+3)
	for name, read := range s.config.CLIReads {
		reads[name] = read
	}
	if s.config.LogDir == nil {
		return reads
	}
	store := func(slug string) orbstore.Store { return orbstore.At(s.config.LogDir(slug)) }
	reads["feedback"] = func(slug string) (any, error) { return store(slug).List() }
	reads["console"] = func(slug string) (any, error) {
		page, err := store(slug).Page()
		return page.Console, err
	}
	reads["network"] = func(slug string) (any, error) {
		page, err := store(slug).Page()
		return page.Network, err
	}
	return reads
}

// handleFeedbackResolve is `haven orb feedback resolve <id>` from the stack console.
func (s *Server) handleFeedbackResolve(w http.ResponseWriter, r *http.Request) {
	if !guardAction(w, r) {
		return
	}
	slug := r.PathValue("slug")
	if s.config.LogDir == nil || !s.knownLogStack(slug) {
		http.Error(w, "unknown stack", http.StatusNotFound)
		return
	}
	item, err := orbstore.At(s.config.LogDir(slug)).Resolve(r.PathValue("id"), time.Now())
	if errors.Is(err, orbstore.ErrNotFound) {
		http.Error(w, "no such feedback", http.StatusNotFound)
		return
	}
	writeActionResult(w, "resolved "+item.ID, err)
}
