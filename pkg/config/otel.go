package config

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/pkg/otelsetup"
)

// OTel holds the OpenTelemetry configuration for a service's OWN operational
// telemetry, hydrated from the OFFICIAL OpenTelemetry environment variables.
// The embedding tag `env:"OTEL"` plus the field tags below resolve to the
// real names — e.g. OTEL_EXPORTER_OTLP_ENDPOINT — so a single shell or pod
// env block configures every LangWatch process (Go services and the TS app)
// identically.
//
// The LangWatch-only names that predate this scheme (OTEL_OTLP_ENDPOINT,
// OTEL_OTLP_HEADERS, OTEL_SAMPLE_RATIO) remain readable as DEPRECATED
// fallbacks. An official name and its fallback set to DIFFERENT values is a
// boot error: precedence between two live values is never silently guessed.
//
// The OTEL_* namespace configures LangWatch telemetry ONLY. Customer trace
// destinations are product configuration — per-project OTLP tokens, the
// customer trace bridge, LANGWATCH_ENDPOINT — and must never be sourced from
// these variables. That split is what bounds the blast radius of a config
// mistake: a bad OTEL_* value can misroute OUR spans, never a tenant's.
type OTel struct {
	// ExporterEndpoint is OTEL_EXPORTER_OTLP_ENDPOINT: the base URL of the
	// collector for LangWatch's own telemetry. Per-signal paths (/v1/traces,
	// /v1/metrics) are appended. Empty — and no fallback set — means the
	// exporter is OFF: we never fall back to the SDK's localhost default,
	// because "where does our telemetry go" must always be an explicit answer.
	ExporterEndpoint string `env:"EXPORTER_OTLP_ENDPOINT"`
	// ExporterHeaders is OTEL_EXPORTER_OTLP_HEADERS ("k=v,k2=v2", values may
	// be percent-encoded per the W3C baggage format).
	ExporterHeaders string `env:"EXPORTER_OTLP_HEADERS"`
	// ExporterTracesEndpoint is the signal-specific
	// OTEL_EXPORTER_OTLP_TRACES_ENDPOINT. Per spec it is used AS-IS (no path
	// appended) and wins over ExporterEndpoint for traces.
	ExporterTracesEndpoint string `env:"EXPORTER_OTLP_TRACES_ENDPOINT"`
	// ExporterTracesHeaders is OTEL_EXPORTER_OTLP_TRACES_HEADERS; wins over
	// ExporterHeaders for traces.
	ExporterTracesHeaders string `env:"EXPORTER_OTLP_TRACES_HEADERS"`
	// ExporterProtocol is OTEL_EXPORTER_OTLP_PROTOCOL. LangWatch exporters
	// speak http/protobuf only; any other value is a boot error rather than a
	// silently ignored intent.
	ExporterProtocol string `env:"EXPORTER_OTLP_PROTOCOL"`
	// ExporterMetricsEndpoint / ExporterLogsEndpoint are the remaining
	// signal-specific official names. They are read solely so a set value can
	// be WARNED about instead of silently ignored — per-signal destination
	// overrides beyond traces are not supported.
	ExporterMetricsEndpoint string `env:"EXPORTER_OTLP_METRICS_ENDPOINT"`
	ExporterLogsEndpoint    string `env:"EXPORTER_OTLP_LOGS_ENDPOINT"`
	// TracesExporter is OTEL_TRACES_EXPORTER: "otlp" (the default) or "none"
	// to turn span export off while keeping metrics.
	TracesExporter string `env:"TRACES_EXPORTER"`
	// TracesSampler + TracesSamplerArg are OTEL_TRACES_SAMPLER /
	// OTEL_TRACES_SAMPLER_ARG. Supported kinds: always_on, always_off,
	// traceidratio, parentbased_always_on, parentbased_always_off,
	// parentbased_traceidratio. The ratio kinds REQUIRE the arg — relying on
	// an implementation-defined default ratio is exactly the kind of luck
	// this config refuses.
	TracesSampler    string `env:"TRACES_SAMPLER"`
	TracesSamplerArg string `env:"TRACES_SAMPLER_ARG"`
	// SDKDisabled is OTEL_SDK_DISABLED: true turns every exporter (primary
	// and debug) off. Other values are still validated — a disabled SDK is
	// not a license to keep broken telemetry config around.
	SDKDisabled bool `env:"SDK_DISABLED"`

	// OTLPEndpoint / OTLPHeaders / SampleRatio are the DEPRECATED
	// LangWatch-only names (OTEL_OTLP_ENDPOINT, OTEL_OTLP_HEADERS,
	// OTEL_SAMPLE_RATIO). Still honored so existing deployments keep tracing;
	// each use logs a rename warning at boot.
	OTLPEndpoint string  `env:"OTLP_ENDPOINT"`
	OTLPHeaders  string  `env:"OTLP_HEADERS"`
	SampleRatio  float64 `env:"SAMPLE_RATIO"`
	// SampleRatioSet distinguishes an explicit 0 from an omitted environment
	// variable. It is set by service LoadConfig after Hydrate, because the
	// generic env hydrator intentionally skips empty values.
	SampleRatioSet bool

	// DebugCollectorEndpoint is an OPTIONAL second OTLP/HTTP endpoint —
	// typically a developer's local observability stack (OTel Collector
	// + Loki/Tempo/Prometheus/Grafana) on http://localhost:4318. When
	// set, the service ADDITIONALLY ships its own operational telemetry
	// there: a second span exporter (traces are dual-exported, never
	// diverted from the primary product pipeline), plus net-new OTLP
	// logs and OTLP metrics. This is the base URL only — the per-signal
	// paths (/v1/traces, /v1/logs, /v1/metrics) are appended by
	// otelsetup. Empty (the default everywhere, prod included) means
	// none of the debug-collector behavior is installed. A LangWatch
	// extension: there is no official OTel name for a second collector.
	DebugCollectorEndpoint string `env:"DEBUG_COLLECTOR_ENDPOINT"`
	// DebugCollectorHeaders carries optional auth headers for the debug
	// collector, in the OTEL_EXPORTER_OTLP_HEADERS "k=v,k2=v2" format.
	DebugCollectorHeaders string `env:"DEBUG_COLLECTOR_HEADERS"`

	// resolved is populated by Resolve. Accessors panic when it is unset so a
	// missing Resolve call fails the first test that touches telemetry,
	// instead of silently exporting with half-applied configuration.
	resolved resolvedOTel
}

