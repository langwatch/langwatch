package gatewaymetrics

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRecorder_OTelProducer_CarriesGatewaySeriesButNotRuntimeFamilies(t *testing.T) {
	r := New()
	r.ObserveHTTPRequest("/v1/chat/completions", 200, "openai", "gpt-5-mini", 0.1)

	producer := r.OTelProducer()
	require.NotNil(t, producer)
	scopes, err := producer.Produce(context.Background())
	require.NoError(t, err)

	var names []string
	for _, scope := range scopes {
		for _, m := range scope.Metrics {
			names = append(names, m.Name)
		}
	}
	assert.Contains(t, names, "gateway_http_requests_total")
	assert.Contains(t, names, "gateway_http_request_duration_seconds")
	for _, name := range names {
		assert.False(t, strings.HasPrefix(name, "go_") || strings.HasPrefix(name, "process_"),
			"runtime family %q is already pushed by the OTel runtime instrumentation", name)
	}
}

func TestRecorder_OTelProducer_NilIsSafe(t *testing.T) {
	var r *Recorder
	assert.Nil(t, r.OTelProducer())
}
