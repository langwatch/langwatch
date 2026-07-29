package domain

import (
	"strings"
	"testing"
)

func TestObservabilityEnvIsEmittedOnlyWhenTheStackIsUp(t *testing.T) {
	st := Stack{Slug: "portless", APIPort: 4000, Services: []Service{{Name: "app", Port: 3001, URL: "https://app.portless.langwatch.localhost"}}}

	for _, key := range []string{"OTEL_EXPORTER_OTLP_ENDPOINT", "OTEL_DEBUG_COLLECTOR_ENDPOINT", "PINO_OTEL_ENABLED", "OTEL_METRICS_ENABLED"} {
		if got := valueOf(st.OverlayEnv(), key); got != "" {
			t.Errorf("with no collector running, %s must be unset; got %q", key, got)
		}
	}

	st.ObservabilityOTLPPort = 4318
	env := st.OverlayEnv()
	if got, want := valueOf(env, "OTEL_EXPORTER_OTLP_ENDPOINT"), "http://127.0.0.1:4318"; got != want {
		t.Errorf("OTEL_EXPORTER_OTLP_ENDPOINT = %q, want %q", got, want)
	}
	// The Go services dual-export to the same collector via their own var.
	if got, want := valueOf(env, "OTEL_DEBUG_COLLECTOR_ENDPOINT"), "http://127.0.0.1:4318"; got != want {
		t.Errorf("OTEL_DEBUG_COLLECTOR_ENDPOINT = %q, want %q", got, want)
	}
	if got := valueOf(env, "PINO_OTEL_ENABLED"); got != "true" {
		t.Errorf("PINO_OTEL_ENABLED = %q, want true", got)
	}
	if got := valueOf(env, "OTEL_METRICS_ENABLED"); got != "true" {
		t.Errorf("OTEL_METRICS_ENABLED = %q, want true", got)
	}
}

// The slug tag is the whole point of one shared collector: an agent debugging a
// worktree filters Grafana to that worktree and sees only its own telemetry.
func TestObservabilityEnvTagsTelemetryWithTheSlug(t *testing.T) {
	st := Stack{Slug: "adr-domain-errors", ObservabilityOTLPPort: 4318}
	if got, want := valueOf(st.OverlayEnv(), "OTEL_RESOURCE_ATTRIBUTES"), "langwatch.worktree=adr-domain-errors"; got != want {
		t.Errorf("OTEL_RESOURCE_ATTRIBUTES = %q, want %q", got, want)
	}
}

// With the stack up, haven mutes the console to the configured floor (warn) — the
// full stream is in Grafana — but only when a level is set. An empty level is the
// opt-out (LW_OBS_CONSOLE_LEVEL="off"), leaving the console to .env. Either way the
// OTel floor stays at debug, so nothing is lost, just relocated.
func TestObservabilityEnvMutesTheConsoleOnlyWhenAskedTo(t *testing.T) {
	optedOut := Stack{Slug: "portless", ObservabilityOTLPPort: 4318}
	if got := valueOf(optedOut.OverlayEnv(), "LOG_CONSOLE_LEVEL"); got != "" {
		t.Errorf("with no console level set, LOG_CONSOLE_LEVEL must be left to .env; got %q", got)
	}

	muted := Stack{Slug: "portless", ObservabilityOTLPPort: 4318, ObservabilityConsoleLevel: "warn"}
	if got, want := valueOf(muted.OverlayEnv(), "LOG_CONSOLE_LEVEL"), "warn"; got != want {
		t.Errorf("LOG_CONSOLE_LEVEL = %q, want %q", got, want)
	}
	if got := valueOf(muted.OverlayEnv(), "LOG_OTEL_LEVEL"); got != "debug" {
		t.Errorf("LOG_OTEL_LEVEL = %q, want debug (full detail reaches Grafana)", got)
	}
}

// The Grafana base URL is published only once the stack is up, so the app can turn
// a trace/span id into a clickable deep link. Loopback, for the developer's own
// browser on this machine.
func TestObservabilityEnvPublishesTheGrafanaLink(t *testing.T) {
	st := Stack{Slug: "portless", ObservabilityOTLPPort: 4318}
	if got := valueOf(st.OverlayEnv(), "GRAFANA_BASE_URL"); got != "" {
		t.Errorf("without a Grafana port, GRAFANA_BASE_URL must be unset; got %q", got)
	}

	st.ObservabilityGrafanaPort = 3000
	if got, want := valueOf(st.OverlayEnv(), "GRAFANA_BASE_URL"), "http://127.0.0.1:3000"; got != want {
		t.Errorf("GRAFANA_BASE_URL = %q, want %q", got, want)
	}
}

func TestDefaultObservabilityLimitsStayWithinTheirBounds(t *testing.T) {
	gib := uint64(1) << 30

	// A small machine still gets enough to start the six-process bundle at all.
	small := DefaultObservabilityLimits(4*gib, 2)
	if small.MemoryMB != 1536 {
		t.Errorf("4 GiB machine: MemoryMB = %d, want the 1536 floor", small.MemoryMB)
	}
	if small.CPUs != 1 {
		t.Errorf("2-core machine: CPUs = %v, want the floor of 1", small.CPUs)
	}

	// A big one does not get to hand the stack an unbounded slice of it.
	big := DefaultObservabilityLimits(128*gib, 32)
	if big.MemoryMB != 2560 {
		t.Errorf("128 GiB machine: MemoryMB = %d, want the 2560 ceiling", big.MemoryMB)
	}
	if big.CPUs != 2 {
		t.Errorf("32-core machine: CPUs = %v, want the ceiling of 2", big.CPUs)
	}

	// An eighth of the machine in between.
	mid := DefaultObservabilityLimits(16*gib, 8)
	if mid.MemoryMB != 2048 {
		t.Errorf("16 GiB machine: MemoryMB = %d, want 2048 (an eighth)", mid.MemoryMB)
	}
}

