package services_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/trace/noop"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/memory"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
)

func catalogueService(evaluators map[string]services.Evaluator) (*services.EvaluationService, *memory.LLM) {
	llm := memory.NewLLM()
	llm.ScriptComplete(answer(0.001))
	return services.NewEvaluationService(services.EvaluationDeps{
		Config:        testConfig(),
		LLM:           llm,
		CustomerTrace: memory.NewCustomerTrace(),
		OpsTracer:     noop.NewTracerProvider().Tracer("test"),
		Logger:        zap.NewNop(),
		Evaluators:    evaluators,
	}), llm
}

func catalogueDefinition(t *testing.T, slug string) rules.Definition {
	t.Helper()
	definitions := rules.Definitions()
	for i := range definitions {
		if definitions[i].Slug == slug {
			return definitions[i]
		}
	}
	t.Fatalf("no definition for %s", slug)
	return rules.Definition{}
}

// @scenario "Settings of the wrong type are refused"
func TestEvaluateRefusesAWrongTypedSettingBeforeAnyModelCall(t *testing.T) {
	scoreByModel := func(ctx context.Context, settings rules.LLMPromptSettings, in services.EntryRun) (contract.Result, error) {
		_, err := in.Models.Complete(ctx, channels.CompletionRequest{Model: settings.Model})
		return contract.Result{Status: contract.StatusProcessed}, err
	}
	service, llm := catalogueService(map[string]services.Evaluator{"langevals/llm_score": {
		Definition: catalogueDefinition(t, "langevals/llm_score"),
		Prepare:    services.WithSettings(rules.ParseCustomLLMScoreSettings, scoreByModel),
	}})

	_, err := service.Evaluate(t.Context(), contract.EvaluateRequest{
		Tenant:    tenant("acme"),
		Evaluator: "langevals/llm_score",
		Entries:   []contract.Entry{{Input: text("hi"), Output: text("hello")}},
		Settings:  json.RawMessage(`{"max_tokens":"lots"}`),
	})

	require.ErrorIs(t, err, contract.ErrEvaluatorSettingsInvalid)
	assert.Empty(t, llm.Completions())
}

func TestEvaluateKeepsADefinedButUnportedEvaluatorNotFound(t *testing.T) {
	service, _ := catalogueService(services.BuiltinEvaluators())

	_, err := service.Evaluate(t.Context(), contract.EvaluateRequest{
		Tenant:    tenant("acme"),
		Evaluator: "langevals/pairwise_compare",
		Entries:   []contract.Entry{{Input: text("hi")}},
	})

	require.ErrorIs(t, err, contract.ErrEvaluatorNotFound)
}

func TestBuiltinEvaluatorsCarryTheirCatalogueDefinition(t *testing.T) {
	exactMatch := services.BuiltinEvaluators()["langevals/exact_match"]

	assert.Equal(t, catalogueDefinition(t, "langevals/exact_match"), exactMatch.Definition)
}
