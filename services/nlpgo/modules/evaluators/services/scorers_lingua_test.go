//go:build !lingua_models

package services_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	lingua "github.com/langwatch/langwatch/services/third_party/lingua-go"
)

func TestLanguageDetectionIsNotFoundWithoutEmbeddedModels(t *testing.T) {
	require.False(t, lingua.ModelsAvailable())
	h := newHarness(t, contract.DefaultConfig(), 0)
	_, err := h.service.Evaluate(context.Background(), contract.EvaluateRequest{
		Tenant:    contract.Tenant{ProjectID: "project_lingua"},
		Evaluator: "lingua/language_detection",
		Entries:   []contract.Entry{{Output: text("the quick brown fox jumps over the lazy dog")}},
	})
	require.ErrorIs(t, err, contract.ErrEvaluatorNotFound)
}
