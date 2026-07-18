package config

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"
)

// The debug collector is a tenant-agnostic copy of every span the service
// produces. The only deployments where that is acceptable are ones where the
// destination cannot be anything but the developer's own machine — so the
// guard is on the destination address, never on what an environment calls
// itself.
func TestOTelValidate_AcceptsOnMachineDebugCollectors(t *testing.T) {
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
		o := OTel{SampleRatio: 1, DebugCollectorEndpoint: endpoint}
		assert.NoError(t, o.Validate(), "on-machine endpoint %q must be accepted", endpoint)
	}
}

func TestOTelValidate_RejectsOffBoxDebugCollectors(t *testing.T) {
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
		o := OTel{SampleRatio: 1, DebugCollectorEndpoint: endpoint}
		assert.Error(t, o.Validate(), "off-box endpoint %q must be refused at boot", endpoint)
	}
}

func TestOTelValidate_AcceptsAbsentDebugCollector(t *testing.T) {
	o := OTel{SampleRatio: DefaultNonLocalSampleRatio}

	assert.NoError(t, o.Validate(), "the prod default — no debug collector — must validate")
}

// A ratio outside [0,1] resolves to a sampler extreme instead of erroring;
// NaN is reachable because strconv.ParseFloat accepts the literal "NaN" and
// compares false against everything. All of them must die at boot, before the
// sampler quietly inverts what the operator asked for.
func TestOTelValidate_RejectsOutOfRangeSampleRatio(t *testing.T) {
	for _, ratio := range []float64{-1, -0.001, 1.001, 10, math.NaN()} {
		o := OTel{SampleRatio: ratio}
		assert.Error(t, o.Validate(), "ratio %v must be refused before it reaches the sampler", ratio)
	}
}

func TestOTelValidate_AcceptsTheFullSampleRatioRange(t *testing.T) {
	for _, ratio := range []float64{0, 0.1, 0.5, 1} {
		o := OTel{SampleRatio: ratio}
		assert.NoError(t, o.Validate(), "ratio %v is a legitimate operator choice", ratio)
	}
}
