package mailsim

import (
	"encoding/json"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/emersion/go-smtp"
)

// forcedError is the SMTP reply code every send is refused with; 0 is off.
// It also keeps the sends it refused, so the failed attempts show.
type forcedError struct {
	status atomic.Int32
	mu     sync.Mutex
	tally  refusals
}

// refusals is how many sends the forced error refused, and the newest one.
type refusals struct {
	Refused int      `json:"refused"`
	Last    *refusal `json:"lastRefused,omitempty"`
}

type refusal struct {
	From string    `json:"from"`
	Code int       `json:"code"`
	At   time.Time `json:"at"`
}

// refusal is the SMTP error a send from `from` gets while a forced error is set, else nil.
func (f *forcedError) refusal(from string) error {
	code := int(f.status.Load())
	if code == 0 {
		return nil
	}
	f.mu.Lock()
	f.tally.Refused++
	f.tally.Last = &refusal{From: from, Code: code, At: time.Now().UTC()}
	f.mu.Unlock()
	return &smtp.SMTPError{Code: code, EnhancedCode: smtp.EnhancedCode{code / 100, 0, 0}, Message: "mailsim: forced error"}
}

// handleSettings is GET and PUT /_sim/api/settings, {"forcedError": 0 | 4xx | 5xx};
// the answer adds the refusals the forced error made.
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
		s.fault.status.Store(int32(next.ForcedError))
	}
	s.fault.mu.Lock()
	tally := s.fault.tally
	s.fault.mu.Unlock()
	writeJSON(w, http.StatusOK, struct {
		ForcedError int `json:"forcedError"`
		refusals
	}{int(s.fault.status.Load()), tally})
}
