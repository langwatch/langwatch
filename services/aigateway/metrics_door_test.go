package aigateway

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/config"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaymetrics"
)

func observedMetricsDoor(t *testing.T, cfg Config) (*http.Server, *observer.ObservedLogs) {
	t.Helper()
	core, logs := observer.New(zapcore.ErrorLevel)
	return metricsDoor(zap.New(core), cfg, gatewaymetrics.New()), logs
}

func scrape(t *testing.T, door *http.Server, path, authorization string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	door.Handler.ServeHTTP(rec, req)
	return rec
}

func TestMetricsDoor_StaysShutUnlessPrometheusIsListed(t *testing.T) {
	for name, otel := range map[string]config.OTel{
		"switch unset":     {},
		"otlp only":        {MetricsExporter: "otlp"},
		"sdk disabled":     {MetricsExporter: "otlp,prometheus", SDKDisabled: true},
		"similar spelling": {MetricsExporter: "prometheus-remote"},
	} {
		t.Run(name, func(t *testing.T) {
			door, _ := observedMetricsDoor(t, Config{OTel: otel, MetricsAPIKey: "k"})
			assert.Nil(t, door)
		})
	}
	assert.Nil(t, metricsDoor(zap.NewNop(), Config{OTel: config.OTel{MetricsExporter: "prometheus"}, MetricsAPIKey: "k"}, nil))
}

func TestMetricsDoor_KeyedDoorAnswersOnlyTheBearer(t *testing.T) {
	door, _ := observedMetricsDoor(t, Config{
		Environment:   "production",
		MetricsAPIKey: "scrape-key",
		OTel:          config.OTel{MetricsExporter: "otlp, prometheus"},
	})
	require.NotNil(t, door)
	assert.Equal(t, ":9464", door.Addr)

	assert.Equal(t, http.StatusUnauthorized, scrape(t, door, "/metrics", "").Code)
	assert.Equal(t, http.StatusUnauthorized, scrape(t, door, "/metrics", "Bearer wrong").Code)
	assert.Equal(t, http.StatusNotFound, scrape(t, door, "/healthz", "Bearer scrape-key").Code)
	ok := scrape(t, door, "/metrics", "Bearer scrape-key")
	assert.Equal(t, http.StatusOK, ok.Code)
	assert.Contains(t, ok.Body.String(), "go_goroutines")
}

func TestMetricsDoor_KeyedDoorListensOnTheConfiguredHostAndPort(t *testing.T) {
	door, _ := observedMetricsDoor(t, Config{MetricsAPIKey: "k", OTel: config.OTel{
		MetricsExporter: "prometheus", PrometheusHost: "127.0.0.1", PrometheusPort: 9999,
	}})
	require.NotNil(t, door)
	assert.Equal(t, "127.0.0.1:9999", door.Addr)
}

// Ruling GW-METRICS-NO-KEY: no key keeps the door shut, loopback included.
func TestMetricsDoor_UnkeyedDoorStaysUnmounted(t *testing.T) {
	for name, cfg := range map[string]Config{
		"every interface":    {OTel: config.OTel{MetricsExporter: "prometheus"}},
		"local on loopback":  {OTel: config.OTel{MetricsExporter: "prometheus", PrometheusHost: "127.0.0.1"}},
		"hosted on loopback": {Environment: "production", OTel: config.OTel{MetricsExporter: "prometheus", PrometheusHost: "127.0.0.1"}},
		"named non-loopback": {OTel: config.OTel{MetricsExporter: "prometheus", PrometheusHost: "10.0.0.5"}},
	} {
		t.Run(name, func(t *testing.T) {
			door, logs := observedMetricsDoor(t, cfg)
			assert.Nil(t, door)
			require.Equal(t, 1, logs.Len())
			entry := logs.All()[0]
			assert.Equal(t, "aigateway_metrics_door_unmounted", entry.Message)
			assert.Equal(t, "set METRICS_API_KEY", entry.ContextMap()["fix"])
		})
	}
}
