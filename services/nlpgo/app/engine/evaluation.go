package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/dataset"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// evalLogResultsClient posts an evaluation batch to the LangWatch
// control-plane (/api/evaluations/batch/log_results). Behind an
// interface so tests can inject a stub server. Real implementations
// hit the URL via http.Client; the engine builds the batch payload
// out of per-entry workflow runs + evaluator outputs.
type evalLogResultsClient interface {
	postBatch(ctx context.Context, baseURL, apiKey string, body []byte) error
}

type httpEvalLogResultsClient struct {
	client  *http.Client
	timeout time.Duration
}

func newHTTPEvalLogResultsClient() *httpEvalLogResultsClient {
	return &httpEvalLogResultsClient{
		client:  http.DefaultClient,
		timeout: 60 * time.Second,
	}
}

func (c *httpEvalLogResultsClient) postBatch(ctx context.Context, baseURL, apiKey string, body []byte) error {
	if baseURL == "" {
		return fmt.Errorf("evaluation: langwatch base URL is empty — batch results cannot be posted")
	}
	if apiKey == "" {
		return fmt.Errorf("evaluation: workflow.api_key is empty — batch/log_results requires it as X-Auth-Token")
	}
	url := baseURL + "/api/evaluations/batch/log_results"
	reqCtx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("evaluation: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Auth-Token", apiKey)
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("evaluation: post batch: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return fmt.Errorf("evaluation: batch/log_results returned %d: %s", resp.StatusCode, string(body))
	}
	return nil
}

// evaluationReporter accumulates per-entry results and posts batches
// to the LangWatch control-plane. Mirrors langwatch_nlp's
// EvaluationReporting (langwatch_nlp/studio/dspy/evaluation.py).
type evaluationReporter struct {
	wf                *dsl.Workflow
	runID             string
	workflowVersionID string
	createdAt         int64
	total             int
	progress          int

	mu      sync.Mutex
	dataset []map[string]any
	evals   []map[string]any

	logResults evalLogResultsClient
	baseURL    string
	logger     Logger
}

// newEvaluationReporter constructs an evaluationReporter. The reporter
// keeps the rolling batch in memory and posts it on each tick (final
// flush carries finished_at).
func newEvaluationReporter(req ExecuteRequest, total int, baseURL string, logResults evalLogResultsClient, logger Logger) *evaluationReporter {
	return &evaluationReporter{
		wf:                req.Workflow,
		runID:             req.RunID,
		workflowVersionID: req.WorkflowVersionID,
		createdAt:         time.Now().UnixMilli(),
		total:             total,
		dataset:           make([]map[string]any, 0, total),
		evals:             make([]map[string]any, 0, total),
		logResults:        logResults,
		baseURL:           baseURL,
		logger:            logger,
	}
}

// recordEntry appends one dataset entry's predicted outputs + per-node
// evaluator results to the rolling batch. Mirrors EvaluationReporting.
// add_to_batch (Python) — the dataset list captures workflow predictions,
// the evaluations list captures per-evaluator-node scores keyed by index.
func (r *evaluationReporter) recordEntry(index int, entry map[string]any, result *ExecuteResult, traceID string, duration int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.progress++
	predicted := map[string]any{
		"index":    index,
		"entry":    entry,
		"duration": duration,
	}
	if traceID != "" {
		predicted["trace_id"] = traceID
	}
	if result != nil {
		if result.Result != nil {
			predicted["predicted"] = result.Result
		}
		if result.TotalCost > 0 {
			predicted["cost"] = result.TotalCost
		}
		if result.Error != nil {
			predicted["error"] = result.Error.Message
		}
	}
	r.dataset = append(r.dataset, predicted)

	if result == nil || result.Nodes == nil {
		return
	}
	for nodeID, ns := range result.Nodes {
		// Only evaluator nodes contribute to the evaluations list.
		// Identify them by the presence of a status/score-shaped
		// output map (the engine.runEvaluator surface). Skip Entry,
		// Code, Signature, etc.
		if !isEvaluatorOutput(ns) {
			continue
		}
		nodeName := nodeID
		if node, ok := lookupNode(r.wf, nodeID); ok && node.Data.Name != nil && *node.Data.Name != "" {
			nodeName = *node.Data.Name
		}
		eval := map[string]any{
			"evaluator": nodeID,
			"name":      nodeName,
			"status":    ns.Outputs["status"],
			"index":     index,
			"duration":  ns.DurationMS,
		}
		if v, ok := ns.Outputs["score"]; ok {
			eval["score"] = v
		}
		if v, ok := ns.Outputs["passed"]; ok {
			eval["passed"] = v
		}
		if v, ok := ns.Outputs["label"]; ok && v != "" {
			eval["label"] = v
		}
		if v, ok := ns.Outputs["details"]; ok && v != "" {
			eval["details"] = v
		}
		if v, ok := ns.Outputs["cost"]; ok {
			if cm, isMap := v.(map[string]any); isMap {
				if amount, hasAmount := cm["amount"]; hasAmount {
					eval["cost"] = amount
				}
			} else {
				eval["cost"] = v
			}
		}
		r.evals = append(r.evals, eval)
	}
}

