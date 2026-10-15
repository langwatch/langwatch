package domain

import (
	"fmt"
	"path/filepath"
	"strings"
)

// ObservabilityTier is where the observability stack runs: as host processes
// (native) or as the grafana/otel-lgtm container on the colima VM.
type ObservabilityTier string

const (
	// ObservabilityTierNative runs every component as a host process.
	ObservabilityTierNative ObservabilityTier = "native"
	// ObservabilityTierContainer runs the grafana/otel-lgtm container.
	ObservabilityTierContainer ObservabilityTier = "container"
)

// ObservabilityTierEnvVar pins the tier; unset means the platform default.
const ObservabilityTierEnvVar = "LANGWATCH_HAVEN_OBS_TIER"

// ObservabilityTierFor picks the tier: a valid pin wins, otherwise macOS runs
// native and everything else the container. ok is false when pinned names no
// tier, so the caller can say so; the default is still returned.
func ObservabilityTierFor(goos, pinned string) (tier ObservabilityTier, ok bool) {
	switch t := ObservabilityTier(strings.ToLower(strings.TrimSpace(pinned))); t {
	case ObservabilityTierNative, ObservabilityTierContainer:
		return t, true
	case "":
		ok = true
	}
	if goos == "darwin" {
		return ObservabilityTierNative, ok
	}
	return ObservabilityTierContainer, ok
}

// NativeObservabilityPorts are the loopback ports behind the public endpoints.
// Inside the bundle these were private to the container; on the host they are
// fixed so a second worktree finds the running processes by probing them.
type NativeObservabilityPorts struct {
	PrometheusHTTP int
	LokiHTTP       int
	LokiGRPC       int
	TempoHTTP      int
	TempoGRPC      int
	TempoOTLPHTTP  int // where the collector forwards spans, as the bundle did (4418)
	TempoGossip    int // memberlist; moved off 7946 and pinned to loopback
	CollectorHTTP  int // Alloy's own UI and readiness endpoint
	// Pyroscope's HTTP port is Endpoints.PyroscopePort; its gRPC (which the
	// bundle puts on 9097, now Tempo's) and memberlist move beside Tempo's.
	PyroscopeGRPC   int
	PyroscopeGossip int
}

// DefaultNativeObservabilityPorts mirrors the bundle's internal layout.
func DefaultNativeObservabilityPorts() NativeObservabilityPorts {
	return NativeObservabilityPorts{
		PrometheusHTTP: 9090, LokiHTTP: 3100, LokiGRPC: 9096,
		TempoHTTP: 3200, TempoGRPC: 9097, TempoOTLPHTTP: 4418, TempoGossip: 7947,
		CollectorHTTP: 12345, PyroscopeGRPC: 9098, PyroscopeGossip: 7948,
	}
}

// NativeObservabilityPlan is everything the native configs are rendered from.
type NativeObservabilityPlan struct {
	Dir       string // haven's home/observability; config, data and logs live under it
	Endpoints ObservabilityEndpoints
	Ports     NativeObservabilityPorts
	Limits    ObservabilityLimits
}

// ConfigDir holds the rendered configs. Every process's argv names a file
// under it, which is how Stop finds them all.
func (p NativeObservabilityPlan) ConfigDir() string { return filepath.Join(p.Dir, "config") }

// DataDir holds each component's data; Stop discards it.
func (p NativeObservabilityPlan) DataDir() string { return filepath.Join(p.Dir, "data") }

// LogDir holds one log per component, tailed by `haven logs obs`.
func (p NativeObservabilityPlan) LogDir() string { return filepath.Join(p.Dir, "logs") }

// TempoBinary is where haven installs the pinned Tempo, kept apart from
// DataDir so `haven observability down` does not discard it.
func (p NativeObservabilityPlan) TempoBinary() string {
	return filepath.Join(p.Dir, "bin", "tempo", TempoNativeVersion, "tempo")
}

// TempoNativeVersion is the Tempo release haven fetches on macOS: the newest,
// and the only line with darwin builds since 2.7.2 (whose assets carry no
// digest to pin). Its config keys are the 3.x ones RenderNativeTempoConfig writes.
const TempoNativeVersion = "3.1.0"

// tempoNativeDigests are GitHub's recorded sha256 of each darwin tarball
// (`gh api repos/grafana/tempo/releases/tags/v3.1.0`, field assets[].digest).
var tempoNativeDigests = map[string]string{
	"darwin/arm64": "0511d3d7fb959312ae6e3b269f469942e9fc4839e53f01c07cc65844f312eb0c",
	"darwin/amd64": "4459d55672712d88529d9e4e2975e57f66356b57261bc4f3b35e78ee88725c79",
}

