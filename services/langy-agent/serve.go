package langyagent

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"go.uber.org/zap"
)

// Serve wires the HTTP listener to the Manager and blocks until SIGTERM /
// SIGINT or ctx cancellation. Mirrors the JS manager's lifecycle (start
// reaper, accept traffic, drain on shutdown).
func Serve(ctx context.Context, cfg Config, log *zap.Logger) error {
	mgr, err := NewManager(cfg, log)
	if err != nil {
		return fmt.Errorf("manager init: %w", err)
	}
	mgr.StartReaper()

	srv := &http.Server{
		Addr:              fmt.Sprintf(":%d", cfg.Port),
		Handler:           newRouter(mgr, cfg, log),
		ReadHeaderTimeout: 10 * time.Second,
		// No ReadTimeout / WriteTimeout — /chat streams arbitrarily long
		// ndjson responses (the worker keeps producing for as long as the
		// LLM keeps generating). Per-handler cancellation drives the deadline
		// instead.
	}

	// Signal handling: SIGTERM (k8s pod shutdown) + SIGINT (local dev) both
	// kick the graceful shutdown path. Reuses ctx so cmd/service callers
	// that cancel directly get the same behaviour.
	stopCtx, cancel := signal.NotifyContext(ctx, syscall.SIGTERM, syscall.SIGINT)
	defer cancel()

	listenErr := make(chan error, 1)
	go func() {
		log.Info("langy manager listening",
			zap.String("addr", srv.Addr),
			zap.Int("max_workers", cfg.MaxWorkers),
		)
		listenErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-listenErr:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		// Surface bind errors directly: a misconfigured PORT or a port
		// collision must fail loudly, not be quietly swallowed by the
		// shutdown path below.
		var opErr *net.OpError
		if errors.As(err, &opErr) {
			return fmt.Errorf("http listen: %w", err)
		}
		return err
	case <-stopCtx.Done():
		log.Info("shutdown signal received, draining")
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), cfg.GracefulShutdown)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Warn("http shutdown error", zap.Error(err))
	}
	mgr.Shutdown()

	// If the server returned an error during shutdown drain it doesn't
	// surface from Shutdown — read the leftover listenErr to keep the
	// goroutine from blocking.
	select {
	case err := <-listenErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	default:
	}

	return nil
}
