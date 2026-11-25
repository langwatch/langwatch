package selfhosted

import (
	"slices"
	"strings"
	"testing"
)

// @scenario "A self-hosted run performs the upgrade guide's commands in order and names each deviation"
func TestPlansRunTheGuideCommands(t *testing.T) {
	config := Config{MainTree: "/main", HeadTree: "/head", Snapshot: "/snap", RunDir: "/run", Upgradelab: "upgradelab"}
	var composeDocs []string
	for _, step := range ComposePlan(config) {
		if step.Phase == "upgrade" {
			composeDocs = append(composeDocs, step.Doc)
			if step.Deviation != "" {
				t.Errorf("compose step %q deviates: %s", step.Doc, step.Deviation)
			}
		}
	}
	want := []string{"if your compose file predates this, copy the current one from infra/compose.yml", "docker compose pull", "docker compose up -d"}
	if !slices.Equal(composeDocs, want) {
		t.Errorf("compose upgrade steps %q, want %q", composeDocs, want)
	}
	plan := ComposePlan(config)
	pull := slices.IndexFunc(plan, func(step Step) bool { return step.Doc == "docker compose pull" })
	if got := strings.Join(plan[pull].Argv, " "); got != "docker compose pull" {
		t.Errorf("compose pull runs %q", got)
	}
	var helmSteps []Step
	for _, step := range HelmPlan(config) {
		if step.Phase == "upgrade" {
			helmSteps = append(helmSteps, step)
		}
	}
	if len(helmSteps) != 2 || helmSteps[0].Doc != "helm repo update" || helmSteps[0].Argv != nil || !strings.HasPrefix(helmSteps[1].Doc, "helm upgrade") || helmSteps[1].Deviation == "" {
		t.Errorf("helm upgrade steps %+v", helmSteps)
	}
}
