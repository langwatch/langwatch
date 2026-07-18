package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The regression this guards: services defaulted SampleRatio to 1.0 and then
// rewrote any 1.0 outside local development to 0.1. An operator who explicitly
// asked for full sampling in production got 10% and no warning — the setting
// was silently unusable at its most important value.
func TestResolveSampleRatio_HonoursExplicitFullSampling(t *testing.T) {
	o := OTel{SampleRatio: 1.0}

	o.ResolveSampleRatio("production")

	assert.Equal(t, 1.0, o.SampleRatio, "an explicit 100% must survive in production")
}

func TestResolveSampleRatio_HonoursExplicitPartialSampling(t *testing.T) {
	o := OTel{SampleRatio: 0.25}

	o.ResolveSampleRatio("production")

	assert.Equal(t, 0.25, o.SampleRatio)
}

func TestResolveSampleRatio_DefaultsOutsideLocal(t *testing.T) {
	o := OTel{SampleRatio: UnsetSampleRatio}

	o.ResolveSampleRatio("production")

	assert.Equal(t, DefaultNonLocalSampleRatio, o.SampleRatio)
}

func TestResolveSampleRatio_DefaultsToFullLocally(t *testing.T) {
	o := OTel{SampleRatio: UnsetSampleRatio}

	o.ResolveSampleRatio("local")

	assert.Equal(t, 1.0, o.SampleRatio, "local development traces everything")
}
