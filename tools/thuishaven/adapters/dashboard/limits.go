package dashboard

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Limits are the machine resource limits the page shows and edits. Set and
// Unset answer the one line a toast shows, as Actions do.
type Limits struct {
	Report func() domain.LimitsReport
	Set    func(name string, value int) (string, error)
	Unset  func(name string) (string, error)
}

func (s *Server) handleLimits(w http.ResponseWriter, _ *http.Request) {
	if s.config.Limits.Report == nil {
		http.Error(w, "this haven has no machine limits", http.StatusNotImplemented)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, s.config.Limits.Report())
}

// handleSetLimit takes {"value": <whole number>}; the composition root validates
// the bounds, so a refusal reaches the page as the same error line a toast shows.
func (s *Server) handleSetLimit(w http.ResponseWriter, r *http.Request) {
	if !guardMethod(w, r, http.MethodPut) {
		return
	}
	if s.config.Limits.Set == nil {
		http.Error(w, "this haven cannot set a limit", http.StatusNotImplemented)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxActionBody))
	if err != nil {
		http.Error(w, "could not read the request", http.StatusBadRequest)
		return
	}
	var req struct {
		Value *int `json:"value"`
	}
	if jerr := json.Unmarshal(body, &req); jerr != nil || req.Value == nil {
		http.Error(w, `send {"value": <whole number>}`, http.StatusBadRequest)
		return
	}
	message, err := s.config.Limits.Set(r.PathValue("name"), *req.Value)
	writeActionResult(w, message, err)
}

func (s *Server) handleUnsetLimit(w http.ResponseWriter, r *http.Request) {
	if !guardMethod(w, r, http.MethodDelete) {
		return
	}
	if s.config.Limits.Unset == nil {
		http.Error(w, "this haven cannot unset a limit", http.StatusNotImplemented)
		return
	}
	message, err := s.config.Limits.Unset(r.PathValue("name"))
	writeActionResult(w, message, err)
}