type resolvedOTel struct {
	set bool
	// baseEndpoint is the collector base URL (no signal path); feeds
	// PrimaryOTLP for callers that POST OTLP payloads directly.
	baseEndpoint string
	// tracesEndpoint / metricsEndpoint are full per-signal URLs. Empty means
	// that signal's primary exporter is off.
	tracesEndpoint  string
	metricsEndpoint string
	headers         map[string]string
	sampler         otelsetup.SamplerChoice
}

// UnsetSampleRatio is retained for default configuration literals. Use
// SampleRatioSet to distinguish it from an explicit 0 read from the
// OTEL_SAMPLE_RATIO environment variable.
const UnsetSampleRatio = 0

// Resolve reconciles the official OpenTelemetry environment variables with
// the deprecated LangWatch names and the service defaults, then
// validates the result. Call exactly once from LoadConfig, after Hydrate and
// after SampleRatioSet is stamped; every telemetry accessor below requires it.
//
// Everything here fails closed at boot rather than at the first exported
// span: a conflicting or out-of-range value is not discoverable from inside
// the running service, so the only place it can be caught is the place it is
// read.
func (o *OTel) Resolve() error {
	baseEndpoint, err := o.resolveBaseEndpoint()
	if err != nil {
		return err
	}
	headers, err := o.resolveHeaders()
	if err != nil {
		return err
	}
	sampler, err := o.resolveSampler()
	if err != nil {
		return err
	}
	if err := o.validateFixedVocabulary(); err != nil {
		return err
	}
	// The debug collector is a tenant-agnostic dual export: every span the
	// service produces is copied there, including spans the per-tenant router
	// would otherwise route by the originating project's key (nlpgo) or drop
	// for lack of one. That is exactly what makes it useful on a laptop and
	// unacceptable anywhere customer data flows. ADR-042 specifies it as
	// local-only; this makes that specification enforceable.
	if o.DebugCollectorEndpoint != "" {
		if err := debugCollectorMustBeLocal(o.DebugCollectorEndpoint); err != nil {
			return err
		}
	}
	for _, warning := range o.unsupportedVarWarnings() {
		slog.Warn("otel config", "warning", warning)
	}

	r := resolvedOTel{set: true, headers: headers, sampler: sampler}
	if !o.SDKDisabled {
		if strings.EqualFold(strings.TrimSpace(o.TracesExporter), "none") {
			// Span export is off, so no span-carrying endpoint may survive.
			// baseEndpoint is what PrimaryOTLP hands to callers that POST
			// spans themselves (the langy relay), and those bypass the SDK
			// exporter entirely — leaving it set would keep shipping spans
			// after the operator asked for none. Leaving both empty is the
			// whole mechanism: no field here carries a span destination.
		} else {
			r.baseEndpoint = baseEndpoint
			if tracesOverride := strings.TrimSpace(o.ExporterTracesEndpoint); tracesOverride != "" {
				r.tracesEndpoint = tracesOverride
			} else {
				r.tracesEndpoint = withTracesPath(baseEndpoint)
			}
		}
		if baseEndpoint != "" {
			r.metricsEndpoint = strings.TrimRight(baseEndpoint, "/") + "/v1/metrics"
		}
	}
	o.resolved = r
	return nil
}

