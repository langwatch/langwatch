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

// Defensive guard: if Studio's loadDatasets() somehow fails to inline a
// saved dataset before forwarding, the Go engine should NOT silently
// run an empty eval. Surface a structured error pointing the operator
// at the right TS-side helper to fix. Behavior change vs the
// pre-fix "remote datasets not yet supported" message: now actionable
// — tells you WHICH file to fix, not just "not supported".
func TestSelectEvaluationEntries_NonInlineDatasetReturnsActionableError(t *testing.T) {
	wf := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry, Data: dsl.Component{
				Dataset: &dsl.NodeDataset{ID: ptrStr("ds_abc")},
			}},
		},
	}
	_, err := selectEvaluationEntries(wf, "full", nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "loadDatasets",
		"error must point operator at the TS-side helper that owns inlining")
	assert.Contains(t, err.Error(), "no inline dataset",
		"error must surface the underlying state (no inline) for log search")
}

// TestSelectEvaluationEntries_TrainTestSplitShuffleByPositiveSeed —
// Python parity (S2.2). sklearn.train_test_split with `shuffle=(seed
// >= 0), random_state=seed` reorders rows before slicing. With a
// positive seed the same dataset+seed must produce the same train
// rows (deterministic), and they should NOT all match the in-order
// slice (proving shuffle actually happened).
func TestSelectEvaluationEntries_TrainTestSplitShuffleByPositiveSeed(t *testing.T) {
	makeWf := func(seed int) *dsl.Workflow {
		s := seed
		return &dsl.Workflow{
			Nodes: []dsl.Node{
				{ID: "entry", Type: dsl.ComponentEntry, Data: dsl.Component{
					TrainSize: ptrFloat(0.5),
					TestSize:  ptrFloat(0.5),
					Seed:      &s,
					Dataset: &dsl.NodeDataset{Inline: &dsl.DatasetInline{
						Records: map[string][]any{"q": {"a", "b", "c", "d", "e", "f", "g", "h"}},
					}},
				}},
			},
		}
	}
	train, err := selectEvaluationEntries(makeWf(7), "train", nil)
	require.NoError(t, err)
	trainAgain, err := selectEvaluationEntries(makeWf(7), "train", nil)
	require.NoError(t, err)
	assert.Equal(t, train, trainAgain, "same seed → same shuffle (deterministic)")

	// Was the shuffle effective? At least ONE row in the train slice
	// must differ from the in-order half {a,b,c,d}.
	inOrder := []string{"a", "b", "c", "d"}
	allMatch := true
	for i, row := range train {
		if row["q"] != inOrder[i] {
			allMatch = false
			break
		}
	}
	assert.False(t, allMatch, "with seed >= 0 the shuffled train slice should not equal the in-order slice; got %v", train)

	// Different seed yields a different ordering (statistical, not
	// guaranteed for tiny seed-pairs, but sklearn parity for these
	// values).
	trainOther, err := selectEvaluationEntries(makeWf(13), "train", nil)
	require.NoError(t, err)
	assert.NotEqual(t, train, trainOther, "different seed → different shuffle")
}

// Negative-seed (or unset) falls back to in-order slicing — keeps
// re-runs of the same dataset deterministic when the user explicitly
// disables shuffle. Mirrors Python's `shuffle=(seed >= 0)`.
func TestSelectEvaluationEntries_TrainTestSplitNegativeSeedKeepsOrder(t *testing.T) {
	negSeed := -1
	wf := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry, Data: dsl.Component{
				TrainSize: ptrFloat(0.5),
				TestSize:  ptrFloat(0.5),
				Seed:      &negSeed,
				Dataset: &dsl.NodeDataset{Inline: &dsl.DatasetInline{
					Records: map[string][]any{"q": {"a", "b", "c", "d"}},
				}},
			}},
		},
	}
	train, err := selectEvaluationEntries(wf, "train", nil)
	require.NoError(t, err)
	require.Len(t, train, 2)
	assert.Equal(t, "a", train[0]["q"], "no shuffle when seed<0 — first row preserved")
	assert.Equal(t, "b", train[1]["q"])
}

// testSize must be honored — pre-fix it was discarded (`_ = testSize`)
// and the test slice was always the complement. Now an explicit
// testSize<complement size truncates the test slice to that count.
func TestSelectEvaluationEntries_TestSizeRespected(t *testing.T) {
	wf := &dsl.Workflow{
		Nodes: []dsl.Node{
			{ID: "entry", Type: dsl.ComponentEntry, Data: dsl.Component{
				TrainSize: ptrFloat(0.5),  // 5 rows
				TestSize:  ptrFloat(0.2),  // 2 rows (not 5)
				Dataset: &dsl.NodeDataset{Inline: &dsl.DatasetInline{
					Records: map[string][]any{"q": {"a", "b", "c", "d", "e", "f", "g", "h", "i", "j"}},
				}},
			}},
		},
	}
	test, err := selectEvaluationEntries(wf, "test", nil)
	require.NoError(t, err)
	assert.Len(t, test, 2,
		"explicit testSize=0.2 of 10 rows = 2 (not the 5-row complement of trainSize)")
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
