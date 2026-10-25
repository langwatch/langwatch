package app

import (
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func TestGoEvaluatorsPointTheGoLaneAtTheModelCatalogue(t *testing.T) {
	lane := goLane(t, domain.Selection{NLP: true, GoEvaluators: true})
	if !slices.ContainsFunc(lane.Env, isModelPricingEnv) {
		t.Errorf("go lane env %v does not point nlpgo at the model catalogue", lane.Env)
	}

	lane = goLane(t, domain.Selection{NLP: true})
	if slices.ContainsFunc(lane.Env, isModelPricingEnv) {
		t.Errorf("go lane without +go-evaluators set the model catalogue: %v", lane.Env)
	}
}

func isModelPricingEnv(entry string) bool {
	return strings.HasPrefix(entry, "LANGWATCH_MODEL_PRICING_DIR=") &&
		strings.HasSuffix(entry, "/modules/model-provider/contract/src/catalog")
}
