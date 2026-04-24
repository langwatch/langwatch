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
	// DefaultMaxRequestBodyBytes sizes the body cap for 1M-context LLM
	// workloads where a single request can legitimately carry multi-MB
	// prompts (vision images, long tool-result blocks, 750K-token context).
	// Earlier iters used 2 MiB which 413-rejected real enterprise traffic.
	// 32 MiB gives ~2× headroom over observed worst-case (Gemini 1.5 Pro
	// with full context + images ≈ 15 MB) while preserving DDoS protection.
	DefaultMaxRequestBodyBytes = 32 * 1024 * 1024
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
