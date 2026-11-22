package otelsetup

import (
	"context"
	"errors"
	"sync"

	otelapi "go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/metric/embedded"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"

	"github.com/langwatch/langwatch/pkg/contexts"
)

// serviceMeters is the global meter provider once two services share a
// process, as serviceTracers is for spans: a measurement lands on the provider
// of the service its context names. One service installs its own directly.
type serviceMeters struct {
	embedded.MeterProvider
	mu        sync.RWMutex
	providers map[string]*sdkmetric.MeterProvider
	last      *sdkmetric.MeterProvider
}

var globalMeters = &serviceMeters{providers: map[string]*sdkmetric.MeterProvider{}}

// installMeterProvider registers a service's provider and sets the global.
func installMeterProvider(service string, mp *sdkmetric.MeterProvider) {
	globalMeters.mu.Lock()
	globalMeters.providers[service] = mp
	globalMeters.last = mp
	isShared := len(globalMeters.providers) > 1
	globalMeters.mu.Unlock()
	if isShared {
		otelapi.SetMeterProvider(globalMeters)
		return
	}
	otelapi.SetMeterProvider(mp)
}

// forContext is the provider of the service ctx names, else the latest.
func (s *serviceMeters) forContext(ctx context.Context) *sdkmetric.MeterProvider {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if info := contexts.GetServiceInfo(ctx); info != nil {
		if mp, ok := s.providers[info.Service]; ok {
			return mp
		}
	}
	return s.last
}

// Meter routes Int64Counter, the one instrument read through the global
// (pkg/clog, pkg/customertracebridge). shortcut: other instruments bind to the
// latest provider; route them when code reads one from the global meter.
func (s *serviceMeters) Meter(name string, opts ...metric.MeterOption) metric.Meter {
	s.mu.RLock()
	last := s.last
	s.mu.RUnlock()
	return &serviceMeter{Meter: last.Meter(name, opts...), meters: s, name: name, opts: opts}
}

// ForceFlush flushes every service's provider, for ForceFlushGlobal.
func (s *serviceMeters) ForceFlush(ctx context.Context) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var errs []error
	for _, mp := range s.providers {
		errs = append(errs, mp.ForceFlush(ctx))
	}
	return errors.Join(errs...)
}

type serviceMeter struct {
	metric.Meter
	meters *serviceMeters
	name   string
	opts   []metric.MeterOption
}

// Int64Counter validates on the latest provider and routes each measurement.
func (m *serviceMeter) Int64Counter(name string, opts ...metric.Int64CounterOption) (metric.Int64Counter, error) {
	if _, err := m.Meter.Int64Counter(name, opts...); err != nil {
		return nil, err
	}
	return &serviceCounter{meter: m, name: name, opts: opts}, nil
}

type serviceCounter struct {
	embedded.Int64Counter
	meter *serviceMeter
	name  string
	opts  []metric.Int64CounterOption
}

// on is the counter on ctx's provider; the SDK caches meters and instruments
// by name, so asking again returns the same one.
func (c *serviceCounter) on(ctx context.Context) metric.Int64Counter {
	counter, _ := c.meter.meters.forContext(ctx).Meter(c.meter.name, c.meter.opts...).Int64Counter(c.name, c.opts...)
	return counter
}

func (c *serviceCounter) Add(ctx context.Context, incr int64, opts ...metric.AddOption) {
	c.on(ctx).Add(ctx, incr, opts...)
}

func (c *serviceCounter) Enabled(ctx context.Context) bool { return c.on(ctx).Enabled(ctx) }
