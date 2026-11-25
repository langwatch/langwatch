package dashboard

import (
	"context"
	"encoding/json"
	"io"
	"net/http"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// MachineSettings are the machine switches the Settings page shows and flips:
// the same rows and the same Set `haven machine settings` uses. An empty value
// restores the default.
type MachineSettings struct {
	Report func() []domain.MachineSettingView
	Set    func(ctx context.Context, name, value string) (string, error)
}

func (s *Server) handleMachineSettings(w http.ResponseWriter, _ *http.Request) {
	if s.config.MachineSettings.Report == nil {
		http.Error(w, "this haven has no machine settings", http.StatusNotImplemented)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]any{"settings": s.config.MachineSettings.Report()})
}

// handleSetMachineSetting takes {"value": "<on|off|minutes>"}; DELETE restores
// the default. A refusal reaches the page as the line a toast shows.
func (s *Server) handleSetMachineSetting(w http.ResponseWriter, r *http.Request) {
	if !guardMethod(w, r, r.Method) {
		return
	}
	if s.config.MachineSettings.Set == nil {
		http.Error(w, "this haven cannot change a machine setting", http.StatusNotImplemented)
		return
	}
	value := ""
	if r.Method == http.MethodPut {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxActionBody))
		if err != nil {
			http.Error(w, "could not read the request", http.StatusBadRequest)
			return
		}
		var req struct {
			Value *string `json:"value"`
		}
		if jerr := json.Unmarshal(body, &req); jerr != nil || req.Value == nil {
			http.Error(w, `send {"value": "<on|off|minutes>"}`, http.StatusBadRequest)
			return
		}
		value = *req.Value
	}
	message, err := s.config.MachineSettings.Set(r.Context(), r.PathValue("name"), value)
	writeActionResult(w, message, err)
}