// resolveBaseEndpoint reconciles OTEL_EXPORTER_OTLP_ENDPOINT with the
// deprecated OTEL_OTLP_ENDPOINT.
func (o *OTel) resolveBaseEndpoint() (string, error) {
	official := strings.TrimSpace(o.ExporterEndpoint)
	legacy := strings.TrimSpace(o.OTLPEndpoint)
	switch {
	case official != "" && legacy != "" && !equalEndpoint(official, legacy):
		return "", fmt.Errorf(
			"OTEL_EXPORTER_OTLP_ENDPOINT (%q) and deprecated OTEL_OTLP_ENDPOINT (%q) disagree — remove the deprecated one",
			official, legacy,
		)
	case official != "":
		return official, nil
	case legacy != "":
		slog.Warn("otel config", "warning",
			"OTEL_OTLP_ENDPOINT is deprecated — rename to the official OTEL_EXPORTER_OTLP_ENDPOINT")
		return legacy, nil
	}
	return "", nil
}

// resolveHeaders reconciles the official headers pair with the deprecated
// OTEL_OTLP_HEADERS.
func (o *OTel) resolveHeaders() (map[string]string, error) {
	official := strings.TrimSpace(o.ExporterHeaders)
	if tracesOverride := strings.TrimSpace(o.ExporterTracesHeaders); tracesOverride != "" {
		official = tracesOverride
	}
	legacy := strings.TrimSpace(o.OTLPHeaders)
	switch {
	case official != "" && legacy != "" && official != legacy:
		return nil, fmt.Errorf(
			"OTEL_EXPORTER_OTLP_HEADERS and deprecated OTEL_OTLP_HEADERS are both set with different values — remove the deprecated one",
		)
	case official != "":
		return parseHeaders(official), nil
	case legacy != "":
		slog.Warn("otel config", "warning",
			"OTEL_OTLP_HEADERS is deprecated — rename to the official OTEL_EXPORTER_OTLP_HEADERS")
		return parseHeaders(legacy), nil
	}
	return nil, nil
}

// officialSamplerKinds is the supported subset of the official
// OTEL_TRACES_SAMPLER vocabulary, mapped onto (parentBased, needsArg).
var officialSamplerKinds = map[string]struct {
	parentBased bool
	needsArg    bool
	fixedRatio  float64
}{
	"always_on":                {parentBased: false, needsArg: false, fixedRatio: 1},
	"always_off":               {parentBased: false, needsArg: false, fixedRatio: 0},
	"traceidratio":             {parentBased: false, needsArg: true},
	"parentbased_always_on":    {parentBased: true, needsArg: false, fixedRatio: 1},
	"parentbased_always_off":   {parentBased: true, needsArg: false, fixedRatio: 0},
	"parentbased_traceidratio": {parentBased: true, needsArg: true},
}

