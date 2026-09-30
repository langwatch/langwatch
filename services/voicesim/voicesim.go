// Package voicesim is a local stand-in for the voice providers a scenario voice
// call talks to: ElevenLabs Conversational AI (the signed URL and the
// conversation socket) and OpenAI's speech and transcription endpoints. Every
// answer is canned and deterministic: tones for audio, scripted agent lines,
// one fixed caller transcript. A console under /_sim shows recent calls.
//
// ponytail: keys and signatures are accepted, never checked. It is a dev shim; never expose it.
package voicesim

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"time"
)

// Config is voicesim's environment-derived configuration.
type Config struct {
	// Addr is the listen address (VOICESIM_ADDR, default :5591).
	Addr string
	// Stack is the haven stack slug the console names (VOICESIM_STACK, may be empty).
	Stack string
}

// LoadConfig reads voicesim's configuration from the environment.
func LoadConfig() Config {
	cfg := Config{Addr: os.Getenv("VOICESIM_ADDR"), Stack: os.Getenv("VOICESIM_STACK")}
	if cfg.Addr == "" {
		cfg.Addr = ":5591"
	}
	return cfg
}

// Server answers the provider calls and the console.
type Server struct {
	cfg     Config
	calls   callLog
	mux     *http.ServeMux
	console http.Handler
}

// NewServer builds the server over the embedded console bundle.
func NewServer(cfg Config) *Server {
	return newServer(cfg, embeddedConsole())
}

func newServer(cfg Config, bundle fs.FS) *Server {
	s := &Server{cfg: cfg, console: newConsole(bundle)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealthz)
	mux.HandleFunc("GET /v1/convai/conversation/get-signed-url", s.handleSignedURL)
	mux.HandleFunc("GET /v1/convai/conversation", s.handleConversation)
	mux.HandleFunc("POST /v1/audio/speech", s.handleSpeech)
	mux.HandleFunc("POST /v1/audio/transcriptions", s.handleTranscription)
	mux.HandleFunc("GET /_sim/api/status", s.handleStatus)
	mux.HandleFunc("GET /_sim/api/calls", s.handleCalls)
	// A provider or console path voicesim does not fake is a 404, never the console page.
	for _, pattern := range []string{"GET /v1/", "POST /v1/", "GET /_sim/api/"} {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			writeError(w, http.StatusNotFound, "voicesim does not fake "+r.Method+" "+r.URL.Path)
		})
	}
	mux.HandleFunc("GET /", s.handleConsole)
	s.mux = mux
	return s
}

// Handler is the whole HTTP surface, for tests that drive it without a listener.
func (s *Server) Handler() http.Handler {
	return s.mux
}

// Serve listens on cfg.Addr until ctx is done.
func (s *Server) Serve(ctx context.Context) error {
	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", s.cfg.Addr)
	if err != nil {
		return fmt.Errorf("binding %s: %w", s.cfg.Addr, err)
	}
	srv := &http.Server{Handler: s.mux, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()
	if err := srv.Serve(ln); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// writeError answers {"error": message}, the shape the console's fetch reads.
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (s *Server) handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// handleSignedURL is ElevenLabs' signed-URL mint: it points the client's
// socket back at this server, on the scheme and host the request came in on.
func (s *Server) handleSignedURL(w http.ResponseWriter, r *http.Request) {
	scheme := "ws"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		scheme = "wss"
	}
	query := url.Values{"agent_id": {r.URL.Query().Get("agent_id")}, "conversation_signature": {"voicesim"}}
	signed := url.URL{Scheme: scheme, Host: r.Host, Path: "/v1/convai/conversation", RawQuery: query.Encode()}
	writeJSON(w, http.StatusOK, map[string]string{"signed_url": signed.String()})
}

// handleSpeech is OpenAI's text-to-speech: a caller tone as long as the text,
// in the raw `pcm` format the scenario SDK asks for.
func (s *Server) handleSpeech(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Input          string `json:"input"`
		ResponseFormat string `json:"response_format"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeOpenAIError(w, "the body is not a JSON speech request: "+err.Error())
		return
	}
	if req.ResponseFormat != "" && req.ResponseFormat != "pcm" {
		writeOpenAIError(w, "voicesim answers response_format pcm only, not "+req.ResponseFormat)
		return
	}
	w.Header().Set("Content-Type", "audio/pcm")
	_, _ = w.Write(tone(req.Input, callerToneHz))
}

// handleTranscription is OpenAI's speech-to-text: whatever the audio, the
// canned caller transcript.
//
// ponytail: one fixed text; tell the caller and agent tones apart by frequency if a run ever needs it.
func (s *Server) handleTranscription(w http.ResponseWriter, r *http.Request) {
	_, _ = io.Copy(io.Discard, http.MaxBytesReader(w, r.Body, 64<<20))
	writeJSON(w, http.StatusOK, map[string]string{"text": CallerTranscript})
}

// writeOpenAIError answers 400 in OpenAI's error envelope, which its client reads.
func writeOpenAIError(w http.ResponseWriter, message string) {
	writeJSON(w, http.StatusBadRequest, map[string]any{
		"error": map[string]string{"message": message, "type": "invalid_request_error"},
	})
}

// consoleStatus is what the console header says about this simulator.
type consoleStatus struct {
	Stack             string `json:"stack"`
	Calls             int    `json:"calls"`
	ElevenLabsBaseURL string `json:"elevenLabsBaseUrl"`
	OpenAIBaseURL     string `json:"openaiBaseUrl"`
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	origin := "http://" + r.Host
	writeJSON(w, http.StatusOK, consoleStatus{
		Stack: s.cfg.Stack, Calls: s.calls.len(),
		ElevenLabsBaseURL: origin, OpenAIBaseURL: origin + "/v1",
	})
}

func (s *Server) handleCalls(w http.ResponseWriter, _ *http.Request) {
	raw, err := s.calls.marshal()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(raw)
}
