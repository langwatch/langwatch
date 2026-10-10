package mailsim

import (
	"encoding/json"
	"net/http"
	"sync/atomic"

	"github.com/emersion/go-smtp"
)

// forcedError is the SMTP reply code every send is refused with; 0 is off.
type forcedError struct{ status atomic.Int32 }

// refusal is the SMTP error a send gets while a forced error is set, else nil.
func (f *forcedError) refusal() error {
	code := int(f.status.Load())
	if code == 0 {
		return nil
	}
	return &smtp.SMTPError{Code: code, EnhancedCode: smtp.EnhancedCode{code / 100, 0, 0}, Message: "mailsim: forced error"}
}

// handleSettings is GET and PUT /_sim/api/settings, {"forcedError": 0 | 4xx | 5xx}.
func (s *Server) handleSettings(w http.ResponseWriter, r *http.Request) {
	setAPIHeaders(w)
	if r.Method == http.MethodPut {
		var next struct {
			ForcedError int `json:"forcedError"`
		}
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&next); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "settings body is not JSON: " + err.Error()})
			return
		}
		if next.ForcedError != 0 && (next.ForcedError < 400 || next.ForcedError > 599) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "forcedError is 0 (off) or a 4xx/5xx status"})
			return
		}
		s.fault.status.Store(int32(next.ForcedError)) //nolint:gosec // bounded to 0 or 400-599 above
	}
	writeJSON(w, http.StatusOK, map[string]int{"forcedError": int(s.fault.status.Load())})
}