// isEvaluatorOutput recognizes the shape engine.runEvaluator surfaces:
// status + (score|passed|details). Used so non-evaluator nodes don't
// land in the evaluations list. Engine.runEvaluator always sets status,
// and the evaluator block is the only node type that does.
func isEvaluatorOutput(ns *NodeState) bool {
	if ns == nil || ns.Outputs == nil {
		return false
	}
	_, hasStatus := ns.Outputs["status"]
	if !hasStatus {
		return false
	}
	_, hasScore := ns.Outputs["score"]
	_, hasPassed := ns.Outputs["passed"]
	_, hasDetails := ns.Outputs["details"]
	return hasScore || hasPassed || hasDetails
}

func lookupNode(w *dsl.Workflow, id string) (*dsl.Node, bool) {
	for i := range w.Nodes {
		if w.Nodes[i].ID == id {
			return &w.Nodes[i], true
		}
	}
	return nil, false
}

// flush builds and posts the current batch, optionally with finished_at
// stamped on the timestamps. Mirrors EvaluationReporting.send_batch (Python).
// Resets the dataset+evals slices regardless of post outcome — Python's
// behavior, so retries don't double-count entries.
func (r *evaluationReporter) flush(ctx context.Context, finished bool) error {
	r.mu.Lock()
	body := r.buildBodyLocked(finished)
	r.dataset = r.dataset[:0]
	r.evals = r.evals[:0]
	r.mu.Unlock()
	if r.logResults == nil {
		return nil
	}
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("evaluation: marshal batch: %w", err)
	}
	apiKey := ""
	if r.wf != nil {
		apiKey = r.wf.APIKey
	}
	return r.logResults.postBatch(ctx, r.baseURL, apiKey, raw)
}

func (r *evaluationReporter) buildBodyLocked(finished bool) map[string]any {
	timestamps := map[string]any{
		"created_at": r.createdAt,
	}
	if finished {
		timestamps["finished_at"] = time.Now().UnixMilli()
	}
	body := map[string]any{
		"run_id":      r.runID,
		"dataset":     append([]map[string]any{}, r.dataset...),
		"evaluations": append([]map[string]any{}, r.evals...),
		"progress":    r.progress,
		"total":       r.total,
		"timestamps":  timestamps,
	}
	if r.workflowVersionID != "" {
		body["workflow_version_id"] = r.workflowVersionID
	}
	if r.wf != nil {
		// Same dual-key shape as Python (langwatch_nlp/studio/dspy/
		// evaluation.py:238-247): if experiment_id is set the receiver
		// uses it as-is; otherwise it falls back to experiment_slug =
		// workflow_id. Matching this lets the existing
		// processBatchEvaluation route handle our payload unchanged.
		if r.wf.ExperimentID != nil && *r.wf.ExperimentID != "" {
			body["experiment_id"] = *r.wf.ExperimentID
			body["name"] = nil
		} else {
			body["experiment_slug"] = r.wf.WorkflowID
			body["name"] = r.wf.Name + " - Evaluations"
		}
		body["workflow_id"] = r.wf.WorkflowID
	}
	return body
}

