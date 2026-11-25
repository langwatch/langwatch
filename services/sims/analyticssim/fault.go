package analyticssim

import (
	"encoding/json"
	"net/http"
	"sync/atomic"
)

// forcedError is the status every capture call answers with; 0 is off.
type forcedError struct{ status atomic.Int32 }

// keep stores a call's records and answers ok; while a forced error is set it
// stores them marked with that status and answers it, so the refused attempt shows.
func (s *Server) keep(w http.ResponseWriter, records []Record, ok any) {
	status := int(s.fault.status.Load())
	for i := range records {
		records[i].Status = status
	}
	s.records.add(records, s.now())
	if status != 0 {
		writeError(w, status, "analyticssim: forced error")
		return
	}
	writeJSON(w, http.StatusOK, ok)
}

// handleSettings is GET and PUT /_sim/api/settings, {"forcedError": 0 | 4xx | 5xx}.
func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPut {
		var next struct {
			ForcedError int `json:"forcedError"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&next); err != nil {
			writeError(w, http.StatusBadRequest, "settings body is not JSON: "+err.Error())
			return
		}
		if next.ForcedError != 0 && (next.ForcedError < 400 || next.ForcedError > 599) {
			writeError(w, http.StatusBadRequest, "forcedError is 0 (off) or a 4xx/5xx status")
			return
		}
		s.fault.status.Store(int32(next.ForcedError))
	}
	writeJSON(w, http.StatusOK, map[string]int{"forcedError": int(s.fault.status.Load())})
}
