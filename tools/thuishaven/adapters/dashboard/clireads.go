package dashboard

import (
	"fmt"
	"net/http"
	"sort"
)

// CLIRead answers one `haven <name> --json` for a stack: the rows the command
// prints, read through the same datasource, so the stack console and the CLI
// cannot disagree (ADR-064 amendment 2026-10-10, output contract).
type CLIRead func(slug string) (any, error)

// cliReadJSON is the {"v":1,...} envelope every --json output carries.
type cliReadJSON struct {
	V     int    `json:"v"`
	Stack string `json:"stack"`
	Rows  any    `json:"rows"`
}

type cliReadErrorJSON struct {
	Error string   `json:"error"`
	Valid []string `json:"valid,omitempty"`
}

// handleCLIRead is GET /api/stacks/{slug}/cli/{name}: one CLI read for a known
// stack. An unknown name is a 404 naming the valid ones, as exit 2 does.
func (s *Server) handleCLIRead(w http.ResponseWriter, r *http.Request) {
	slug, name := r.PathValue("slug"), r.PathValue("name")
	read, ok := s.reads[name]
	if !ok {
		writeJSON(w, http.StatusNotFound, cliReadErrorJSON{Error: fmt.Sprintf("no CLI read %q", name), Valid: s.cliReadNames()})
		return
	}
	if !s.knownHome(w, slug) {
		return
	}
	rows, err := read(slug)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, cliReadErrorJSON{Error: err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, cliReadJSON{V: 1, Stack: slug, Rows: rows})
}

func (s *Server) cliReadNames() []string {
	names := make([]string, 0, len(s.reads))
	for name := range s.reads {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