// executeEvaluationStream iterates the workflow over the dataset entries
// the user selected (via evaluate_on / dataset_entry), runs the engine
// per entry, accumulates results in an evaluationReporter, and posts a
// final batch to /api/evaluations/batch/log_results so the experiment
// dashboard populates. Mirrors langwatch_nlp's
// execute_evaluation.py + dspy/evaluation.py — without those, the SSE
// frames can land cleanly but the experiment runs page stays at the
// previous run forever (rchaves dogfood 2026-04-29 saw run_kM3T... on
// the wire but nothing on /experiments/<id>).
func (e *Engine) executeEvaluationStream(ctx context.Context, req ExecuteRequest, traceID string, started time.Time, out chan<- StreamEvent) {
	// Emit running first so Studio's reducer always sees a clean
	// running → success/error transition even when the dataset itself
	// is misconfigured (Python's reducer assumes the same shape).
	emit(ctx, out, workflowRunningEvent(req, traceID, started, true))
	entries, err := selectEvaluationEntries(req.Workflow, req.EvaluateOn, req.DatasetEntry)
	if err != nil {
		emit(ctx, out, workflowErrorEvent(req, traceID, err.Error(), true))
		emit(ctx, out, doneEvent(traceID, newRunState(req.Workflow), started))
		return
	}
	total := len(entries)

	reporter := newEvaluationReporter(req, total, e.langwatchBaseURL, newHTTPEvalLogResultsClient(), e.logger)
	// Initial empty batch — mirrors Python's reporting.send_batch() at
	// kickoff (langwatch_nlp/studio/execute/execute_evaluation.py:167)
	// so the experiment row exists in the dashboard before any results
	// land. Failure is non-fatal — the iteration will retry on every
	// flush.
	if err := reporter.flush(ctx, false); err != nil {
		e.logger.Warn("evaluation: initial empty batch post failed", "err", err)
	}

	for i, entry := range entries {
		if err := ctx.Err(); err != nil {
			emit(ctx, out, workflowErrorEvent(req, traceID, err.Error(), true))
			break
		}
		entryStart := time.Now()
		entryReq := ExecuteRequest{
			Workflow:  req.Workflow,
			Inputs:    entry,
			Origin:    req.Origin,
			ProjectID: req.ProjectID,
			ThreadID:  req.ThreadID,
			// Each entry gets its own trace id so the LangWatch trace
			// view shows one trace per evaluated row, not all rows
			// merged into the parent eval trace.
			TraceID: "",
			Type:    "execute_flow",
		}
		entryRes, err := e.Execute(ctx, entryReq)
		duration := time.Since(entryStart).Milliseconds()
		var entryTraceID string
		if entryRes != nil {
			entryTraceID = entryRes.TraceID
		}
		if err != nil && entryRes == nil {
			// Surface the error as a dataset row but don't abort the
			// whole evaluation — Python's DSPy Evaluate continues past
			// per-row failures (provide_traceback=True), and the UI
			// renders failed rows in red rather than stopping at the
			// first one.
			entryRes = &ExecuteResult{
				Status: "error",
				Error:  &NodeError{Type: "engine_error", Message: err.Error()},
			}
		}
		reporter.recordEntry(i, entry, entryRes, entryTraceID, duration)
		emit(ctx, out, evaluationProgressEvent(req, traceID, reporter.progress, total, started))
	}

	// Final flush carries finished_at — the same call mirrors Python's
	// EvaluationReporting.wait_for_completion (which calls send_batch
	// with finished=True before joining the worker threads).
	if err := reporter.flush(ctx, true); err != nil {
		e.logger.Warn("evaluation: final batch post failed — experiment row may stay incomplete", "err", err)
	}
	emit(ctx, out, workflowSuccessEvent(req, traceID, newRunState(req.Workflow), started, true))
	emit(ctx, out, doneEvent(traceID, newRunState(req.Workflow), started))
}

