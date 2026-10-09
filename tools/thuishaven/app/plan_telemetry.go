package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// telemetryEnv is telemetrysim's own configuration, wherever it runs.
func telemetryEnv(st domain.Stack) []string {
	var port int
	for _, svc := range st.Services {
		if svc.Name == domain.TelemetryService {
			port = svc.Port
		}
	}
	return []string{fmt.Sprintf("TELEMETRYSIM_ADDR=:%d", port), "TELEMETRYSIM_STACK=" + st.Slug}
}

// telemetryChild is the supervised telemetrysim lane. It keeps nothing on disk:
// its status shows the current run.
func (o *Orchestrator) telemetryChild(st domain.Stack, repoRoot string, base []string) Child {
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.TelemetryService, Dir: repoRoot, Color: palette[5], LogPath: filepath.Join(logDir, domain.TelemetryService+".log"),
		Shell: o.simulatorShell("telemetry"),
		Env:   append(append(append([]string{}, base...), domain.LaneEnv(domain.TelemetryService)), telemetryEnv(st)...),
	}
}
