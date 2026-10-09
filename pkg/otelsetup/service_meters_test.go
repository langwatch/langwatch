package otelsetup

import (
	"context"
	"errors"
	"testing"

	otelapi "go.opentelemetry.io/otel"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/metric/metricdata"
)

// isolateGlobalMeters gives a test a fresh registry and restores the global.
func isolateGlobalMeters(t *testing.T) {
	t.Helper()
	saved, savedGlobal := globalMeters, otelapi.GetMeterProvider()
	globalMeters = &serviceMeters{providers: map[string]*sdkmetric.MeterProvider{}}
	t.Cleanup(func() {
		globalMeters = saved
		otelapi.SetMeterProvider(savedGlobal)
	})
}

func recordingMeterProvider() (*sdkmetric.MeterProvider, *sdkmetric.ManualReader) {
	reader := sdkmetric.NewManualReader()
	return sdkmetric.NewMeterProvider(sdkmetric.WithReader(reader)), reader
}

// counted is the sum the reader saw for the named counter.
func counted(t *testing.T, reader *sdkmetric.ManualReader, name string) int64 {
	t.Helper()
	var rm metricdata.ResourceMetrics
	if err := reader.Collect(context.Background(), &rm); err != nil {
		t.Fatalf("collect: %v", err)
	}
	var total int64
	for _, scope := range rm.ScopeMetrics {
		for _, m := range scope.Metrics {
			if sum, ok := m.Data.(metricdata.Sum[int64]); ok && m.Name == name {
				for _, point := range sum.DataPoints {
					total += point.Value
				}
			}
		}
	}
	return total
}

// @scenario "Services sharing one Go process keep their own telemetry identity"
func TestOneServiceOwnsTheGlobalMeterProviderDirectly(t *testing.T) {
	isolateGlobalMeters(t)
	mp, _ := recordingMeterProvider()
	installMeterProvider("langwatch-service-aigateway", mp)
	if otelapi.GetMeterProvider() != mp {
		t.Fatal("a single service's provider is not the global; one-service processes must be unchanged")
	}
}

// @scenario "Services sharing one Go process keep their own telemetry identity"
func TestServicesSharingAProcessKeepTheirOwnMeterProvider(t *testing.T) {
	isolateGlobalMeters(t)
	gatewayMP, gatewayReader := recordingMeterProvider()
	nlpMP, nlpReader := recordingMeterProvider()
	installMeterProvider("langwatch-service-aigateway", gatewayMP)
	installMeterProvider("langwatch-service-nlp", nlpMP)

	counter, err := otelapi.Meter("shared").Int64Counter("requests")
	if err != nil {
		t.Fatalf("counter: %v", err)
	}
	counter.Add(serviceContext("langwatch-service-aigateway"), 1)
	counter.Add(serviceContext("langwatch-service-nlp"), 2)
	counter.Add(context.Background(), 4)

	if got := counted(t, gatewayReader, "requests"); got != 1 {
		t.Errorf("gateway provider counted %d, want only its own 1", got)
	}
	if got := counted(t, nlpReader, "requests"); got != 6 {
		t.Errorf("nlp provider counted %d, want its 2 and the unnamed 4 (latest registered)", got)
	}
	if err := globalMeters.ForceFlush(context.Background()); err != nil {
		t.Errorf("flushing both providers: %v", err)
	}
}

type recordingHandler struct{ seen []error }

func (h *recordingHandler) Handle(err error) { h.seen = append(h.seen, err) }

// @scenario "Services sharing one Go process keep their own telemetry identity"
func TestServicesSharingAProcessEachHearOTelErrors(t *testing.T) {
	saved, savedGlobal := globalErrorHandlers, otelapi.GetErrorHandler()
	globalErrorHandlers = &serviceErrorHandlers{handlers: map[string]otelapi.ErrorHandler{}}
	t.Cleanup(func() {
		globalErrorHandlers = saved
		otelapi.SetErrorHandler(savedGlobal)
	})
	gateway, nlp := &recordingHandler{}, &recordingHandler{}
	installErrorHandler("langwatch-service-aigateway", gateway)
	if otelapi.GetErrorHandler() != gateway {
		t.Fatal("a single service's handler is not the global; one-service processes must be unchanged")
	}
	installErrorHandler("langwatch-service-nlp", nlp)
	otelapi.Handle(errors.New("export failed"))
	if len(gateway.seen) != 1 || len(nlp.seen) != 1 {
		t.Errorf("gateway heard %v, nlp heard %v; want each to hear the error once", gateway.seen, nlp.seen)
	}
}