// resolveSampler reconciles OTEL_TRACES_SAMPLER(+ARG) with the deprecated
// OTEL_SAMPLE_RATIO and the full-sampling default.
func (o *OTel) resolveSampler() (otelsetup.SamplerChoice, error) {
	legacySet := o.SampleRatioSet || o.SampleRatio != UnsetSampleRatio
	if kind := strings.ToLower(strings.TrimSpace(o.TracesSampler)); kind != "" {
		if legacySet {
			return otelsetup.SamplerChoice{}, fmt.Errorf(
				"OTEL_TRACES_SAMPLER and deprecated OTEL_SAMPLE_RATIO are both set — remove the deprecated one",
			)
		}
		spec, ok := officialSamplerKinds[kind]
		if !ok {
			return otelsetup.SamplerChoice{}, fmt.Errorf(
				"OTEL_TRACES_SAMPLER %q is not supported — use one of always_on, always_off, traceidratio, parentbased_always_on, parentbased_always_off, parentbased_traceidratio",
				o.TracesSampler,
			)
		}
		ratio := spec.fixedRatio
		if spec.needsArg {
			arg := strings.TrimSpace(o.TracesSamplerArg)
			if arg == "" {
				return otelsetup.SamplerChoice{}, fmt.Errorf(
					"OTEL_TRACES_SAMPLER=%s requires OTEL_TRACES_SAMPLER_ARG (a ratio between 0 and 1)", kind,
				)
			}
			parsed, err := strconv.ParseFloat(arg, 64)
			if err != nil {
				return otelsetup.SamplerChoice{}, fmt.Errorf("OTEL_TRACES_SAMPLER_ARG %q is not a number", arg)
			}
			if err := validRatio(parsed, "OTEL_TRACES_SAMPLER_ARG"); err != nil {
				return otelsetup.SamplerChoice{}, err
			}
			ratio = parsed
		}
		return otelsetup.SamplerChoice{ParentBased: spec.parentBased, Ratio: ratio}, nil
	}

	if legacySet {
		if o.SampleRatioSet {
			slog.Warn("otel config", "warning",
				"OTEL_SAMPLE_RATIO is deprecated — use OTEL_TRACES_SAMPLER=parentbased_traceidratio with OTEL_TRACES_SAMPLER_ARG")
		}
		if err := validRatio(o.SampleRatio, "OTEL_SAMPLE_RATIO"); err != nil {
			return otelsetup.SamplerChoice{}, err
		}
		return otelsetup.SamplerChoice{ParentBased: true, Ratio: o.SampleRatio}, nil
	}

	// Default: parent-based, sample everything — the OTel spec default
	// (parentbased_always_on), in every environment. A lowered default is
	// indistinguishable from a broken exporter on quiet services, and on the
	// multi-tenant customer path (nlpgo) anything less than full sampling
	// silently drops customer trace data. Operators opt into downsampling
	// explicitly with OTEL_TRACES_SAMPLER(+_ARG).
	return otelsetup.SamplerChoice{ParentBased: true, Ratio: 1.0}, nil
}

// validRatio rejects ratios outside [0,1]. NaN needs the explicit check:
// strconv.ParseFloat accepts the literal "NaN", and every NaN comparison is
// false, so it would sail through the range check and silently land on
// NeverSample — all tracing off, no error anywhere.
func validRatio(ratio float64, name string) error {
	if math.IsNaN(ratio) || ratio < 0 || ratio > 1 {
		return fmt.Errorf("%s must be between 0 and 1, got %v — 0 exports no traces, 1 exports all of them", name, ratio)
	}
	return nil
}

