package config

import (
	"errors"
	"math"
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// stubLocalhostDNS pins the .localhost resolver so these tests don't depend
// on the machine's DNS handling of the .localhost TLD (native loopback on
// macOS/systemd-resolved, NXDOMAIN elsewhere).
func stubLocalhostDNS(t *testing.T, ips []net.IP, err error) {
	t.Helper()
	prev := lookupHostIPs
	lookupHostIPs = func(string) ([]net.IP, error) { return ips, err }
	t.Cleanup(func() { lookupHostIPs = prev })
}

// The debug collector is a tenant-agnostic copy of every span the service
// produces. The only deployments where that is acceptable are ones where the
// destination cannot be anything but the developer's own machine — so the
// guard is on the destination address, never on what an environment calls
// itself.
func TestResolve_AcceptsOnMachineDebugCollectors(t *testing.T) {
	stubLocalhostDNS(t, []net.IP{net.ParseIP("127.0.0.1")}, nil)
	for _, endpoint := range []string{
		"http://localhost:4318",
		"http://LocalHost:4318",
		"http://127.0.0.1:4318",
		"http://127.0.0.2:4318",
		"http://[::1]:4318",
		"http://observability.langwatch.localhost",
		"https://telemetry.mystack.localhost:4318",
		"http://host.docker.internal:4318",
	} {
		o := OTel{DebugCollectorEndpoint: endpoint}
		assert.NoError(t, o.Resolve("local"), "on-machine endpoint %q must be accepted", endpoint)
	}
}

// RFC 6761 recommends but does not guarantee that .localhost stays on-box: a
// corporate wildcard, a search domain, or an /etc/hosts entry can point one
// off the machine. The name is therefore resolved and every answer must be
// loopback — and a name that does not resolve at all is refused rather than
// trusted on suffix.
func TestResolve_RejectsLocalhostNamesThatResolveOffBox(t *testing.T) {
	stubLocalhostDNS(t, []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("10.0.12.3")}, nil)
	o := OTel{DebugCollectorEndpoint: "http://observability.langwatch.localhost:4318"}

	assert.Error(t, o.Resolve("local"))
}

func TestResolve_RejectsLocalhostNamesThatDoNotResolve(t *testing.T) {
	stubLocalhostDNS(t, nil, errors.New("no such host"))
	o := OTel{DebugCollectorEndpoint: "http://observability.langwatch.localhost:4318"}

	assert.Error(t, o.Resolve("local"))
}

func TestResolve_RejectsOffBoxDebugCollectors(t *testing.T) {
	stubLocalhostDNS(t, []net.IP{net.ParseIP("127.0.0.1")}, nil)
	for _, endpoint := range []string{
		"http://collector.observability.svc.cluster.local:4318",
		"https://otlp.grafana.net",
		"http://10.0.12.3:4318",
		"http://192.168.1.20:4318",
		"http://172.16.0.5:4318",
		"http://localhost.evil.com:4318",
		"http://notlocalhost:4318",
		"http://[fe80::1]:4318",
	} {
		o := OTel{DebugCollectorEndpoint: endpoint}
		assert.Error(t, o.Resolve("local"), "off-box endpoint %q must be refused at boot", endpoint)
	}
}

// A ratio outside [0,1] resolves to a sampler extreme instead of erroring;
// NaN is reachable because strconv.ParseFloat accepts the literal "NaN" and
// compares false against everything. All of them must die at boot, before the
// sampler quietly inverts what the operator asked for.
func TestResolve_RejectsOutOfRangeLegacySampleRatio(t *testing.T) {
	for _, ratio := range []float64{-1, -0.001, 1.001, 10} {
		o := OTel{SampleRatio: ratio}
		require.Error(t, o.Resolve("production"), "ratio %v must be refused before it reaches the sampler", ratio)
	}
	nan := OTel{SampleRatioSet: true, SampleRatio: math.NaN()}
	require.Error(t, nan.Resolve("production"), "NaN must be refused before it reaches the sampler")
}

