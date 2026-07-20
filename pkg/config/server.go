package config

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

const (
	DefaultGracefulSeconds = 5
	// DefaultMaxRequestBodyBytes sizes the body cap for large-context LLM
	// workloads where a single request can legitimately carry tens of MB:
	// a 10M-token text context JSON-encodes to ~40-50 MB, on top of vision
	// images and long tool-result blocks. The pipeline reads the body fully
	// into memory (MaterializeBody) for policy / guardrail / cache
	// inspection, so peak RAM scales with this cap times in-flight requests
	// — 128 MiB keeps that bounded for DDoS protection while leaving
	// headroom over a 10M-token request. Deployments that send multi-hundred-MB
	// media or run tighter memory should override MAX_REQUEST_BODY_BYTES.
	DefaultMaxRequestBodyBytes = 128 * 1024 * 1024
	// DefaultNonStreamingHeartbeatInterval bounds how long a non-streaming
	// response can go completely silent while a large-context completion
	// is still in flight. Edge proxies in front of the gateway (Cloudflare's
	// default is ~100s) kill a connection that receives zero response bytes
	// within their idle window, even though the origin is healthy and still
	// working — see https://github.com/langwatch/langwatch/issues/4806.
	// 45s leaves better than 2x margin under Cloudflare's default while
	// leaving fast requests (the overwhelming majority) completely
	// unaffected: only a dispatch slower than this ever emits a heartbeat.
	DefaultNonStreamingHeartbeatInterval = 45 * time.Second
)

// Server configures HTTP listen address, graceful shutdown, and request body cap.
type Server struct {
	Addr                string `env:"ADDR"`
	GracefulSeconds     int    `env:"GRACEFUL_SECONDS"`
	MaxRequestBodyBytes int64  `env:"MAX_REQUEST_BODY_BYTES"`
	// NonStreamingHeartbeatIntervalSeconds sets how often (in seconds) a
	// non-streaming response writes a keep-alive byte while dispatch is
	// still in flight. 0 falls back to DefaultNonStreamingHeartbeatInterval;
	// negative disables heartbeating entirely. Plain seconds, not a Go
	// duration string ("45s") — config.Hydrate parses time.Duration fields
	// as raw nanosecond integers (setField's int64 branch), not via
	// time.ParseDuration, so "45s" would fail to parse and a correct value
	// would have to be an opaque nanosecond count. Plain seconds sidesteps
	// that trap entirely.
	NonStreamingHeartbeatIntervalSeconds int64 `env:"NON_STREAMING_HEARTBEAT_INTERVAL_SECONDS"`
}

// ListenAndServe starts the server and handles graceful shutdown on SIGTERM/SIGINT.
func (cfg *Server) ListenAndServe(srv *http.Server) error {
	if srv.Addr == "" {
		srv.Addr = cfg.Addr
	}
	if cfg.GracefulSeconds == 0 {
		cfg.GracefulSeconds = DefaultGracefulSeconds
	}

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM, syscall.SIGINT)

	errs := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			errs <- err
		}
	}()

	select {
	case err := <-errs:
		return err
	case <-stop:
		if cfg.GracefulSeconds > 0 {
			ctx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.GracefulSeconds)*time.Second)
			defer cancel()
			return srv.Shutdown(ctx)
		}
		return nil
	}
}