// selectEvaluationEntries materializes the workflow's Entry node dataset
// and slices it according to evaluate_on. Mirrors execute_evaluation.py's
// branch on event.evaluate_on (full / test / train / specific). The
// train/test split is intentionally simpler than Python's
// sklearn.train_test_split — we deterministic-slice by index in order
// instead of shuffling. The Studio "Evaluate" button defaults to "full"
// which is the dogfood path; "test"/"train" come from saved dataset
// configs, "specific" from re-running a single row from the results
// table.
func selectEvaluationEntries(wf *dsl.Workflow, evaluateOn string, datasetEntry *int) ([]map[string]any, error) {
	if wf == nil {
		return nil, fmt.Errorf("evaluation: nil workflow")
	}
	var entryNode *dsl.Node
	for i := range wf.Nodes {
		if wf.Nodes[i].Type == dsl.ComponentEntry {
			entryNode = &wf.Nodes[i]
			break
		}
	}
	if entryNode == nil {
		return nil, fmt.Errorf("evaluation: workflow has no entry node")
	}
	if entryNode.Data.Dataset == nil || entryNode.Data.Dataset.Inline == nil {
		return nil, fmt.Errorf("evaluation: entry node has no inline dataset (remote datasets not yet supported on Go path)")
	}
	rows, err := dataset.Materialize(entryNode.Data.Dataset.Inline)
	if err != nil {
		return nil, fmt.Errorf("evaluation: materialize dataset: %w", err)
	}
	if len(rows) == 0 {
		return nil, nil
	}
	mode := evaluateOn
	if mode == "" {
		mode = "full"
	}
	switch mode {
	case "full":
		return rows, nil
	case "test", "train":
		// train/test split — slice by entry node's train_size. Python
		// uses sklearn shuffle; we slice in order. This loses the
		// shuffle guarantee but keeps results stable for test
		// re-runs, which is what Studio cares about for now.
		train, test := splitTrainTest(rows, entryNode.Data.TrainSize, entryNode.Data.TestSize)
		if mode == "train" {
			return train, nil
		}
		return test, nil
	case "specific":
		if datasetEntry == nil {
			return nil, fmt.Errorf("evaluation: dataset_entry required for evaluate_on=specific")
		}
		idx := *datasetEntry
		if idx < 0 || idx >= len(rows) {
			return nil, fmt.Errorf("evaluation: dataset_entry %d out of range [0,%d)", idx, len(rows))
		}
		return []map[string]any{rows[idx]}, nil
	default:
		return nil, fmt.Errorf("evaluation: invalid evaluate_on %q (expected full/test/train/specific)", mode)
	}
}

// splitTrainTest divides rows into train/test slices using the entry
// node's configured sizes. When both sizes are < 1 they are treated as
// percentages of the row count; otherwise as absolute row counts. Empty
// inputs / nil sizes default to a 50/50 split — matching the Python
// behavior for unconfigured datasets.
func splitTrainTest(rows []map[string]any, trainSize, testSize *float64) (train, test []map[string]any) {
	if len(rows) == 0 {
		return nil, nil
	}
	n := len(rows)
	tr := 0.5
	if trainSize != nil {
		tr = *trainSize
	}
	var trainN int
	if tr <= 0 {
		trainN = 0
	} else if tr <= 1 {
		trainN = int(float64(n) * tr)
	} else {
		trainN = int(tr)
	}
	if trainN > n {
		trainN = n
	}
	if trainN < 0 {
		trainN = 0
	}
	_ = testSize // honored implicitly via 1 - train; explicit testSize would let
	// the user evaluate on a subset rather than the complement, but the
	// dogfood path doesn't exercise that.
	return rows[:trainN], rows[trainN:]
}

// evaluationProgressEvent emits an evaluation_state_change carrying the
// current progress + total counts. Studio's reducer renders the progress
// bar and partial results from these (langwatch/src/optimization_studio/
// hooks/usePostEvent.tsx case "evaluation_state_change"). Without these
// the UI stays at "Waiting for evaluation results" until the success
// event lands at the very end.
func evaluationProgressEvent(req ExecuteRequest, traceID string, progress, total int, started time.Time) StreamEvent {
	return StreamEvent{
		Type:    "evaluation_state_change",
		TraceID: traceID,
		Payload: map[string]any{
			"evaluation_state": map[string]any{
				"status":   "running",
				"run_id":   req.RunID,
				"progress": progress,
				"total":    total,
				"timestamps": map[string]any{
					"started_at": started.UnixMilli(),
				},
			},
		},
	}
}
