package otelsetup

import (
	"context"
	"errors"
	"sync"

	otelapi "go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
	"go.opentelemetry.io/otel/trace/embedded"

	"github.com/langwatch/langwatch/pkg/contexts"
)

// serviceTracers is the global tracer provider once two services share a
// process (cmd/service combined). A span starts on the provider of the service
// its context names, so each keeps its own resource, exporters and tenant
// routing. A process with one service installs that service's provider as
// the global directly, exactly as before.
type serviceTracers struct {
	embedded.TracerProvider
	mu        sync.RWMutex
	providers map[string]*sdktrace.TracerProvider
	last      *sdktrace.TracerProvider
}

var globalTracers = &serviceTracers{providers: map[string]*sdktrace.TracerProvider{}}

// installTracerProvider registers a service's provider and sets the global.
func installTracerProvider(service string, tp *sdktrace.TracerProvider) {
	globalTracers.mu.Lock()
	globalTracers.providers[service] = tp
	globalTracers.last = tp
	isShared := len(globalTracers.providers) > 1
	globalTracers.mu.Unlock()
	if isShared {
		otelapi.SetTracerProvider(globalTracers)
		return
	}
	otelapi.SetTracerProvider(tp)
}

// forContext is the provider of the service ctx names. A context naming no
// registered service falls back to the latest registered, as the global was.
func (s *serviceTracers) forContext(ctx context.Context) *sdktrace.TracerProvider {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if info := contexts.GetServiceInfo(ctx); info != nil {
		if tp, ok := s.providers[info.Service]; ok {
			return tp
		}
	}
	return s.last
}

// Tracer defers the choice of provider to each span's start.
func (s *serviceTracers) Tracer(name string, opts ...trace.TracerOption) trace.Tracer {
	return &serviceTracer{tracers: s, name: name, opts: opts}
}

// ForceFlush flushes every service's provider, for ForceFlushGlobal.
func (s *serviceTracers) ForceFlush(ctx context.Context) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var errs []error
	for _, tp := range s.providers {
		errs = append(errs, tp.ForceFlush(ctx))
	}
	return errors.Join(errs...)
}

type serviceTracer struct {
	embedded.Tracer
	tracers *serviceTracers
	name    string
	opts    []trace.TracerOption
}

// Start hands the span to its caller, who ends it, like any trace.Tracer.
func (t *serviceTracer) Start(ctx context.Context, spanName string, opts ...trace.SpanStartOption) (context.Context, trace.Span) {
	return t.tracers.forContext(ctx).Tracer(t.name, t.opts...).Start(ctx, spanName, opts...) //nolint:spancheck // a Tracer implementation returns its span unended
}