// TempoNativeArtifactFor returns the pinned Tempo tarball for a machine, or
// false where haven pins none (then tempo is looked up on PATH).
func TempoNativeArtifactFor(goos, goarch string) (PinnedArtifact, bool) {
	sum, ok := tempoNativeDigests[goos+"/"+goarch]
	if !ok {
		return PinnedArtifact{}, false
	}
	url := fmt.Sprintf("https://github.com/grafana/tempo/releases/download/v%s/tempo_%s_%s_%s.tar.gz",
		TempoNativeVersion, TempoNativeVersion, goos, goarch)
	return PinnedArtifact{URL: url, SHA256: sum, Member: "tempo"}, true
}

// AlloyBinary is where haven installs the pinned Alloy, beside Tempo.
func (p NativeObservabilityPlan) AlloyBinary() string {
	return filepath.Join(p.Dir, "bin", "alloy", AlloyNativeVersion, "alloy")
}

// AlloyNativeVersion is the Alloy release haven fetches on macOS. Grafana's
// Homebrew tap builds Alloy from source, which refuses on outdated Command
// Line Tools; the release zip needs nothing but a download.
const AlloyNativeVersion = "1.20.1"

// alloyNativeDigests are GitHub's recorded sha256 of each darwin zip
// (`gh api repos/grafana/alloy/releases/tags/v1.20.1`, field assets[].digest).
var alloyNativeDigests = map[string]string{
	"darwin/arm64": "9709de08e15ef4307ce52dd5c306edf0d115db02119a712c39c00a04e013e88d",
	"darwin/amd64": "8ae0c7f56e4658093d15e5dea8ca5cfa4ed382bd99fca059418cf3d647ea956e",
}

// AlloyNativeArtifactFor returns the pinned Alloy zip for a machine, or false
// where haven pins none (then alloy is looked up on PATH). The zip holds one
// binary named after the asset.
func AlloyNativeArtifactFor(goos, goarch string) (PinnedArtifact, bool) {
	sum, ok := alloyNativeDigests[goos+"/"+goarch]
	if !ok {
		return PinnedArtifact{}, false
	}
	asset := fmt.Sprintf("alloy-%s-%s", goos, goarch)
	url := fmt.Sprintf("https://github.com/grafana/alloy/releases/download/v%s/%s.zip", AlloyNativeVersion, asset)
	return PinnedArtifact{URL: url, SHA256: sum, Member: asset}, true
}

// PyroscopeBinary is where haven installs the pinned Pyroscope, beside Tempo.
func (p NativeObservabilityPlan) PyroscopeBinary() string {
	return filepath.Join(p.Dir, "bin", "pyroscope", PyroscopeNativeVersion, "pyroscope")
}

// PyroscopeNativeVersion is the Pyroscope release haven fetches on macOS: the
// newest of the 2.x line the bundle runs (v2.0.2 in otel-lgtm 0.28.0), whose
// v2 storage config RenderNativePyroscopeConfig mirrors.
const PyroscopeNativeVersion = "2.3.2"

// pyroscopeNativeDigests are GitHub's recorded sha256 of each darwin tarball
// (`gh api repos/grafana/pyroscope/releases/tags/v2.3.2`, field assets[].digest).
var pyroscopeNativeDigests = map[string]string{
	"darwin/arm64": "2560e2fdd172dfeec0ceed7714959cb17cda452c481ed150269cb81b82977d38",
	"darwin/amd64": "a3877d18c0ce7554985f6baef9b6762ae161b8d30d08ce7fe6aeeb890dfd4914",
}

// PyroscopeNativeArtifactFor returns the pinned Pyroscope tarball for a
// machine, or false where haven pins none (then pyroscope is looked up on PATH).
func PyroscopeNativeArtifactFor(goos, goarch string) (PinnedArtifact, bool) {
	sum, ok := pyroscopeNativeDigests[goos+"/"+goarch]
	if !ok {
		return PinnedArtifact{}, false
	}
	url := fmt.Sprintf("https://github.com/grafana/pyroscope/releases/download/v%s/pyroscope_%s_%s_%s.tar.gz",
		PyroscopeNativeVersion, PyroscopeNativeVersion, goos, goarch)
	return PinnedArtifact{URL: url, SHA256: sum, Member: "pyroscope"}, true
}

