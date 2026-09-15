package mailsim

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"

	"github.com/emersion/go-smtp"
)

// defaultWaitTimeout is how long GET /api/messages/wait blocks when the
// caller does not name one.
const defaultWaitTimeout = 30 * time.Second

// Server is the sink: the message store, the SMTP intake and the HTTP API +
// browser inbox over it.
type Server struct {
	cfg   Config
	store *Store
	mux   *http.ServeMux
	http  *http.Server
	smtp  *smtp.Server
}

// NewServer wires the store, the SMTP intake and the HTTP surface together.
func NewServer(cfg Config) (*Server, error) {
	store, err := NewStore(cfg.DataDir)
	if err != nil {
		return nil, err
	}
	s := &Server{cfg: cfg, store: store}
	s.mux = s.buildMux()
	s.http = &http.Server{Handler: s.mux, ReadHeaderTimeout: 10 * time.Second}
	s.smtp = newSMTPServer(cfg.SMTPAddr, store, cfg.MaxMessageBytes)
	return s, nil
}

// Handler is the HTTP surface alone, for tests that drive it without a real
// listener.
func (s *Server) Handler() http.Handler {
	return s.mux
}

func (s *Server) buildMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /api/messages", s.handleListMessages)
	mux.HandleFunc("GET /api/messages/wait", s.handleWaitMessage)
	mux.HandleFunc("GET /api/messages/{id}", s.handleGetMessage)
	mux.HandleFunc("GET /api/messages/{id}/html", s.handleGetMessageHTML)
	mux.HandleFunc("DELETE /api/messages", s.handleClearMessages)
	mux.HandleFunc("DELETE /api/messages/{id}", s.handleDeleteMessage)
	mux.HandleFunc("GET /messages/{id}", s.handleUIMessage)
	mux.HandleFunc("GET /", s.handleUIIndex)
	return mux
}

// setBaseHeaders is the pair every response carries, API or UI, JSON or
// HTML: nothing sniffs the content type, and nothing learns where a link
// inside the inbox was clicked from.
func setBaseHeaders(w http.ResponseWriter) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
}

// setAPIHeaders is the base pair plus the JSON API's own three: never
// cached, never framed, and a CSP that agrees. Every handler here is a
// same-origin JSON or plain-text response with nothing worth framing.
func setAPIHeaders(w http.ResponseWriter) {
	setBaseHeaders(w)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Security-Policy", "frame-ancestors 'none'")
}

// setUIHeaders is the base pair plus the browser inbox's own CSP — the page
// itself is trusted (it is this service's own markup), but it must not load
// or run anything a caught message could have smuggled in as a same-origin
// resource.
func setUIHeaders(w http.ResponseWriter) {
	setBaseHeaders(w)
	w.Header().Set("Content-Security-Policy",
		"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "+
			"frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
}

// setCaughtHTMLHeaders is deliberately not built from setAPIHeaders or
// setUIHeaders: a caught message's HTML is untrusted input, not this
// service's own page and not a JSON answer, so it gets its own header shape
// rather than inheriting either. `sandbox` with no token blocks scripts,
// forms, popups and top-level navigation; `default-src 'none'` refuses every
// network fetch a tracking pixel might attempt; X-Frame-Options: SAMEORIGIN
// is what lets the inbox itself frame it while refusing every other page.
func setCaughtHTMLHeaders(w http.ResponseWriter) {
	setBaseHeaders(w)
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:")
	w.Header().Set("X-Frame-Options", "SAMEORIGIN")
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeNotFound(w http.ResponseWriter) {
	writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_found"})
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	setAPIHeaders(w)
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (s *Server) handleListMessages(w http.ResponseWriter, r *http.Request) {
	setAPIHeaders(w)
	messages := s.store.List(r.URL.Query().Get("to"), r.URL.Query().Get("subject"))
	writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
}

func (s *Server) handleGetMessage(w http.ResponseWriter, r *http.Request) {
	setAPIHeaders(w)
	msg, ok := s.store.Get(r.PathValue("id"))
	if !ok {
		writeNotFound(w)
		return
	}
	writeJSON(w, http.StatusOK, msg)
}

func (s *Server) handleGetMessageHTML(w http.ResponseWriter, r *http.Request) {
	setCaughtHTMLHeaders(w)
	msg, ok := s.store.Get(r.PathValue("id"))
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(msg.HTML))
}

func (s *Server) handleWaitMessage(w http.ResponseWriter, r *http.Request) {
	setAPIHeaders(w)
	timeout := defaultWaitTimeout
	if raw := r.URL.Query().Get("timeout"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			timeout = d
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	msg, ok := s.store.Wait(ctx, r.URL.Query().Get("to"), r.URL.Query().Get("subject"))
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSON(w, http.StatusOK, msg)
}

func (s *Server) handleClearMessages(w http.ResponseWriter, _ *http.Request) {
	setAPIHeaders(w)
	s.store.Clear()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteMessage(w http.ResponseWriter, r *http.Request) {
	setAPIHeaders(w)
	if !s.store.Delete(r.PathValue("id")) {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Serve runs the HTTP and SMTP listeners until ctx ends, then shuts down
// both gracefully. Neither listener starting is optional — a mail sink
// missing either half looks identical to a healthy one until a message was
// expected to have been caught.
func (s *Server) Serve(ctx context.Context) error {
	var lc net.ListenConfig
	httpListener, err := lc.Listen(ctx, "tcp", s.cfg.HTTPAddr)
	if err != nil {
		return fmt.Errorf("binding %s: %w", s.cfg.HTTPAddr, err)
	}
	smtpListener, err := lc.Listen(ctx, "tcp", s.cfg.SMTPAddr)
	if err != nil {
		return fmt.Errorf("binding %s: %w", s.cfg.SMTPAddr, err)
	}

	errCh := make(chan error, 2)
	go func() { errCh <- s.http.Serve(httpListener) }()
	go func() { errCh <- s.smtp.Serve(smtpListener) }()

	select {
	case <-ctx.Done():
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = s.http.Shutdown(shutdownCtx)
		_ = s.smtp.Shutdown(shutdownCtx)
		return nil
	case err := <-errCh:
		if errors.Is(err, http.ErrServerClosed) || errors.Is(err, smtp.ErrServerClosed) {
			return nil
		}
		return err
	}
}
