package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/otelsetup"
)

func mustResolveSampler(t *testing.T, o OTel, environment string) otelsetup.SamplerChoice {
	t.Helper()
	require.NoError(t, o.Resolve(environment))
	return o.SamplerChoice()
}

// The regression this guards: services defaulted SampleRatio to 1.0 and then
// rewrote any 1.0 outside local development to 0.1. An operator who explicitly
// asked for full sampling in production got 10% and no warning — the setting
// was silently unusable at its most important value.
func TestResolveSampler_HonoursExplicitFullLegacyRatio(t *testing.T) {
	got := mustResolveSampler(t, OTel{SampleRatio: 1.0}, "production")

	assert.InDelta(t, 1.0, got.Ratio, 0, "an explicit 100% must survive in production")
	assert.True(t, got.ParentBased)
}

func TestResolveSampler_HonoursExplicitPartialLegacyRatio(t *testing.T) {
	got := mustResolveSampler(t, OTel{SampleRatio: 0.25}, "production")

	assert.InDelta(t, 0.25, got.Ratio, 0)
}

func TestResolveSampler_DefaultsOutsideLocal(t *testing.T) {
	got := mustResolveSampler(t, OTel{SampleRatio: UnsetSampleRatio}, "production")

	assert.InDelta(t, DefaultNonLocalSampleRatio, got.Ratio, 0)
	assert.True(t, got.ParentBased)
}

func TestResolveSampler_DefaultsToFullLocally(t *testing.T) {
	got := mustResolveSampler(t, OTel{SampleRatio: UnsetSampleRatio}, "local")

	assert.InDelta(t, 1.0, got.Ratio, 0, "local development traces everything")
}

func TestResolveSampler_HonoursExplicitZeroLegacyRatio(t *testing.T) {
	got := mustResolveSampler(t, OTel{SampleRatioSet: true, SampleRatio: 0}, "production")

	assert.Zero(t, got.Ratio, "an explicit 0% must not become the default")
}

// The official OTEL_TRACES_SAMPLER vocabulary, mapped faithfully: parentbased_*
// keeps a sampled upstream parent's children, the bare kinds decide per span.
func TestResolveSampler_MapsTheOfficialVocabulary(t *testing.T) {
	for _, tt := range []struct {
		sampler     string
		arg         string
		ratio       float64
		parentBased bool
	}{
		{sampler: "always_on", ratio: 1, parentBased: false},
		{sampler: "always_off", ratio: 0, parentBased: false},
		{sampler: "traceidratio", arg: "0.5", ratio: 0.5, parentBased: false},
		{sampler: "parentbased_always_on", ratio: 1, parentBased: true},
		{sampler: "parentbased_always_off", ratio: 0, parentBased: true},
		{sampler: "parentbased_traceidratio", arg: "0.25", ratio: 0.25, parentBased: true},
	} {
		t.Run(tt.sampler, func(t *testing.T) {
			got := mustResolveSampler(t, OTel{TracesSampler: tt.sampler, TracesSamplerArg: tt.arg}, "production")

			assert.InDelta(t, tt.ratio, got.Ratio, 0)
			assert.Equal(t, tt.parentBased, got.ParentBased)
		})
	}
}

func TestResolveSampler_AcceptsMixedCaseKind(t *testing.T) {
	got := mustResolveSampler(t, OTel{TracesSampler: "Parentbased_TraceIdRatio", TracesSamplerArg: "0.3"}, "production")

	assert.InDelta(t, 0.3, got.Ratio, 0)
	assert.True(t, got.ParentBased)
}

// The ratio kinds REQUIRE the arg: falling back to an implementation-defined
// default ratio is exactly the kind of luck this configuration refuses.
func TestResolveSampler_RequiresTheArgForRatioKinds(t *testing.T) {
	o := OTel{TracesSampler: "parentbased_traceidratio"}

	assert.Error(t, o.Resolve("production"))
}

func TestResolveSampler_RejectsBadSamplerArgs(t *testing.T) {
	for _, arg := range []string{"NaN", "-1", "2", "abc", "0.5.1"} {
		o := OTel{TracesSampler: "traceidratio", TracesSamplerArg: arg}
		assert.Error(t, o.Resolve("production"), "arg %q must be refused at boot", arg)
	}
}

func TestResolveSampler_RejectsUnknownKinds(t *testing.T) {
	o := OTel{TracesSampler: "jaeger_remote"}

	assert.Error(t, o.Resolve("production"))
}

// Two live sampling instructions with different vocabularies is ambiguity,
// and ambiguity is resolved by the operator, not by silent precedence.
func TestResolveSampler_RefusesOfficialAndLegacyTogether(t *testing.T) {
	o := OTel{TracesSampler: "always_on", SampleRatioSet: true, SampleRatio: 0.1}

	assert.Error(t, o.Resolve("production"))
}
