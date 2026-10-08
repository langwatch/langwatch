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
	pinned := devEnv(domain.ObservabilityTierEnvVar)
	tier, ok := domain.ObservabilityTierFor(runtime.GOOS, pinned)
	if !ok {
		fmt.Fprintf(os.Stderr, "haven: %s=%q names no tier (native, container) — using %s\n",
			domain.ObservabilityTierEnvVar, pinned, tier)
	}
	if tier == domain.ObservabilityTierContainer {
		return otellgtm.New(rt, havenHome(), envOr("HAVEN_OBS_IMAGE", domain.ObservabilityImage),
			observabilityEndpoints(), observabilityLimits(ram, cpus))
	}
	endpoints := observabilityEndpoints()
	endpoints.PyroscopePort = 0
	tempo, _ := domain.TempoNativeArtifactFor(runtime.GOOS, runtime.GOARCH)
	return otelnative.New(otelnative.Options{
		Home: havenHome(), Endpoints: endpoints, Limits: observabilityLimits(ram, cpus),
		TempoBin: devEnv("HAVEN_OBS_TEMPO_BIN"), TempoArtifact: tempo,
	})
}
