package app

import (
	"slices"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "The setup shows the target, where the key came from and its project, never the key"
func TestTelemetryEnvNamesTheStacksDoorKeyAndProject(t *testing.T) {
	st := domain.Stack{Slug: "feat-x", LocalAPIKey: "sk-lw-test", Services: []domain.Service{
		{Name: domain.TelemetryService, Port: 45597}, {Name: "app", URL: "https://app.feat-x.langwatch.localhost/"},
	}}
	env := telemetryEnv(st)
	for _, want := range []string{
		"TELEMETRYSIM_ADDR=:45597", "TELEMETRYSIM_STACK=feat-x",
		"TELEMETRYSIM_ENDPOINT=https://app.feat-x.langwatch.localhost/api/otel",
		"TELEMETRYSIM_API_KEY=sk-lw-test", "TELEMETRYSIM_PROJECT=" + seededProject,
	} {
		if !slices.Contains(env, want) {
			t.Errorf("env %v lacks %s", env, want)
		}
	}
	st.LocalAPIKey = ""
	if env := telemetryEnv(st); len(env) != 2 {
		t.Errorf("a stack with no seeded key still names a door: %v", env)
	}
}
