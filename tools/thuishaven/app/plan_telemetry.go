package app

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// seededProject is the organization and project the stack's seeded key belongs to,
// as apps/tasks/src/storage-seed/storage-seed.ts names them (kept in step by hand).
const seededProject = "local-dev-org/local-dev-project"

// telemetryEnv is telemetrysim's own configuration, wherever it runs. The stack's
// OTLP door and seeded key are its defaults, so its console starts a run without
// the key ever reaching a browser.
func telemetryEnv(st domain.Stack) []string {
	var port int
	var app string
	for _, svc := range st.Services {
		switch svc.Name {
		case domain.TelemetryService:
			port = svc.Port
		case "app":
			app = svc.URL
		}
	}
	env := []string{fmt.Sprintf("TELEMETRYSIM_ADDR=:%d", port), "TELEMETRYSIM_STACK=" + st.Slug}
	if app != "" && st.LocalAPIKey != "" {
		env = append(env, "TELEMETRYSIM_ENDPOINT="+strings.TrimRight(app, "/")+"/api/otel", "TELEMETRYSIM_API_KEY="+st.LocalAPIKey,
			"TELEMETRYSIM_PROJECT="+seededProject)
	}
	return env
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
