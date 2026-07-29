package domain

import "fmt"

// ObservabilityWorktreeAttr is the resource attribute every worktree stamps on
// its telemetry. It is what lets an agent debugging one worktree filter Grafana
// down to its own logs, traces and metrics while a dozen worktrees share the one
// collector — so it has to reach all three signals, not just the two that get it
// for free (see ObservabilityLimits and PromotePrometheusAttribute).
const ObservabilityWorktreeAttr = "langwatch.worktree"

// ObservabilityService is the shared surface the LGTM stack is routed at:
// observability.langwatch.localhost. Like the dashboard and the telemetry
// fan-out it carries no slug — one stack serves every worktree, which is exactly
// what makes the langwatch.worktree tag worth stamping.
const ObservabilityService = "observability"

// ObservabilityContainer is the fixed container name. Fixed, because the stack is
// a machine-wide singleton: a second worktree finds this one and reuses it rather
// than standing up a rival collector on the same ports.
const ObservabilityContainer = "langwatch-otel-lgtm"

// ObservabilityImage is the LGTM bundle: an OTLP collector fronting Loki, Tempo
// and Prometheus, with a pre-provisioned Grafana over all three.
//
// Pinned to 0.28.0. The earlier 0.11.7 pin was made to dodge an arm64 segfault,
// but on a healthy colima VM the fault is the other way round: 0.11.7's
// OpenTelemetry Collector segfaults on startup ("Segmentation fault (core
// dumped)" in the container log) while Grafana, Loki, Tempo and Prometheus all
// come up. The collector IS the OTLP endpoint, so the whole stack ingests nothing
// — :4318 accepts the TCP connection and never answers. 0.28.0 starts all six
// processes and round-trips all three signals.
//
// Beware when re-testing: the container's own healthcheck only probes Grafana, so
// a stack with a dead collector still reports healthy. Verify by POSTing to
// /v1/{traces,logs,metrics} and reading each back, not by watching the health
// endpoint. `haven observability status` reports the image actually running.
const ObservabilityImage = "grafana/otel-lgtm:0.28.0"

// ObservabilityEndpoints are the loopback ports the stack listens on. They are
// loopback-only by construction: anonymous access to this Grafana is Admin, so it
// must never be published on 0.0.0.0.
type ObservabilityEndpoints struct {
	GrafanaPort  int `json:"grafanaPort"`
	OTLPHTTPPort int `json:"otlpHttpPort"`
	OTLPGRPCPort int `json:"otlpGrpcPort"`
}

// DefaultObservabilityEndpoints is the conventional port set. They are fixed
// rather than ephemeral because agents and gcx all need to find
// the stack without asking haven first.
func DefaultObservabilityEndpoints() ObservabilityEndpoints {
	return ObservabilityEndpoints{GrafanaPort: 3000, OTLPHTTPPort: 4318, OTLPGRPCPort: 4317}
}

// OTLPHTTPURL is the collector endpoint every service exports to.
func (e ObservabilityEndpoints) OTLPHTTPURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", e.OTLPHTTPPort)
}

// GrafanaURL is where the UI and the Grafana HTTP API answer.
func (e ObservabilityEndpoints) GrafanaURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", e.GrafanaPort)
}

// ObservabilityLimits bound what the stack may take from the machine it is
// supposed to be quietly observing — memory, CPU, and, just as importantly, disk.
//
// The bundle ships with NO retention configured for any of the three stores: out
// of the box Loki and Tempo keep every log and span forever, and only Prometheus
// has a flag for it. At local scale that is absurd. Nobody debugging their own
// dev stack wants last Tuesday's spans; they want the last hour, small enough
// that nobody notices it is there. So all three get a short retention and a hard
// size ceiling, whichever bites first.
type ObservabilityLimits struct {
	MemoryMB     int     // hard ceiling; the container is OOM-killed rather than allowed to swell
	CPUs         float64 // CPU ceiling
	PidsLimit    int     // a runaway fork loop in the bundle can't take the VM with it
	LogMaxSizeMB int     // container log rotation — otherwise stdout grows without bound
	LogMaxFiles  int

	// RetentionHours applies to Prometheus, Loki and Tempo alike: a debugging
	// window, not an archive.
	RetentionHours int
	// RetentionMB is Prometheus's TSDB size ceiling — the one store that can cap
	// itself by size as well as by age.
	RetentionMB int
	// IngestionRateMB caps how fast Loki will accept logs, so one runaway debug
	// loop can't fill the VM's disk before retention gets a chance to run.
	IngestionRateMB int
}

// DefaultObservabilityLimits sizes the stack against the machine it shares. The
// bundle is six processes (collector, Grafana, Prometheus, Loki, Tempo,
// Pyroscope) and idles around 1.2-1.5 GiB, so the floor is what it needs to start
// at all and the ceiling is what keeps it from competing with the dev stack it
// exists to observe.
func DefaultObservabilityLimits(totalRAMBytes uint64, numCPU int) ObservabilityLimits {
	memMB := clampInt(int(totalRAMBytes/(1<<20))/8, 1536, 2560)
	cpus := clampFloat(float64(numCPU)/4, 1, 2)
	return ObservabilityLimits{
		MemoryMB:        memMB,
		CPUs:            cpus,
		PidsLimit:       512,
		LogMaxSizeMB:    10,
		LogMaxFiles:     3,
		RetentionHours:  2,
		RetentionMB:     256,
		IngestionRateMB: 16,
	}
}

// Retention is the age ceiling in the duration form every one of the three stores
// happens to accept.
func (l ObservabilityLimits) Retention() string {
	return fmt.Sprintf("%dh", l.RetentionHours)
}

// PrometheusExtraArgs caps Prometheus's TSDB by age AND by size. Loki and Tempo
// have no equivalent flags, so their retention is set in their configs instead —
// see PatchLokiConfig / PatchTempoConfig.
func (l ObservabilityLimits) PrometheusExtraArgs() string {
	return fmt.Sprintf("--storage.tsdb.retention.time=%s --storage.tsdb.retention.size=%dMB",
		l.Retention(), l.RetentionMB)
}

// ColimaLimits bound the VM the stack runs in. Colima is the container runtime
// here rather than Docker Desktop precisely because the VM's ceiling is explicit
// and per-profile, so an observability stack can never eat the whole machine.
type ColimaLimits struct {
	CPUs      int
	MemoryGiB int
	DiskGiB   int
}

// DefaultColimaLimits sizes a VM haven creates itself. It is only ever applied at
// creation: an existing profile keeps the shape its owner gave it, because
// resizing someone's running VM out from under them is not haven's business.
func DefaultColimaLimits(totalRAMBytes uint64, numCPU int) ColimaLimits {
	return ColimaLimits{
		CPUs:      clampInt(numCPU/2, 2, 4),
		MemoryGiB: clampInt(int(totalRAMBytes/(1<<30))/4, 4, 8),
		DiskGiB:   30,
	}
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampFloat(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
