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
	// DefaultMaxRequestBodyBytes caps inbound request bodies. The pipeline
	// reads the body fully into memory (MaterializeBody) for policy,
	// guardrail and cache inspection, so peak RAM scales with this cap
	// times in-flight requests, and the cap is what keeps a drive-by scan
	// from pressuring the pod memory limit. 32 MiB fits a 1M-context
	// multimodal payload with margin under a 512 Mi pod limit. Workloads
	// that legitimately send more, such as multi-image vision against the
	// largest context windows, raise SERVER_MAX_REQUEST_BODY_BYTES on the
	// deployment that needs it rather than everywhere.
	//
	// The docs, the Helm chart and this constant state the same number.
	// TestDefaultMaxRequestBodyBytesMatchesChart pins it against the chart
	// so the three cannot drift apart again.
	DefaultMaxRequestBodyBytes = 32 * 1024 * 1024
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
	// DrainDelaySeconds is how long a service waits, after flipping /readyz
	// to draining but before it stops accepting new connections, for a load
	// balancer to actually notice and stop routing traffic here. Consumed
	// directly by pkg/lifecycle.WithDrainDelay by services that opt in —
	// setting it here alone does nothing; a service's serve.go must read it
	// and pass it through. 0 is a valid, explicit "no delay" for services
	// that don't set this field at all; pkg/lifecycle's own 3s default only
	// applies when a service never calls WithDrainDelay in the first place.
	DrainDelaySeconds int `env:"DRAIN_DELAY_SECONDS"`
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