// NativeComponent is one host process of the native stack.
type NativeComponent struct {
	Name     string
	Binary   string            // looked up on PATH unless the adapter overrides it
	Install  string            // printed, never run, when Binary is missing
	Args     []string          // argv after the binary
	Files    map[string]string // file name under ConfigDir -> content
	ReadyURL string            // answers 200 once the component serves
	// Required components carry the endpoints; without one there is no stack.
	Required bool
}

// NativeMemoryLimitMB is each component's GOMEMLIMIT: the container's single
// cgroup ceiling split evenly. A soft cap (the Go GC works harder near it),
// which is the most a host process gets without a VM.
func NativeMemoryLimitMB(l ObservabilityLimits, components int) int {
	if components <= 0 {
		return l.MemoryMB
	}
	return l.MemoryMB / components
}

// GrafanaHomePath is Grafana's --homepath for a resolved Homebrew binary
// (<cellar>/grafana/<v>/bin/grafana -> <cellar>/grafana/<v>/share/grafana).
func GrafanaHomePath(resolvedBinary string) string {
	return filepath.Join(filepath.Dir(filepath.Dir(resolvedBinary)), "share", "grafana")
}

// NativeObservabilityComponents is the whole stack, in start order: stores
// first, then the collector that writes to them, then Grafana over them.
func NativeObservabilityComponents(p NativeObservabilityPlan, grafanaHome string) []NativeComponent {
	cfg, data := p.ConfigDir(), p.DataDir()
	loopback := func(port int) string { return fmt.Sprintf("http://127.0.0.1:%d", port) }
	prometheusArgs := append([]string{
		"--config.file=" + filepath.Join(cfg, "prometheus.yaml"),
		"--storage.tsdb.path=" + filepath.Join(data, "prometheus"),
		fmt.Sprintf("--web.listen-address=127.0.0.1:%d", p.Ports.PrometheusHTTP),
		"--web.enable-otlp-receiver",
	}, strings.Fields(p.Limits.PrometheusExtraArgs())...)
	stores := []NativeComponent{
		{
			Name: "prometheus", Binary: "prometheus", Install: "brew install prometheus",
			Args:     prometheusArgs,
			Files:    map[string]string{"prometheus.yaml": RenderNativePrometheusConfig()},
			ReadyURL: loopback(p.Ports.PrometheusHTTP) + "/-/ready",
		},
		{
			Name: "loki", Binary: "loki", Install: "brew install loki",
			Args:     []string{"-config.file=" + filepath.Join(cfg, "loki.yaml")},
			Files:    map[string]string{"loki.yaml": RenderNativeLokiConfig(p)},
			ReadyURL: loopback(p.Ports.LokiHTTP) + "/ready",
		},
		{
			Name: "tempo", Binary: "tempo",
			Install:  "haven fetches Tempo " + TempoNativeVersion + " on macOS; elsewhere put tempo on PATH or set HAVEN_OBS_TEMPO_BIN",
			Args:     []string{"-config.file=" + filepath.Join(cfg, "tempo.yaml")},
			Files:    map[string]string{"tempo.yaml": RenderNativeTempoConfig(p)},
			ReadyURL: loopback(p.Ports.TempoHTTP) + "/ready",
		},
	}
	if p.Endpoints.PyroscopePort != 0 {
		stores = append(stores, NativeComponent{
			Name: "pyroscope", Binary: "pyroscope",
			Install:  "haven fetches Pyroscope " + PyroscopeNativeVersion + " on macOS; elsewhere put pyroscope on PATH or set HAVEN_OBS_PYROSCOPE_BIN",
			Args:     []string{"-config.file=" + filepath.Join(cfg, "pyroscope.yaml")},
			Files:    map[string]string{"pyroscope.yaml": RenderNativePyroscopeConfig(p)},
			ReadyURL: loopback(p.Endpoints.PyroscopePort) + "/ready",
		})
	}
	return append(stores, []NativeComponent{
		{
			Name: "alloy", Binary: "alloy", Required: true,
			Install: "haven fetches Alloy " + AlloyNativeVersion + " on macOS; elsewhere put alloy on PATH or set HAVEN_OBS_ALLOY_BIN",
			Args: []string{
				"run", fmt.Sprintf("--server.http.listen-addr=127.0.0.1:%d", p.Ports.CollectorHTTP),
				"--storage.path=" + filepath.Join(data, "alloy"), "--disable-reporting",
				filepath.Join(cfg, "collector.alloy"),
			},
			Files: map[string]string{"collector.alloy": RenderNativeCollectorConfig(p)},
			// The adapter also checks the OTLP ports: a failed receiver still answers 200.
			ReadyURL: loopback(p.Ports.CollectorHTTP) + "/-/healthy",
		},
		{
			Name: "grafana", Binary: "grafana", Install: "brew install grafana", Required: true,
			Args: []string{"server", "--homepath", grafanaHome, "--config", filepath.Join(cfg, "grafana.ini")},
			Files: map[string]string{
				"grafana.ini": RenderNativeGrafanaIni(p),
				filepath.Join("grafana-provisioning", "datasources", "datasources.yaml"): RenderNativeGrafanaDatasources(p),
			},
			ReadyURL: p.Endpoints.GrafanaURL() + "/api/health",
		},
	}...)
}

