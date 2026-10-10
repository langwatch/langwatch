package storagesim

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
)

// forcedError is the status PUT and GET object calls answer with; 0 is off.
type forcedError struct{ status atomic.Int32 }

// handleSettings is GET and PUT /_sim/api/settings, {"forcedError": 0 | 4xx | 5xx}.
func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
	case http.MethodPut:
		var next struct {
			ForcedError int `json:"forcedError"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&next); err != nil {
			writeAPIError(w, http.StatusBadRequest, "settings body is not JSON: "+err.Error())
			return
		}
		if next.ForcedError != 0 && (next.ForcedError < 400 || next.ForcedError > 599) {
			writeAPIError(w, http.StatusBadRequest, "forcedError is 0 (off) or a 4xx/5xx status")
			return
		}
		s.fault.status.Store(int32(next.ForcedError)) //nolint:gosec // bounded to 0 or 400-599 above
	default:
		writeAPIError(w, http.StatusMethodNotAllowed, "settings is a GET or a PUT")
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"forcedError": int(s.fault.status.Load())})
}