// Prometheus caps its TSDB by both age and size via flags; Loki and Tempo get
// their retention from patched configs instead (they have no such flags).
func TestPrometheusExtraArgsCapsRetention(t *testing.T) {
	args := DefaultObservabilityLimits(16*(1<<30), 8).PrometheusExtraArgs()
	for _, want := range []string{"--storage.tsdb.retention.time=2h", "--storage.tsdb.retention.size=256MB"} {
		if !strings.Contains(args, want) {
			t.Errorf("PrometheusExtraArgs() = %q, want it to contain %q", args, want)
		}
	}
}

// Prometheus promotes only the resource attributes named in its config, so
// without this the worktree tag reaches Tempo and Loki but silently never reaches
// a metric label.
func TestPatchPrometheusConfigPromotesTheWorktreeTag(t *testing.T) {
	config := `otlp:
  keep_identifying_resource_attributes: true
  promote_resource_attributes:
    - service.name
    - k8s.pod.name
storage:
  tsdb:
    out_of_order_time_window: 10m
`
	got, err := PatchPrometheusConfig(config)
	if err != nil {
		t.Fatalf("PatchPrometheusConfig() errored: %v", err)
	}
	if !strings.Contains(got, ObservabilityWorktreeAttr) {
		t.Errorf("langwatch.worktree was not promoted:\n%s", got)
	}
	// Upstream's own entries must survive — the point of deriving the config from
	// the image instead of vendoring a copy that rots against the next bump.
	for _, keep := range []string{"service.name", "k8s.pod.name", "out_of_order_time_window"} {
		if !strings.Contains(got, keep) {
			t.Errorf("derived config dropped upstream's %q:\n%s", keep, got)
		}
	}
}

func TestPatchPrometheusConfigIsIdempotent(t *testing.T) {
	config := "otlp:\n  promote_resource_attributes:\n    - langwatch.worktree\n"
	got, err := PatchPrometheusConfig(config)
	if err != nil {
		t.Fatalf("errored: %v", err)
	}
	if got != config {
		t.Errorf("a config that already promotes the attribute must come back untouched:\n%s", got)
	}
}

// If upstream restructures the config, failing loudly beats mounting a file that
// quietly does nothing.
func TestPatchPrometheusConfigFailsWhenTheListIsGone(t *testing.T) {
	if _, err := PatchPrometheusConfig("global:\n  scrape_interval: 15s\n"); err == nil {
		t.Error("a config with no promote_resource_attributes list must error, not silently pass through")
	}
}

// The bundle ships Loki with no retention at all — it keeps every line forever.
func TestPatchLokiConfigCapsRetentionAndIngestion(t *testing.T) {
	config := `auth_enabled: false
common:
  path_prefix: /data/loki
schema_config:
  configs:
    - from: 2020-10-24
      store: tsdb
`
	got, err := PatchLokiConfig(config, DefaultObservabilityLimits(16*(1<<30), 8))
	if err != nil {
		t.Fatalf("PatchLokiConfig() errored: %v", err)
	}
	// Retention only actually deletes if the compactor is on and allowed to.
	for _, want := range []string{"retention_period: 2h", "retention_enabled: true", "delete_request_store: filesystem", "ingestion_rate_mb: 16"} {
		if !strings.Contains(got, want) {
			t.Errorf("Loki config missing %q:\n%s", want, got)
		}
	}
	// Upstream's schema/ring wiring must survive, or Loki won't start.
	for _, keep := range []string{"auth_enabled", "path_prefix", "schema_config"} {
		if !strings.Contains(got, keep) {
			t.Errorf("derived Loki config dropped upstream's %q:\n%s", keep, got)
		}
	}
}

// Same story as Loki: the bundle configures no block retention, so spans pile up
// for as long as the container lives.
func TestPatchTempoConfigCapsBlockRetention(t *testing.T) {
	config := `server:
  http_listen_port: 3200
storage:
  trace:
    backend: local
`
	got, err := PatchTempoConfig(config, DefaultObservabilityLimits(16*(1<<30), 8))
	if err != nil {
		t.Fatalf("PatchTempoConfig() errored: %v", err)
	}
	if !strings.Contains(got, "block_retention: 2h") {
		t.Errorf("Tempo config missing block_retention: 2h:\n%s", got)
	}
	if !strings.Contains(got, "http_listen_port") || !strings.Contains(got, "backend: local") {
		t.Errorf("derived Tempo config dropped upstream's storage/server wiring:\n%s", got)
	}
}

func TestDefaultColimaLimitsStayWithinTheirBounds(t *testing.T) {
	gib := uint64(1) << 30

	small := DefaultColimaLimits(4*gib, 2)
	if small.CPUs != 2 || small.MemoryGiB != 4 {
		t.Errorf("4 GiB / 2-core: got %d cpus / %d GiB, want the 2 / 4 floors", small.CPUs, small.MemoryGiB)
	}

	big := DefaultColimaLimits(128*gib, 32)
	if big.CPUs != 4 || big.MemoryGiB != 8 {
		t.Errorf("128 GiB / 32-core: got %d cpus / %d GiB, want the 4 / 8 ceilings", big.CPUs, big.MemoryGiB)
	}
}