// RenderNativePyroscopeConfig is the bundle's single-process v2-storage
// Pyroscope on local disk, its gRPC and memberlist moved off Tempo's ports and
// everything bound to loopback.
func RenderNativePyroscopeConfig(p NativeObservabilityPlan) string {
	dir := filepath.Join(p.DataDir(), "pyroscope")
	grpc := fmt.Sprintf("127.0.0.1:%d", p.Ports.PyroscopeGRPC)
	return fmt.Sprintf(`server:
  http_listen_address: 127.0.0.1
  http_listen_port: %d
  grpc_listen_address: 127.0.0.1
  grpc_listen_port: %d
  log_level: warn
memberlist:
  bind_addr: [127.0.0.1]
  bind_port: %d
metastore:
  address: %s
  min_ready_duration: 1s
  data_dir: %s/metastore/data
  raft:
    dir: %s/metastore/raft
    snapshots_dir: %s/metastore/raft
architecture_storage: v2
limits:
  write_path: segment-writer
storage:
  backend: filesystem
  filesystem:
    dir: %s/shared
distributor:
  ring:
    kvstore:
      store: inmemory
segment_writer:
  lifecycler:
    min_ready_duration: 1s
query_backend:
  address: %s
`, p.Endpoints.PyroscopePort, p.Ports.PyroscopeGRPC, p.Ports.PyroscopeGossip,
		grpc, dir, dir, dir, dir, grpc)
}

// RenderNativePrometheusConfig is the bundle's OTLP setup plus the worktree
// label (see PatchPrometheusConfig for why the label must be promoted).
// Retention is by flag, see PrometheusExtraArgs.
func RenderNativePrometheusConfig() string {
	return `otlp:
  keep_identifying_resource_attributes: true
  promote_resource_attributes:
    - service.instance.id
    - service.name
    - service.namespace
    - service.version
    - deployment.environment
    - deployment.environment.name
    - ` + ObservabilityWorktreeAttr + `
storage:
  tsdb:
    out_of_order_time_window: 30m
`
}

// RenderNativeLokiConfig is a single-process Loki on the filesystem, with the
// retention and ingestion caps PatchLokiConfig puts on the bundle's.
func RenderNativeLokiConfig(p NativeObservabilityPlan) string {
	dir := filepath.Join(p.DataDir(), "loki")
	l := p.Limits
	return fmt.Sprintf(`auth_enabled: false
server:
  http_listen_address: 127.0.0.1
  http_listen_port: %d
  grpc_listen_address: 127.0.0.1
  grpc_listen_port: %d
  log_level: warn
common:
  instance_addr: 127.0.0.1
  path_prefix: %s
  storage:
    filesystem:
      chunks_directory: %s/chunks
      rules_directory: %s/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory
schema_config:
  configs:
    - from: "2020-10-24"
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h
limits_config:
  retention_period: %s
  ingestion_rate_mb: %d
  ingestion_burst_size_mb: %d
  allow_structured_metadata: true
compactor:
  working_directory: %s/compactor
  retention_enabled: true
  delete_request_store: filesystem
  compaction_interval: 10m
  retention_delete_delay: 1m
analytics:
  reporting_enabled: false
`, p.Ports.LokiHTTP, p.Ports.LokiGRPC, dir, dir, dir,
		l.Retention(), l.IngestionRateMB, l.IngestionRateMB*2, dir)
}

