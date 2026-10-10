package app

import (
	"slices"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "haven runs lambdasim only when the worktree asks for it"
func TestLambdaEnvForwardsToThisStacksNlpgo(t *testing.T) {
	t.Setenv("LANGWATCH_NLP_LAMBDA_CONFIG", "")
	st := domain.Stack{Slug: "feat-x", Services: []domain.Service{{Name: "nlp", Port: 45562}, {Name: domain.LambdaService, Port: 45594}}}
	env := lambdaEnv(st)
	for _, want := range []string{"LAMBDASIM_ADDR=:45594", "LAMBDASIM_STACK=feat-x", "LAMBDASIM_TARGET=http://127.0.0.1:45562"} {
		if !slices.Contains(env, want) {
			t.Errorf("lambdaEnv %v lacks %s", env, want)
		}
	}
	sel := domain.Selection{}
	if got := simulatorBaseEnv(sel, domain.Service{Name: domain.LambdaService, Port: 45594}, t.TempDir()); got != nil {
		t.Errorf("an unselected lambdasim still set %v", got)
	}
	sel.Lambda = true
	if got := simulatorBaseEnv(sel, domain.Service{Name: domain.LambdaService, Port: 45594}, t.TempDir()); !slices.Contains(got, "AWS_ENDPOINT_URL_LAMBDA=http://127.0.0.1:45594") {
		t.Errorf("a selected lambdasim set %v", got)
	}
}
