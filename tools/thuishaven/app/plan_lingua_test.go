package app

import (
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func goLane(t *testing.T, sel domain.Selection) Child {
	t.Helper()
	o := &Orchestrator{cfg: Config{Home: t.TempDir()}, proxy: stubProxy{}}
	repo := t.TempDir()
	st := domain.Stack{Slug: "test", Services: []domain.Service{{Name: "nlp", Port: 44001}}}
	for _, c := range o.planChildren(st, PlanOptions{RepoRoot: repo, Selection: sel}, repo) {
		if c.Name == GoLane {
			return c
		}
	}
	t.Fatal("no go lane was planned for a stack selecting nlp")
	return Child{}
}

func TestGoEvaluatorsBuildTheGoLaneWithTheLanguageModels(t *testing.T) {
	lane := goLane(t, domain.Selection{NLP: true, GoEvaluators: true})
	if !strings.Contains(lane.Shell, "lingua-models && make") {
		t.Errorf("go lane runs %q, want the models generated before it starts", lane.Shell)
	}
	if !slices.Contains(lane.Env, linguaModelsGoFlags) {
		t.Errorf("go lane env %v is missing %q", lane.Env, linguaModelsGoFlags)
	}

	lane = goLane(t, domain.Selection{NLP: true})
	if strings.Contains(lane.Shell, "lingua-models") || slices.Contains(lane.Env, linguaModelsGoFlags) {
		t.Errorf("go lane without +go-evaluators changed: %q %v", lane.Shell, lane.Env)
	}
}
