package domain

import "testing"

func evaluatorStack(secret string) Stack {
	return Stack{
		Slug: "x", EvaluatorRuntimeSecret: secret,
		Services: []Service{{Name: "nlp", Port: 5561, URL: "https://nlp.x.langwatch.localhost"}},
	}
}

func TestOverlayEnvOmitsTheGoEvaluatorRuntimeWhenOff(t *testing.T) {
	env := EnvMap(evaluatorStack("").OverlayEnv())
	for _, k := range []string{"NLPGO_INTERNAL_SECRET", "EVALUATOR_RUNTIME_ENDPOINT", "EVALUATOR_RUNTIME_ENGINE"} {
		if _, ok := env[k]; ok {
			t.Errorf("%s is set with the Go evaluator runtime off", k)
		}
	}
}

func TestOverlayEnvWiresTheGoEvaluatorRuntimeWhenOn(t *testing.T) {
	secret := NewEvaluatorRuntimeSecret()
	env := EnvMap(evaluatorStack(secret).OverlayEnv())
	if secret == "" || env["NLPGO_INTERNAL_SECRET"] != secret {
		t.Errorf("NLPGO_INTERNAL_SECRET = %q, want the stack secret %q", env["NLPGO_INTERNAL_SECRET"], secret)
	}
	if got, want := env["EVALUATOR_RUNTIME_ENDPOINT"], "https://nlp.x.langwatch.localhost/go/evaluators"; got != want {
		t.Errorf("EVALUATOR_RUNTIME_ENDPOINT = %q, want %q", got, want)
	}
	if env["EVALUATOR_RUNTIME_ENGINE"] != "go" {
		t.Errorf("EVALUATOR_RUNTIME_ENGINE = %q, want go", env["EVALUATOR_RUNTIME_ENGINE"])
	}
}

func TestGoEvaluatorsNeedsNLP(t *testing.T) {
	if _, err := ApplySelectionDeltas(DefaultSelection(), []string{"+go-evaluators", "-nlp"}); err == nil {
		t.Error("+go-evaluators without nlp was accepted")
	}
	sel, err := ApplySelectionDeltas(DefaultSelection(), []string{"+go-evaluators"})
	if err != nil || !sel.GoEvaluators {
		t.Errorf("+go-evaluators = %+v, %v; want it on", sel, err)
	}
}
