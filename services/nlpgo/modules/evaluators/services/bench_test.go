package services_test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/trace/noop"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/memory"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/services"
	lingua "github.com/langwatch/langwatch/services/third_party/lingua-go"
)

// benchFixtures are the model-free evaluators and the recorded langevals
// inputs they are benchmarked over, the same inputs the Python side times.
func benchFixtures() map[string]string {
	return map[string]string{
		"langevals/exact_match":          "langevals__exact_match.json",
		"langevals/competitor_blocklist": "langevals__competitor_blocklist.json",
		"langevals/basic":                "langevals__basic.json",
		"langevals/valid_format":         "langevals__valid_format.json",
		"ragas/bleu_score":               "ragas__bleu_score.json",
		"ragas/rouge_score":              "ragas__rouge_score.json",
		"ragas/context_f1":               "ragas__context_f1.json",
		"ragas/context_precision":        "ragas__context_precision.json",
		"ragas/context_recall":           "ragas__context_recall.json",
		"presidio/pii_detection":         "presidio__pii_detection.json",
		"lingua/language_detection":      "lingua__language_detection.json",
	}
}

// BenchmarkEvaluate times one service.Evaluate call of one entry, cycling
// through the evaluator's recorded cases: settings parsing, admission and
// scoring, without HTTP. Besides the mean it reports the median and p95 call.
// Lingua runs when `make lingua-models` has generated its models.
func BenchmarkEvaluate(b *testing.B) {
	if _, err := os.Stat(linguaModels); err == nil {
		require.NoError(b, lingua.LoadModels(linguaModels))
	}
	service := services.NewEvaluationService(services.EvaluationDeps{
		Config:        contract.DefaultConfig(),
		LLM:           memory.NewLLM(),
		CustomerTrace: memory.NewCustomerTrace(),
		OpsTracer:     noop.NewTracerProvider().Tracer("bench"),
		Logger:        zap.NewNop(),
	})
	available := services.BuiltinEvaluators()
	slugs := make([]string, 0, len(benchFixtures()))
	for slug := range benchFixtures() {
		slugs = append(slugs, slug)
	}
	slices.Sort(slugs)
	for _, slug := range slugs {
		b.Run(slug, func(b *testing.B) {
			if _, ok := available[slug]; !ok {
				b.Skipf("%s is not in this build", slug)
			}
			requests := benchRequests(b, slug, benchFixtures()[slug])
			ctx := context.Background()
			durations := make([]time.Duration, 0, b.N)
			b.ReportAllocs()
			b.ResetTimer()
			for i := range b.N {
				start := time.Now()
				_, err := service.Evaluate(ctx, requests[i%len(requests)])
				durations = append(durations, time.Since(start))
				if err != nil {
					b.Fatal(err)
				}
			}
			b.StopTimer()
			slices.Sort(durations)
			b.ReportMetric(float64(durations[len(durations)/2].Nanoseconds())/1e3, "p50-µs")
			b.ReportMetric(float64(durations[len(durations)*95/100].Nanoseconds())/1e3, "p95-µs")
		})
	}
}

// BenchmarkBuiltinEvaluators times building the evaluator table, including
// the lingua detector once its models are loaded.
func BenchmarkBuiltinEvaluators(b *testing.B) {
	for range b.N {
		_ = services.BuiltinEvaluators()
	}
}

func benchRequests(b *testing.B, slug, file string) []contract.EvaluateRequest {
	b.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "testdata", "fixtures", file))
	require.NoError(b, err)
	var cases []fixtureCase
	require.NoError(b, json.Unmarshal(raw, &cases))
	require.NotEmpty(b, cases)
	requests := make([]contract.EvaluateRequest, len(cases))
	for i := range cases {
		requests[i] = contract.EvaluateRequest{
			Tenant:    contract.Tenant{ProjectID: "project_bench"},
			Evaluator: slug,
			Entries:   []contract.Entry{cases[i].Entry},
			Settings:  settingsOrEmpty(cases[i].Settings),
		}
	}
	return requests
}