// validateFixedVocabulary rejects values of supported official vars outside
// what LangWatch exporters implement. A stated-but-unfulfillable intent (e.g.
// protocol grpc) is an error; see unsupportedVarWarnings for the vars whose
// setting merely has no effect.
func (o *OTel) validateFixedVocabulary() error {
	if p := strings.TrimSpace(o.ExporterProtocol); p != "" && !strings.EqualFold(p, "http/protobuf") {
		return fmt.Errorf(
			"OTEL_EXPORTER_OTLP_PROTOCOL %q is not supported — LangWatch exporters speak http/protobuf only", p,
		)
	}
	if t := strings.ToLower(strings.TrimSpace(o.TracesExporter)); t != "" && t != "otlp" && t != "none" {
		return fmt.Errorf("OTEL_TRACES_EXPORTER %q is not supported — use \"otlp\" or \"none\"", o.TracesExporter)
	}
	return nil
}

// unsupportedVarWarnings lists set-but-ineffective official vars, so a value
// someone expects to matter never disappears silently.
func (o *OTel) unsupportedVarWarnings() []string {
	var warnings []string
	if strings.TrimSpace(o.ExporterMetricsEndpoint) != "" {
		warnings = append(warnings,
			"OTEL_EXPORTER_OTLP_METRICS_ENDPOINT is not supported and ignored — metrics go to OTEL_EXPORTER_OTLP_ENDPOINT + /v1/metrics")
	}
	if strings.TrimSpace(o.ExporterLogsEndpoint) != "" {
		warnings = append(warnings,
			"OTEL_EXPORTER_OTLP_LOGS_ENDPOINT is not supported and ignored — OTLP logs ship only to the debug collector")
	}
	return warnings
}

func equalEndpoint(a, b string) bool {
	return strings.EqualFold(strings.TrimRight(a, "/"), strings.TrimRight(b, "/"))
}

// withTracesPath appends /v1/traces to a base endpoint unless already present.
func withTracesPath(endpoint string) string {
	if endpoint == "" || strings.HasSuffix(endpoint, "/v1/traces") {
		return endpoint
	}
	return strings.TrimRight(endpoint, "/") + "/v1/traces"
}

