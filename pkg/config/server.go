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
)

// Server configures HTTP listen address, graceful shutdown, and request body cap.
type Server struct {
	Addr                string `env:"ADDR"`
	GracefulSeconds     int    `env:"GRACEFUL_SECONDS"`
	MaxRequestBodyBytes int64  `env:"MAX_REQUEST_BODY_BYTES"`
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