func TestResolve_AcceptsTheFullLegacySampleRatioRange(t *testing.T) {
	for _, ratio := range []float64{0, 0.1, 0.5, 1} {
		o := OTel{SampleRatioSet: true, SampleRatio: ratio}
		assert.NoError(t, o.Resolve("production"), "ratio %v is a legitimate operator choice", ratio)
	}
}

// ---- Endpoint resolution: official name, deprecated fallback, conflicts ----

func TestResolve_UsesTheOfficialEndpoint(t *testing.T) {
	o := OTel{ExporterEndpoint: "http://collector:4318"}
	require.NoError(t, o.Resolve("production"))

	base, _ := o.PrimaryOTLP()
	assert.Equal(t, "http://collector:4318", base)
	assert.Equal(t, "http://collector:4318/v1/traces", o.resolved.tracesEndpoint)
	assert.Equal(t, "http://collector:4318/v1/metrics", o.resolved.metricsEndpoint)
}

func TestResolve_HonoursTheDeprecatedEndpointName(t *testing.T) {
	o := OTel{OTLPEndpoint: "http://collector:4318"}
	require.NoError(t, o.Resolve("production"))

	base, _ := o.PrimaryOTLP()
	assert.Equal(t, "http://collector:4318", base, "existing deployments must keep tracing through the rename")
}

func TestResolve_AcceptsBothEndpointNamesWhenEqual(t *testing.T) {
	// The transition state: charts emit the same value under both names.
	o := OTel{
		ExporterEndpoint: "http://collector:4318/",
		OTLPEndpoint:     "http://collector:4318",
	}

	assert.NoError(t, o.Resolve("production"), "equal values (modulo trailing slash) are not a conflict")
}

// Two different live values is ambiguity; precedence is never silently
// guessed, because whichever guess is wrong ships our telemetry to the
// wrong place with no error anywhere.
func TestResolve_RefusesConflictingEndpointNames(t *testing.T) {
	o := OTel{
		ExporterEndpoint: "http://collector:4318",
		OTLPEndpoint:     "http://other:4318",
	}

	assert.Error(t, o.Resolve("production"))
}

func TestResolve_LeavesTheExporterOffWhenNothingIsConfigured(t *testing.T) {
	o := OTel{}
	require.NoError(t, o.Resolve("production"))

	base, headers := o.PrimaryOTLP()
	assert.Empty(t, base, "no endpoint must mean OFF — never the SDK's localhost default")
	assert.Nil(t, headers)
	assert.Empty(t, o.resolved.tracesEndpoint)
	assert.Empty(t, o.resolved.metricsEndpoint)
}

func TestResolve_UsesTheSignalSpecificTracesEndpointAsIs(t *testing.T) {
	o := OTel{
		ExporterEndpoint:       "http://collector:4318",
		ExporterTracesEndpoint: "http://collector:4318/custom/traces",
	}
	require.NoError(t, o.Resolve("production"))

	assert.Equal(t, "http://collector:4318/custom/traces", o.resolved.tracesEndpoint,
		"per spec the signal-specific endpoint is used verbatim, no path appended")
	base, _ := o.PrimaryOTLP()
	assert.Equal(t, "http://collector:4318", base,
		"direct OTLP forwarders keep composing from the base endpoint")
}

// ---- Headers ----

func TestResolve_ParsesOfficialHeaders(t *testing.T) {
	o := OTel{ExporterHeaders: "X-Auth-Token=tok,X-Team=obs"}
	require.NoError(t, o.Resolve("production"))

	_, headers := o.PrimaryOTLP()
	assert.Equal(t, map[string]string{"X-Auth-Token": "tok", "X-Team": "obs"}, headers)
}

func TestResolve_DecodesPercentEncodedHeaderValues(t *testing.T) {
	// The W3C baggage format used by OTEL_EXPORTER_OTLP_HEADERS percent-encodes
	// values; Grafana Cloud's copy-paste examples rely on it.
	o := OTel{ExporterHeaders: "Authorization=Basic%20dXNlcjp0b2tlbg=="}
	require.NoError(t, o.Resolve("production"))

	_, headers := o.PrimaryOTLP()
	assert.Equal(t, "Basic dXNlcjp0b2tlbg==", headers["Authorization"])
}