// debugCollectorMustBeLocal rejects a debug-collector endpoint that is not on
// the machine running the service.
//
// The check is deliberately on the DESTINATION, not on ENVIRONMENT. What makes
// the debug collector safe is not what an environment is named — a name is a
// free-text env var, and "dev"/"test" are exactly the values a shared cluster
// holding real customer data is most likely to carry — but that the spans
// cannot leave the developer's own machine. A hostname is checkable and a typo
// cannot forge one; a name allowlist would hand the switch to anyone who set
// ENVIRONMENT=test.
//
// Loopback forms only: `localhost`, literal 127.0.0.0/8 and ::1, `*.localhost`
// (the portless dev hostnames) — which is additionally RESOLVED and required
// to answer with loopback addresses only, because RFC 6761 recommends but does
// not guarantee that resolvers keep .localhost on-box — and
// `host.docker.internal` for containerised dev stacks (inherently the host's
// gateway address; the escape hatch's whole point). Private ranges are NOT
// accepted — 10.x and 192.168.x are ordinary in-cluster addresses, so
// allowing them would readmit the deployment this check exists to refuse.
func debugCollectorMustBeLocal(endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil {
		return fmt.Errorf("OTEL_DEBUG_COLLECTOR_ENDPOINT is not a valid URL: %w", err)
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || host == "host.docker.internal" {
		return nil
	}
	if strings.HasSuffix(host, ".localhost") {
		ips, err := lookupHostIPs(host)
		if err != nil {
			return fmt.Errorf(
				"OTEL_DEBUG_COLLECTOR_ENDPOINT host %q did not resolve — use localhost or 127.0.0.1 instead: %w",
				host, err,
			)
		}
		if len(ips) == 0 {
			return fmt.Errorf(
				"OTEL_DEBUG_COLLECTOR_ENDPOINT host %q resolved to no addresses — use localhost or 127.0.0.1 instead",
				host,
			)
		}
		for _, ip := range ips {
			if !ip.IsLoopback() {
				return fmt.Errorf(
					"OTEL_DEBUG_COLLECTOR_ENDPOINT host %q resolves to the non-loopback address %s — a .localhost name must stay on this machine",
					host, ip,
				)
			}
		}
		return nil
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return nil
	}
	return fmt.Errorf(
		"OTEL_DEBUG_COLLECTOR_ENDPOINT must point at a collector on this machine (localhost, 127.0.0.1, ::1, *.localhost, or host.docker.internal), got %q — the debug collector receives every tenant's spans with no per-tenant routing, so it must never ship them off-box",
		u.Host,
	)
}

// lookupHostIPs is indirected so tests can pin resolver behavior instead of
// depending on the machine's DNS handling of .localhost names.
var lookupHostIPs = net.LookupIP

// mustBeResolved guards every accessor that reads resolved state. A missing
// Resolve call is a programming error that would otherwise export telemetry
// with half-applied configuration — panic so it cannot survive a test run.
func (o *OTel) mustBeResolved() {
	if !o.resolved.set {
		panic("config.OTel: Resolve was not called before reading telemetry configuration")
	}
}

// SamplerChoice returns the resolved sampling decision. Requires Resolve.
func (o *OTel) SamplerChoice() otelsetup.SamplerChoice {
	o.mustBeResolved()
	return o.resolved.sampler
}

// DebugCollector returns the debug-collector base endpoint (no signal
// path) and its parsed headers. An empty endpoint means the debug
// collector is disabled. Exposed for services (e.g. nlpgo) that build
// otelsetup.Options directly instead of going through Configure.
func (o *OTel) DebugCollector() (endpoint string, headers map[string]string) {
	if o.SDKDisabled {
		return "", nil
	}
	return o.DebugCollectorEndpoint, parseHeaders(o.DebugCollectorHeaders)
}

// PrimaryOTLP returns the resolved primary collector base endpoint (no signal
// path) and its parsed headers. Exposed for callers that forward OTLP payloads
// directly rather than through the SDK exporter — e.g. the Langy relay shipping
// LangWatch's own copy of worker telemetry. Requires Resolve. Note the
// signal-specific OTEL_EXPORTER_OTLP_TRACES_ENDPOINT override does NOT feed
// this path — direct forwarders compose their own signal URL from the base.
//
// Every consumer today POSTs spans, so OTEL_TRACES_EXPORTER=none empties this
// too: an operator who turned span export off must not keep receiving spans
// from a forwarder that never touches the SDK exporter.
func (o *OTel) PrimaryOTLP() (endpoint string, headers map[string]string) {
	o.mustBeResolved()
	return o.resolved.baseEndpoint, o.resolved.headers
}

// Configure initializes the OTel provider from the resolved config, returning
// a Provider whose Shutdown method flushes pending telemetry. Requires Resolve.
func (o *OTel) Configure(ctx context.Context, nodeID string) (*otelsetup.Provider, error) {
	o.mustBeResolved()
	debugEndpoint, debugHeaders := o.DebugCollector()
	return otelsetup.New(ctx, otelsetup.Options{
		NodeID:                 nodeID,
		OTLPEndpoint:           o.resolved.tracesEndpoint,
		MetricsEndpoint:        o.resolved.metricsEndpoint,
		OTLPHeaders:            o.resolved.headers,
		Sampler:                o.resolved.sampler,
		DebugCollectorEndpoint: debugEndpoint,
		DebugCollectorHeaders:  debugHeaders,
	})
}

// parseHeaders parses an OTLP headers string ("key=value,key2=value2") into a
// map. Follows the W3C Baggage / OTEL_EXPORTER_OTLP_HEADERS format; values may
// be percent-encoded (a value that is not valid percent-encoding is kept raw).
func parseHeaders(raw string) map[string]string {
	if raw == "" {
		return nil
	}
	headers := make(map[string]string)
	for _, pair := range strings.Split(raw, ",") {
		k, v, ok := strings.Cut(pair, "=")
		if !ok {
			continue
		}
		v = strings.TrimSpace(v)
		if decoded, err := url.PathUnescape(v); err == nil {
			v = decoded
		}
		headers[strings.TrimSpace(k)] = v
	}
	if len(headers) == 0 {
		return nil
	}
	return headers
}
