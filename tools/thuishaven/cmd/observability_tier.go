package cmd

import (
	"fmt"
	"os"
	"runtime"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/colima"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/otellgtm"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/otelnative"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// observabilityStack picks the observability tier: native host processes on
// macOS, the LGTM container elsewhere or when LANGWATCH_HAVEN_OBS_TIER pins it.
// The native tier drops Pyroscope, so its endpoints publish no profiler port.
func observabilityStack(rt *colima.Runtime, ram uint64, cpus int) app.Observability {
	tier, pinned, ok := selectedObservabilityTier()
	if !ok {
		fmt.Fprintf(os.Stderr, "haven: %s=%q names no tier (native, container) — using %s\n",
			domain.ObservabilityTierEnvVar, pinned, tier)
	}
	container := otellgtm.New(rt, havenHome(), envOr("HAVEN_OBS_IMAGE", domain.ObservabilityImage),
		observabilityEndpoints(), observabilityLimits(ram, cpus))
	if tier == domain.ObservabilityTierContainer {
		return container
	}
	endpoints := observabilityEndpoints()
	endpoints.PyroscopePort = 0
	tempo, _ := domain.TempoNativeArtifactFor(runtime.GOOS, runtime.GOARCH)
	alloy, _ := domain.AlloyNativeArtifactFor(runtime.GOOS, runtime.GOARCH)
	return otelnative.New(otelnative.Options{
		Home: havenHome(), Endpoints: endpoints, Limits: observabilityLimits(ram, cpus),
		TempoBin: devEnv("HAVEN_OBS_TEMPO_BIN"), TempoArtifact: tempo,
		AlloyBin: devEnv("HAVEN_OBS_ALLOY_BIN"), AlloyArtifact: alloy,
		Container: container, // stopped when running: it publishes the same ports
	})
}

// selectedObservabilityTier is the one tier selection, shared by the stack and
// the viewer; ok is false when the pin names no tier.
func selectedObservabilityTier() (tier domain.ObservabilityTier, pinned string, ok bool) {
	pinned = devEnv(domain.ObservabilityTierEnvVar)
	tier, ok = domain.ObservabilityTierFor(runtime.GOOS, pinned)
	return tier, pinned, ok
}