func TestResolve_TracesSpecificHeadersWin(t *testing.T) {
	o := OTel{
		ExporterHeaders:       "X-Auth-Token=base",
		ExporterTracesHeaders: "X-Auth-Token=traces",
	}
	require.NoError(t, o.Resolve("production"))

	_, headers := o.PrimaryOTLP()
	assert.Equal(t, "traces", headers["X-Auth-Token"])
}

func TestResolve_RefusesConflictingHeaderNames(t *testing.T) {
	o := OTel{
		ExporterHeaders: "X-Auth-Token=a",
		OTLPHeaders:     "X-Auth-Token=b",
	}

	assert.Error(t, o.Resolve("production"))
}

func TestResolve_HonoursTheDeprecatedHeadersName(t *testing.T) {
	o := OTel{OTLPHeaders: "X-Auth-Token=tok"}
	require.NoError(t, o.Resolve("production"))

	_, headers := o.PrimaryOTLP()
	assert.Equal(t, "tok", headers["X-Auth-Token"])
}

// ---- Fixed vocabularies ----

func TestResolve_RefusesUnsupportedProtocols(t *testing.T) {
	for _, protocol := range []string{"grpc", "http/json"} {
		o := OTel{ExporterProtocol: protocol}
		require.Error(t, o.Resolve("production"),
			"protocol %q states an intent our exporters cannot satisfy — silence would be a lie", protocol)
	}
}

func TestResolve_AcceptsTheSupportedProtocol(t *testing.T) {
	for _, protocol := range []string{"", "http/protobuf", "HTTP/Protobuf"} {
		o := OTel{ExporterProtocol: protocol}
		assert.NoError(t, o.Resolve("production"))
	}
}

func TestResolve_TracesExporterNoneTurnsOnlySpansOff(t *testing.T) {
	o := OTel{ExporterEndpoint: "http://collector:4318", TracesExporter: "none"}
	require.NoError(t, o.Resolve("production"))

	assert.Empty(t, o.resolved.tracesEndpoint)
	assert.Equal(t, "http://collector:4318/v1/metrics", o.resolved.metricsEndpoint,
		"OTEL_TRACES_EXPORTER governs traces, not metrics")

	// PrimaryOTLP feeds the langy relay's direct span POST. Leaving it live
	// here would keep shipping spans after the operator turned span export
	// off — an off-switch that does not switch off.
	base, _ := o.PrimaryOTLP()
	assert.Empty(t, base, "no span-carrying endpoint may survive OTEL_TRACES_EXPORTER=none")
}

func TestResolve_RefusesUnknownTracesExporters(t *testing.T) {
	o := OTel{TracesExporter: "console"}

	assert.Error(t, o.Resolve("production"))
}

// ---- OTEL_SDK_DISABLED ----

func TestResolve_SDKDisabledTurnsEverythingOff(t *testing.T) {
	o := OTel{
		SDKDisabled:            true,
		ExporterEndpoint:       "http://collector:4318",
		DebugCollectorEndpoint: "http://localhost:4318",
	}
	require.NoError(t, o.Resolve("local"))

	base, _ := o.PrimaryOTLP()
	assert.Empty(t, base)
	assert.Empty(t, o.resolved.tracesEndpoint)
	assert.Empty(t, o.resolved.metricsEndpoint)
	debugEndpoint, _ := o.DebugCollector()
	assert.Empty(t, debugEndpoint)
}

// ---- Ordering guard ----

// Reading telemetry configuration before Resolve is a programming error that
// would otherwise export with half-applied settings. It must not survive the
// first test that touches it.
func TestAccessorsPanicBeforeResolve(t *testing.T) {
	o := OTel{ExporterEndpoint: "http://collector:4318"}

	assert.Panics(t, func() { o.SamplerChoice() })
	assert.Panics(t, func() { o.PrimaryOTLP() })
}
