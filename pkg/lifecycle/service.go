// Package lifecycle manages ordered start/stop of services with graceful shutdown.
package lifecycle

import (
	"context"
	"errors"
	"net"
	"net/http"
)

// Service is a managed component with a start/stop lifecycle.
// Services are started in registration order and stopped in reverse.
type Service interface {
	String() string
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
}

// fatalReporter is optionally implemented by services that can fail
// asynchronously after Start (e.g. an HTTP server whose accept loop dies).
type fatalReporter interface {
	Fatal() <-chan error
}

// --- Adapters ---

// Closer creates a Service that only needs shutdown cleanup (no start phase).
// Useful for resources like OTel TracerProviders.
func Closer(name string, stop func(ctx context.Context) error) Service {
	return &closerSvc{name: name, stopFn: stop}
}

type closerSvc struct {
	name   string
	stopFn func(ctx context.Context) error
}

func (c *closerSvc) String() string                 { return c.name }
func (c *closerSvc) Start(context.Context) error    { return nil }
func (c *closerSvc) Stop(ctx context.Context) error { return c.stopFn(ctx) }

// Worker creates a Service from a fire-and-forget start and a synchronous stop.
// The start function receives the group's cancellable context.
// Stop is bounded by the shutdown context's deadline.
func Worker(name string, start func(ctx context.Context), stop func()) Service {
	return &workerSvc{name: name, startFn: start, stopFn: stop}
}

type workerSvc struct {
	name    string
	startFn func(ctx context.Context)
	stopFn  func()
}

func (w *workerSvc) String() string { return w.name }

func (w *workerSvc) Start(ctx context.Context) error {
	w.startFn(ctx)
	return nil
}

func (w *workerSvc) Stop(ctx context.Context) error {
	done := make(chan struct{})
	go func() {
		w.stopFn()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// ListenServer creates a Service that wraps an *http.Server.
// Start launches ListenAndServe in a goroutine; Stop calls Shutdown.
// It implements fatalReporter so the group can detect accept-loop failures.
func ListenServer(name string, srv *http.Server) Service {
	return &listenSvc{name: name, srv: srv}
}

type listenSvc struct {
	name    string
	srv     *http.Server
	fatalCh chan error
}

func (l *listenSvc) String() string { return l.name }

func (l *listenSvc) Start(ctx context.Context) error {
	// Detach so in-flight requests keep context values (logger, tracing)
	// but aren't canceled when the group's context is canceled during shutdown.
	// Requests finish naturally, bounded by Shutdown's graceful timeout.
	l.srv.BaseContext = func(_ net.Listener) context.Context {
		return context.WithoutCancel(ctx)
	}
	l.fatalCh = make(chan error, 1)
	go func() {
		defer close(l.fatalCh)
		if err := l.srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
			l.fatalCh <- err
		}
	}()
	return nil
}

func (l *listenSvc) Stop(ctx context.Context) error {
	return l.srv.Shutdown(ctx)
}

func (l *listenSvc) Fatal() <-chan error { return l.fatalCh }
