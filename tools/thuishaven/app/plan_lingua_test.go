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
	children := o.planChildren(st, PlanOptions{RepoRoot: repo, Selection: sel}, repo)
	for i := range children {
		if children[i].Name == GoLane {
			return children[i]
		}
	}
	t.Fatal("no go lane was planned for a stack selecting nlp")
	return Child{}
}

func TestGoEvaluatorsPointTheGoLaneAtTheLanguageModels(t *testing.T) {
	lane := goLane(t, domain.Selection{NLP: true, GoEvaluators: true})
	if !strings.Contains(lane.Shell, "lingua-models && make") {
		t.Errorf("go lane runs %q, want the models generated before it starts", lane.Shell)
	}
	if !slices.ContainsFunc(lane.Env, isLinguaModelsEnv) {
		t.Errorf("go lane env %v does not point nlpgo at the language models", lane.Env)
	}

	lane = goLane(t, domain.Selection{NLP: true})
	if strings.Contains(lane.Shell, "lingua-models") || slices.ContainsFunc(lane.Env, isLinguaModelsEnv) {
		t.Errorf("go lane without +go-evaluators changed: %q %v", lane.Shell, lane.Env)
	}
}

func isLinguaModelsEnv(entry string) bool {
	return strings.HasPrefix(entry, "NLPGO_LINGUA_MODELS=") && strings.HasSuffix(entry, "/services/third_party/lingua-go/models.bin")
}
