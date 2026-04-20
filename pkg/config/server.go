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

const DefaultGracefulSeconds = 5

// Server configures HTTP listen address and graceful shutdown.
type Server struct {
	Addr            string `env:"ADDR"`
	GracefulSeconds int    `env:"GRACEFUL_SECONDS"`
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