// RenderNativeTempoConfig is a monolithic Tempo 3.x (target all, no Kafka) on
// local disk, receiving OTLP over HTTP from the collector on the bundle's
// internal port. 3.x moved retention to backend_worker.compaction; every
// default under /var/tempo is pointed into the data directory.
func RenderNativeTempoConfig(p NativeObservabilityPlan) string {
	dir := filepath.Join(p.DataDir(), "tempo")
	return fmt.Sprintf(`stream_over_http_enabled: true
server:
  http_listen_address: 127.0.0.1
  http_listen_port: %d
  grpc_listen_address: 127.0.0.1
  grpc_listen_port: %d
  log_level: warn
distributor:
  receivers:
    otlp:
      protocols:
        http:
          endpoint: 127.0.0.1:%d
memberlist:
  bind_addr: [127.0.0.1]
  bind_port: %d
backend_worker:
  compaction:
    block_retention: %s
backend_scheduler:
  local_work_path: %s/work
live_store:
  shutdown_marker_dir: %s/live-store/shutdown-marker
  wal:
    path: %s/live-store/traces
storage:
  trace:
    backend: local
    wal:
      path: %s/wal
    local:
      path: %s/blocks
usage_report:
  reporting_enabled: false
`, p.Ports.TempoHTTP, p.Ports.TempoGRPC, p.Ports.TempoOTLPHTTP, p.Ports.TempoGossip,
		p.Limits.Retention(), dir, dir, dir, dir, dir)
}

// RenderNativeCollectorConfig is the bundle's collector pipeline in Alloy's
// syntax: OTLP in on the public ports, each signal out to its store.
func RenderNativeCollectorConfig(p NativeObservabilityPlan) string {
	return fmt.Sprintf(`otelcol.receiver.otlp "default" {
  grpc {
    endpoint = "127.0.0.1:%d"
  }
  http {
    endpoint = "127.0.0.1:%d"
  }
  output {
    metrics = [otelcol.processor.batch.default.input]
    logs    = [otelcol.processor.batch.default.input]
    traces  = [otelcol.processor.batch.default.input]
  }
}

otelcol.processor.batch "default" {
  output {
    metrics = [otelcol.exporter.otlphttp.prometheus.input]
    logs    = [otelcol.exporter.otlphttp.loki.input]
    traces  = [otelcol.exporter.otlphttp.tempo.input]
  }
}

otelcol.exporter.otlphttp "prometheus" {
  client {
    endpoint = "http://127.0.0.1:%d/api/v1/otlp"
  }
}

otelcol.exporter.otlphttp "loki" {
  client {
    endpoint = "http://127.0.0.1:%d/otlp"
  }
}

otelcol.exporter.otlphttp "tempo" {
  client {
    endpoint = "http://127.0.0.1:%d"
  }
}
`, p.Endpoints.OTLPGRPCPort, p.Endpoints.OTLPHTTPPort,
		p.Ports.PrometheusHTTP, p.Ports.LokiHTTP, p.Ports.TempoOTLPHTTP)
}

// RenderNativeGrafanaIni carries the container's GF_* settings: loopback only,
// because anonymous access is Admin, and admin/admin so tokens can be minted.
func RenderNativeGrafanaIni(p NativeObservabilityPlan) string {
	return fmt.Sprintf(`[paths]
data = %s
logs = %s
plugins = %s
provisioning = %s

[server]
http_addr = 127.0.0.1
http_port = %d

[security]
admin_user = admin
admin_password = admin

[auth.anonymous]
enabled = true
org_role = Admin

[analytics]
check_for_updates = false
reporting_enabled = false

[news]
news_feed_enabled = false

[log]
level = warn
`, filepath.Join(p.DataDir(), "grafana"), p.LogDir(), filepath.Join(p.DataDir(), "grafana", "plugins"),
		filepath.Join(p.ConfigDir(), "grafana-provisioning"), p.Endpoints.GrafanaPort)
}

// RenderNativeGrafanaDatasources provisions the bundle's datasource uids
// (loki, prometheus, tempo, pyroscope while its port is set): haven's viewer
// and agents' queries proxy by uid.
func RenderNativeGrafanaDatasources(p NativeObservabilityPlan) string {
	pyroscope := ""
	if p.Endpoints.PyroscopePort != 0 {
		pyroscope = fmt.Sprintf(`  - name: Pyroscope
    type: grafana-pyroscope-datasource
    uid: pyroscope
    access: proxy
    url: http://127.0.0.1:%d
`, p.Endpoints.PyroscopePort)
	}
	return fmt.Sprintf(`apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    uid: prometheus
    access: proxy
    url: http://127.0.0.1:%d
    isDefault: true
    jsonData:
      exemplarTraceIdDestinations:
        - name: trace_id
          datasourceUid: tempo
  - name: Loki
    type: loki
    uid: loki
    access: proxy
    url: http://127.0.0.1:%d
  - name: Tempo
    type: tempo
    uid: tempo
    access: proxy
    url: http://127.0.0.1:%d
    jsonData:
      tracesToLogsV2:
        datasourceUid: loki
        filterByTraceID: true
      serviceMap:
        datasourceUid: prometheus
`, p.Ports.PrometheusHTTP, p.Ports.LokiHTTP, p.Ports.TempoHTTP) + pyroscope
}
