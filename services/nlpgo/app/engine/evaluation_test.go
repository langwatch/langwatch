package engine

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// stubLogResultsClient captures every POST without making an HTTP call.
// Lets tests assert the wire shape we hand to the LangWatch
// /api/evaluations/batch/log_results endpoint.
type stubLogResultsClient struct {
	mu    sync.Mutex
	calls []map[string]any
	err   error
}

func (s *stubLogResultsClient) postBatch(_ context.Context, _, apiKey string, body []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.err != nil {
		return s.err
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return err
	}
	parsed["__api_key"] = apiKey
	s.calls = append(s.calls, parsed)
	return nil
}

func ptrFloat(v float64) *float64 { return &v }

func ptrInt(v int) *int { return &v }

func ptrStr(v string) *string { return &v }

func TestSelectEvaluationEntries_FullModeReturnsAllRows(t *testing.T) {
	wf := &dsl.Workflow{
		Nodes: []dsl.Node{
			{
				ID:   "entry",
				Type: dsl.ComponentEntry,
				Data: dsl.Component{
					Dataset: &dsl.NodeDataset{Inline: &dsl.DatasetInline{
						Records: map[string][]any{"q": {"hello", "world", "again"}},
					}},
				},
			},
		},
	}
	got, err := selectEvaluationEntries(wf, "full", nil)
	require.NoError(t, err)
	assert.Len(t, got, 3, "full mode must yield every row")
	assert.Equal(t, "hello", got[0]["q"])
	assert.Equal(t, "again", got[2]["q"])
}

func TestSelectEvaluationEntries_SpecificModeRequiresIndex(t *testing.T) {
	wf := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry, Data: dsl.Component{
				Dataset: &dsl.NodeDataset{Inline: &dsl.DatasetInline{
					Records: map[string][]any{"q": {"a", "b"}},
				}},
			}},
		},
	}
	_, err := selectEvaluationEntries(wf, "specific", nil)
	require.Error(t, err, "evaluate_on=specific without dataset_entry must error")

	got, err := selectEvaluationEntries(wf, "specific", ptrInt(1))
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Equal(t, "b", got[0]["q"])
}

func TestSelectEvaluationEntries_RejectsRemoteDatasets(t *testing.T) {
	wf := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry, Data: dsl.Component{
				Dataset: &dsl.NodeDataset{ID: ptrStr("ds_abc")},
			}},
		},
	}
	_, err := selectEvaluationEntries(wf, "full", nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "remote datasets")
}

func TestSelectEvaluationEntries_TrainTestSplitByPercentage(t *testing.T) {
	wf := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry, Data: dsl.Component{
				TrainSize: ptrFloat(0.6),
				TestSize:  ptrFloat(0.4),
				Dataset: &dsl.NodeDataset{Inline: &dsl.DatasetInline{
					Records: map[string][]any{"q": {"a", "b", "c", "d", "e"}},
				}},
			}},
		},
	}
	train, err := selectEvaluationEntries(wf, "train", nil)
	require.NoError(t, err)
	assert.Len(t, train, 3, "60%% of 5 rows = 3")
	test, err := selectEvaluationEntries(wf, "test", nil)
	require.NoError(t, err)
	assert.Len(t, test, 2, "remaining 2 rows go to test")
}

// TestEvaluationReporter_PostsBatchWithDatasetAndEvaluations pins the
// wire shape we send to /api/evaluations/batch/log_results. Studio's
// experiment-runs page is built on top of this payload — if the shape
// drifts, the dashboard either rejects the body (Zod) or silently
// drops rows. Mirror Python's body shape from
// EvaluationReporting.send_batch (langwatch_nlp/studio/dspy/evaluation.py).
func TestEvaluationReporter_PostsBatchWithDatasetAndEvaluations(t *testing.T) {
	stub := &stubLogResultsClient{}
	wf := &dsl.Workflow{
		WorkflowID:   "wf_x",
		Name:         "Demo",
		APIKey:       "sk-token",
		ExperimentID: nil,
	}
	req := ExecuteRequest{Workflow: wf, RunID: "run_1", WorkflowVersionID: "v1"}
	r := newEvaluationReporter(req, 2, "https://example.test", stub, noopLogger{})
	r.recordEntry(0, map[string]any{"input": "x"}, &ExecuteResult{
		Result:    map[string]any{"answer": "x"},
		TotalCost: 0.001,
		Nodes: map[string]*NodeState{
			"eval1": {
				ID:         "eval1",
				DurationMS: 5,
				Outputs: map[string]any{
					"status":  "processed",
					"score":   1.0,
					"passed":  true,
					"details": "matched",
				},
			},
		},
	}, "trace_a", 12)
	r.recordEntry(1, map[string]any{"input": "y"}, &ExecuteResult{
		Result: map[string]any{"answer": "y"},
		Nodes: map[string]*NodeState{
			"eval1": {
				ID:         "eval1",
				DurationMS: 6,
				Outputs: map[string]any{
					"status":  "processed",
					"score":   0.0,
					"passed":  false,
					"details": "no match",
				},
			},
			// non-evaluator node — must NOT land in the evaluations list
			"llm": {
				ID:      "llm",
				Outputs: map[string]any{"answer": "y"},
			},
		},
	}, "trace_b", 18)

	require.NoError(t, r.flush(context.Background(), true))
	require.Len(t, stub.calls, 1)
	body := stub.calls[0]
	assert.Equal(t, "run_1", body["run_id"])
	assert.Equal(t, "wf_x", body["workflow_id"])
	assert.Equal(t, "v1", body["workflow_version_id"])
	assert.Equal(t, "wf_x", body["experiment_slug"], "no experiment_id → fall back to workflow_id slug")
	assert.Equal(t, "sk-token", body["__api_key"], "api key must travel as X-Auth-Token")
	dataset := body["dataset"].([]any)
	assert.Len(t, dataset, 2)
	first := dataset[0].(map[string]any)
	assert.EqualValues(t, 0, first["index"])
	assert.Equal(t, "trace_a", first["trace_id"])
	predicted := first["predicted"].(map[string]any)
	assert.Equal(t, "x", predicted["answer"])
	evals := body["evaluations"].([]any)
	assert.Len(t, evals, 2, "two eval rows (one per dataset entry); non-evaluator node must be filtered out")
	timestamps := body["timestamps"].(map[string]any)
	require.Contains(t, timestamps, "finished_at", "final flush must stamp finished_at")
}

func TestEvaluationReporter_RecordsErrorPerEntryWithoutAborting(t *testing.T) {
	stub := &stubLogResultsClient{}
	wf := &dsl.Workflow{WorkflowID: "wf", APIKey: "sk", Name: "n"}
	req := ExecuteRequest{Workflow: wf, RunID: "r"}
	r := newEvaluationReporter(req, 2, "https://x", stub, noopLogger{})
	r.recordEntry(0, map[string]any{"input": "a"}, &ExecuteResult{
		Status: "error",
		Error:  &NodeError{Type: "engine_error", Message: "boom"},
	}, "", 5)
	r.recordEntry(1, map[string]any{"input": "b"}, &ExecuteResult{
		Result: map[string]any{"answer": "b"},
	}, "trace_b", 5)
	require.NoError(t, r.flush(context.Background(), true))
	require.Len(t, stub.calls, 1)
	dataset := stub.calls[0]["dataset"].([]any)
	require.Len(t, dataset, 2)
	assert.Equal(t, "boom", dataset[0].(map[string]any)["error"], "row-level error preserved")
	_, ok := dataset[1].(map[string]any)["error"]
	assert.False(t, ok, "successful row must not have an error field")
}
