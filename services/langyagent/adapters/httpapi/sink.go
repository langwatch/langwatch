package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

// errorEvent serialises an "error" ndjson event in the same shape the JS
// manager emitted, so the control-plane stream consumer is bit-compatible.
type errorEvent struct {
	Type  string `json:"type"`
	Error string `json:"error"`
}

// ndjsonSink adapts an http.ResponseWriter to app.ChatSink: raw ndjson lines
// over the wire, with idempotent 200 header commit and a flush on every event.
type ndjsonSink struct {
	w       http.ResponseWriter
	flusher http.Flusher
	begun   bool
}

var _ app.ChatSink = (*ndjsonSink)(nil)

func newNDJSONSink(w http.ResponseWriter) *ndjsonSink {
	f, _ := w.(http.Flusher)
	return &ndjsonSink{w: w, flusher: f}
}

// Begin commits the 200 status + ndjson headers. Idempotent so the app can call
// it on every streaming outcome without double-writing the header.
func (s *ndjsonSink) Begin() {
	if s.begun {
		return
	}
	s.begun = true
	s.w.Header().Set("Content-Type", "application/x-ndjson")
	s.w.Header().Set("Cache-Control", "no-cache")
	s.w.WriteHeader(http.StatusOK)
}

// Write emits raw ndjson bytes. The underlying ResponseWriter surfaces client
// disconnects as a write error, which streamSessionEvents uses to stop.
func (s *ndjsonSink) Write(p []byte) (int, error) {
	return s.w.Write(p)
}

// ErrorEvent emits {"type":"error","error":msg} as one ndjson line and flushes.
func (s *ndjsonSink) ErrorEvent(msg string) {
	b, _ := json.Marshal(errorEvent{Type: "error", Error: msg})
	_, _ = s.w.Write(append(b, '\n'))
	s.Flush()
}

// Flush pushes buffered bytes to the client.
func (s *ndjsonSink) Flush() {
	if s.flusher != nil {
		s.flusher.Flush()
	}
}
