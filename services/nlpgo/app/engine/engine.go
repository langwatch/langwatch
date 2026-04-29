// Package engine orchestrates a workflow execution: it takes a parsed
// Workflow, plans the DAG, and dispatches each node to the right block
// executor with the resolved upstream inputs. Layers run sequentially;
// nodes within a layer run concurrently (one goroutine each).
//
// See _shared/contract.md §6 + specs/nlp-go/engine.feature.
package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/agentblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/dataset"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/evaluatorblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/planner"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/template"
)

// Engine wires the per-block executors together. It's the unit the
// HTTP handler invokes per /go/studio/execute_sync request.
type Engine struct {
	http             *httpblock.Executor
	code             *codeblock.Executor
	llm              app.LLMClient
	evaluator        *evaluatorblock.Executor
	agentWorkflow    *agentblock.WorkflowRunner
	langwatchBaseURL string
	logger           Logger
}

// Logger is the minimal logger interface the engine needs. Any *zap.Logger
// satisfies it; tests can pass a noop.
type Logger interface {
	Info(msg string, keysAndValues ...any)
	Warn(msg string, keysAndValues ...any)
	Error(msg string, keysAndValues ...any)
}

// Options configures an Engine.
type Options struct {
	HTTP             *httpblock.Executor
	Code             *codeblock.Executor
	LLM              app.LLMClient
	Evaluator        *evaluatorblock.Executor
	AgentWorkflow    *agentblock.WorkflowRunner
	LangWatchBaseURL string // base URL for evaluator + agent-workflow callbacks (e.g. https://app.langwatch.ai)
	Logger           Logger
}

// New builds an Engine.
func New(opts Options) *Engine {
	if opts.Logger == nil {
		opts.Logger = noopLogger{}
	}
	return &Engine{
		http:             opts.HTTP,
		code:             opts.Code,
		llm:              opts.LLM,
		evaluator:        opts.Evaluator,
		agentWorkflow:    opts.AgentWorkflow,
		langwatchBaseURL: strings.TrimRight(opts.LangWatchBaseURL, "/"),
		logger:           opts.Logger,
	}
}

// ExecuteRequest is what the handler hands to the engine per call.
type ExecuteRequest struct {
	Workflow *dsl.Workflow
	// Inputs, if non-nil, provide either entry-node outputs (for
	// execute_flow / execute_evaluation, when NodeID is empty) or the
	// target node's manual inputs (for execute_component, when NodeID
	// names that target). The Studio "Run with manual input" flow
	// types into a node's input panel and clicks Execute → the
	// values land here keyed by input identifier.
	Inputs    map[string]any
	Origin    string
	TraceID   string
	ProjectID string
	// ThreadID groups related Studio runs into a single conversation
	// in the LangWatch trace UI. Mirrors langwatch_nlp's
	// `ExecuteComponentPayload.thread_id` (commit ac986cc3c). Plumbed
	// through to outbound HTTP calls (evaluator + agent-workflow) as
	// the `X-LangWatch-Thread-Id` header so the receiving services can
	// stamp it onto the spans they emit.
	ThreadID string
	// NodeID, when non-empty, signals the Studio execute_component
	// flow: Inputs are the user-typed values for the named node, fed
	// in directly (bypassing edge-based resolution). Empty means
	// execute_flow / execute_evaluation, where Inputs are entry-node
	// outputs and propagate via edges. Mirrors Python's
	// `ExecuteComponentPayload.node_id` (langwatch_nlp/studio/app.py).
	NodeID string
	// Type is the StudioClientEvent discriminator. Routes the engine
	// between the parallel state-event families Studio's reducer
	// expects (`execution_state_change` for execute_flow,
	// `evaluation_state_change` for execute_evaluation). Empty defaults
	// to execute_flow shape — the legacy behavior for flat-payload
	// callers (tests + curl) that predate the type field.
	Type string
	// RunID is the evaluation run identifier from execute_evaluation's
	// payload. Stamped on evaluation_state_change events so Studio's
	// useEvaluationExecution reducer can match streamed updates to the
	// run it dispatched.
	RunID string
}

// ExecuteResult is what the engine returns. It mirrors the Python
// `done` event payload so the handler can serialize it directly.
type ExecuteResult struct {
	TraceID    string                `json:"trace_id"`
	Status     string                `json:"status"` // success | error
	Result     map[string]any        `json:"result,omitempty"`
	Nodes      map[string]*NodeState `json:"nodes,omitempty"`
	TotalCost  float64               `json:"total_cost,omitempty"`
	DurationMS int64                 `json:"duration_ms,omitempty"`
	Error      *NodeError            `json:"error,omitempty"`
}

// NodeState carries the per-node execution outcome surfaced in the
// `result.nodes` field of the response and in `execution_state_change`
// SSE events.
type NodeState struct {
	ID         string         `json:"id"`
	Status     string         `json:"status"`
	Inputs     map[string]any `json:"inputs,omitempty"`
	Outputs    map[string]any `json:"outputs,omitempty"`
	Stdout     string         `json:"stdout,omitempty"`
	Stderr     string         `json:"stderr,omitempty"`
	Cost       float64        `json:"cost,omitempty"`
	DurationMS int64          `json:"duration_ms,omitempty"`
	Error      *NodeError     `json:"error,omitempty"`
}

// NodeError is the structured error attached to a failed node.
type NodeError struct {
	NodeID    string `json:"node_id,omitempty"`
	Type      string `json:"type"`
	Message   string `json:"message"`
	Traceback string `json:"traceback,omitempty"`
	Status    int    `json:"upstream_status,omitempty"`
}

// Execute runs the workflow.
func (e *Engine) Execute(ctx context.Context, req ExecuteRequest) (*ExecuteResult, error) {
	if req.Workflow == nil {
		return nil, errors.New("engine: nil workflow")
	}
	traceID := req.TraceID
	if traceID == "" {
		traceID = ulid.Make().String()
		// Write back so downstream dispatch (runEvaluator,
		// runAgentWorkflow) sees the same trace id when calling out
		// to LangWatch endpoints. Without this, server-side spans
		// for evaluator + agent runs have no correlation back to the
		// workflow execution.
		req.TraceID = traceID
	}
	plan, err := planner.New(req.Workflow)
	if err != nil {
		return nil, err
	}
	state := newRunState(req.Workflow)
	applyManualInputs(state, req)
	started := time.Now()
	// execute_component (req.NodeID set) dispatches ONLY the requested
	// node — Studio's "Run with manual input" flow on a single
	// component card. Mirrors Python's execute_component.py which
	// instantiates and invokes one materialized component, never the
	// full DAG. Pre-fix the engine walked plan.Layers regardless and
	// surfaced spurious entry/end/sibling spans in the trace
	// (rchaves callout 2026-04-29 — clicked Execute on Code, trace
	// showed entry+code+end+evaluator).
	if req.NodeID != "" {
		if _, ok := state.nodes[req.NodeID]; !ok {
			return nil, fmt.Errorf("engine: execute_component target node %q not in workflow", req.NodeID)
		}
		e.runLayer(ctx, req, plan, state, []string{req.NodeID})
		return finalize(state, traceID, started, nil), nil
	}
	for _, layer := range plan.Layers {
		if err := ctx.Err(); err != nil {
			return finalize(state, traceID, started, err), nil
		}
		e.runLayer(ctx, req, plan, state, layer)
		if state.firstError != nil {
			return finalize(state, traceID, started, nil), nil
		}
	}
	return finalize(state, traceID, started, nil), nil
}

func (e *Engine) runLayer(ctx context.Context, req ExecuteRequest, plan *planner.Plan, state *runState, layer []string) {
	var wg sync.WaitGroup
	for _, id := range layer {
		nodeID := id
		wg.Add(1)
		go func() {
			defer wg.Done()
			node := state.nodes[nodeID]
			inputs := state.resolveInputs(plan, nodeID)
			ns := &NodeState{ID: nodeID, Status: "running", Inputs: inputs}
			nodeCtx, span := startNodeSpan(ctx, node, req)
			started := time.Now()
			outputs, derr := e.dispatch(nodeCtx, req, node, inputs, ns)
			ns.DurationMS = time.Since(started).Milliseconds()
			if derr != nil {
				ns.Status = "error"
				ns.Error = derr
				ns.Error.NodeID = nodeID
				state.recordError(derr)
			} else {
				ns.Status = "success"
				ns.Outputs = outputs
				state.recordOutputs(nodeID, outputs)
			}
			// endNodeSpan reads ns.Outputs to stamp langwatch.output, so
			// it must run after the success branch sets it. Tracing parity
			// with Python's execute_component depends on this attribute
			// being present.
			endNodeSpan(span, ns, derr)
			state.recordState(nodeID, ns)
		}()
	}
	wg.Wait()
}

// dispatch routes a node to its executor and returns its declared
// outputs (already filtered to the node's `outputs` declaration so
// downstream nodes get exactly what the workflow author requested).
func (e *Engine) dispatch(ctx context.Context, req ExecuteRequest, node *dsl.Node, inputs map[string]any, ns *NodeState) (map[string]any, *NodeError) {
	switch node.Type {
	case dsl.ComponentEntry:
		return e.runEntry(node, req)
	case dsl.ComponentEnd:
		return inputs, nil
	case dsl.ComponentCode:
		return e.runCode(ctx, node, inputs, ns)
	case dsl.ComponentHTTP:
		return e.runHTTP(ctx, node, inputs, ns)
	case dsl.ComponentSignature:
		return e.runSignature(ctx, req, node, inputs)
	case dsl.ComponentPromptingTechnique:
		// Decorator: produces no outputs of its own; signature nodes
		// reference it via a parameter and apply it at LLM-call time.
		return map[string]any{}, nil
	case dsl.ComponentEvaluator:
		return e.runEvaluator(ctx, req, node, inputs, ns)
	case dsl.ComponentAgent:
		return e.runAgent(ctx, req, node, inputs, ns)
	default:
		return nil, &NodeError{Type: "unsupported_node_kind", Message: "node kind not supported on Go engine: " + string(node.Type)}
	}
}

func (e *Engine) runEntry(node *dsl.Node, req ExecuteRequest) (map[string]any, *NodeError) {
	// An empty `inputs` map (e.g. ExecuteFlowPayload's `inputs: [{}]`)
	// means "use the workflow's dataset", not "set entry outputs to
	// the empty map". Only honor explicit non-empty inputs as a
	// dataset override.
	//
	// When NodeID is set (execute_component) the inputs belong to that
	// target node, NOT to entry — runState.resolveInputs short-circuits
	// for the target. Entry must fall through to dataset materialization
	// here so it doesn't accidentally swallow the user's per-node typing.
	if len(req.Inputs) > 0 && req.NodeID == "" {
		return req.Inputs, nil
	}
	if node.Data.Dataset == nil || node.Data.Dataset.Inline == nil {
		// Empty entry — no records, no inputs to pass downstream.
		return map[string]any{}, nil
	}
	rows, err := dataset.Materialize(node.Data.Dataset.Inline)
	if err != nil {
		return nil, &NodeError{Type: "invalid_dataset", Message: err.Error()}
	}
	if node.Data.EntrySelection != nil && node.Data.EntrySelection.IsSet() {
		row, err := dataset.SelectByEntry(rows, node.Data.EntrySelection, nil)
		if err != nil {
			return nil, &NodeError{Type: "invalid_dataset", Message: err.Error()}
		}
		return row, nil
	}
	if len(rows) > 0 {
		// execute_sync without entry_selection picks row 0 by default
		// (Python falls back the same way for a single-trace blocking
		// call; multi-record iteration is the SSE path's job).
		return rows[0], nil
	}
	return map[string]any{}, nil
}

func (e *Engine) runCode(ctx context.Context, node *dsl.Node, inputs map[string]any, ns *NodeState) (map[string]any, *NodeError) {
	if e.code == nil {
		return nil, &NodeError{Type: "code_runner_unavailable", Message: "no code runner configured"}
	}
	code := paramString(node.Data.Parameters, "code")
	declared := outputNames(node.Data.Outputs)
	res, err := e.code.Execute(ctx, codeblock.Request{
		Code:            code,
		Inputs:          inputs,
		DeclaredOutputs: declared,
	})
	if err != nil {
		return nil, &NodeError{Type: "code_runner_error", Message: err.Error()}
	}
	ns.Stdout = res.Stdout
	ns.Stderr = res.Stderr
	if res.Error != nil {
		return nil, &NodeError{Type: res.Error.Type, Message: res.Error.Message, Traceback: res.Error.Traceback}
	}
	return res.Outputs, nil
}

func (e *Engine) runHTTP(ctx context.Context, node *dsl.Node, inputs map[string]any, ns *NodeState) (map[string]any, *NodeError) {
	if e.http == nil {
		return nil, &NodeError{Type: "http_executor_unavailable", Message: "no http executor configured"}
	}
	req := httpblock.Request{
		URL:          paramString(node.Data.Parameters, "url"),
		Method:       paramString(node.Data.Parameters, "method"),
		BodyTemplate: paramString(node.Data.Parameters, "body_template"),
		OutputPath:   paramString(node.Data.Parameters, "output_path"),
		Headers:      paramStringMap(node.Data.Parameters, "headers"),
		Auth:         paramAuth(node.Data.Parameters),
		TimeoutMS:    paramInt(node.Data.Parameters, "timeout_ms"),
		Inputs:       inputs,
	}
	res, err := e.http.Execute(ctx, req)
	if err != nil {
		var ue *httpblock.UpstreamError
		if errors.As(err, &ue) {
			return nil, &NodeError{Type: "upstream_http_error", Message: err.Error(), Status: ue.Status}
		}
		return nil, &NodeError{Type: "http_error", Message: err.Error()}
	}
	out := make(map[string]any, 1)
	if res.Output != nil {
		out["value"] = res.Output
	}
	if outs := outputNames(node.Data.Outputs); len(outs) == 1 && outs[0] != "value" {
		// Workflow-author chose a single output name — bind there.
		out = map[string]any{outs[0]: res.Output}
	}
	_ = ns
	return out, nil
}

func (e *Engine) runSignature(ctx context.Context, execReq ExecuteRequest, node *dsl.Node, inputs map[string]any) (map[string]any, *NodeError) {
	if e.llm == nil {
		return nil, &NodeError{Type: "llm_executor_unavailable", Message: "LLM executor not yet wired"}
	}
	llmCfg := resolveLLMConfig(node, execReq.Workflow)
	model := ""
	provider := ""
	if llmCfg != nil && llmCfg.Model != nil {
		model, provider = splitModel(*llmCfg.Model)
	}
	messages := buildMessages(node, inputs)
	req := app.LLMRequest{
		Model:    model,
		Provider: provider,
		Messages: messages,
	}
	if llmCfg != nil {
		req.Temperature = llmCfg.Temperature
		req.MaxTokens = llmCfg.MaxTokens
		req.TopP = llmCfg.TopP
		if llmCfg.Reasoning != nil {
			req.ReasoningEffort = *llmCfg.Reasoning
		}
		req.LiteLLMParams = make(map[string]any, len(llmCfg.LiteLLMParams))
		for k, v := range llmCfg.LiteLLMParams {
			req.LiteLLMParams[k] = v
		}
	}
	// Wire structured-output response_format when the signature has
	// either a json_schema-typed output OR multiple outputs that need
	// field separation. The Python path does the equivalent via DSPy's
	// `_get_structured_outputs_response_format` (template_adapter.py).
	useStructured := signatureNeedsStructuredOutput(node.Data.Outputs)
	if useStructured {
		schemaName := node.ID + "Outputs"
		if node.Data.Name != nil && *node.Data.Name != "" {
			schemaName = *node.Data.Name + "Outputs"
		}
		req.ResponseFormat = composeSignatureResponseFormat(sanitizeSchemaName(schemaName), node.Data.Outputs)
	}
	llmCtx, llmSpan := startLLMSpan(ctx, model, provider, messages)
	resp, err := e.llm.Execute(llmCtx, req)
	endLLMSpan(llmSpan, resp, err)
	if err != nil {
		return nil, &NodeError{Type: "llm_error", Message: err.Error()}
	}
	if useStructured {
		out, warnings := extractSignatureOutputs(resp.Content, node.Data.Outputs)
		// Surface parse-and-split warnings (malformed JSON,
		// missing fields) at warn level so operators see when a
		// signature node received a partial/malformed structured
		// response — silently dropping these would have downstream
		// nodes consuming nil/empty values with no signal.
		for _, w := range warnings {
			e.logger.Warn(w, "node_id", node.ID)
		}
		return out, nil
	}
	out := make(map[string]any, len(outputNames(node.Data.Outputs)))
	for _, name := range outputNames(node.Data.Outputs) {
		out[name] = resp.Content
	}
	return out, nil
}

// signatureNeedsStructuredOutput returns true when the engine should
// ask the LLM for a JSON-shaped response and parse it across multiple
// outputs. True iff any output is typed json_schema OR there are 2+
// outputs (multi-output requires field separation — assigning the raw
// content to every declared output loses signal).
func signatureNeedsStructuredOutput(outputs []dsl.Field) bool {
	if len(outputs) >= 2 {
		return true
	}
	for _, f := range outputs {
		if f.Type == dsl.FieldTypeJSONSchema {
			return true
		}
	}
	return false
}

// sanitizeSchemaName normalizes a string to OpenAI's
// response_format.json_schema.name pattern ^[a-zA-Z0-9_-]{1,64}$.
// Disallowed characters become underscores; an empty/all-illegal
// result falls back to "Outputs"; the result is truncated to 64
// chars. Mirrors Python's behavior implicitly: DSPy generates a
// Pydantic class name from the node, and Pydantic rejects illegal
// identifier chars before they reach the LLM. Without this, node
// names like "LLM Call" or models with "." (e.g. "gpt-5.2") cause
// OpenAI to reject the request with `Invalid 'response_format.
// json_schema.name': string does not match pattern '^[a-zA-Z0-9_-]+$'`.
func sanitizeSchemaName(name string) string {
	if name == "" {
		return "Outputs"
	}
	var b strings.Builder
	b.Grow(len(name))
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z',
			r >= 'A' && r <= 'Z',
			r >= '0' && r <= '9',
			r == '_', r == '-':
			b.WriteRune(r)
		default:
			b.WriteByte('_')
		}
	}
	out := b.String()
	if strings.Trim(out, "_") == "" {
		return "Outputs"
	}
	if len(out) > 64 {
		out = out[:64]
	}
	return out
}

// composeSignatureResponseFormat builds the OpenAI-style response_format
// covering every declared output of a signature node. Each output is a
// property on a single root object — json_schema-typed outputs use the
// customer-provided schema verbatim, scalar types map to their JSON
// Schema equivalent.
func composeSignatureResponseFormat(name string, outputs []dsl.Field) *app.ResponseFormat {
	properties := make(map[string]any, len(outputs))
	required := make([]string, 0, len(outputs))
	for _, f := range outputs {
		properties[f.Identifier] = jsonSchemaForField(f)
		required = append(required, f.Identifier)
	}
	return &app.ResponseFormat{
		Type: "json_schema",
		JSONSchema: map[string]any{
			"name":   name,
			"strict": true,
			"schema": map[string]any{
				"type":                 "object",
				"properties":           properties,
				"required":             required,
				"additionalProperties": false,
			},
		},
	}
}

// jsonSchemaForField returns the JSON Schema fragment for one signature
// output field. json_schema-typed fields use the schema the workflow
// author attached; scalar field types fall back to a minimal type-only
// schema sufficient for the LLM provider to constrain its reply.
func jsonSchemaForField(f dsl.Field) map[string]any {
	if f.Type == dsl.FieldTypeJSONSchema && len(f.JSONSchema) > 0 {
		return f.JSONSchema
	}
	switch f.Type {
	case dsl.FieldTypeInt:
		return map[string]any{"type": "integer"}
	case dsl.FieldTypeFloat:
		return map[string]any{"type": "number"}
	case dsl.FieldTypeBool:
		return map[string]any{"type": "boolean"}
	case dsl.FieldTypeList,
		dsl.FieldTypeListStr,
		dsl.FieldTypeListFloat,
		dsl.FieldTypeListInt,
		dsl.FieldTypeListBool:
		return map[string]any{"type": "array"}
	case dsl.FieldTypeDict:
		return map[string]any{"type": "object"}
	default:
		return map[string]any{"type": "string"}
	}
}

// extractSignatureOutputs splits a structured LLM response across the
// signature node's declared outputs. Expects a JSON object whose
// properties match the output identifiers. On parse failure falls back
// to assigning the raw content to the first output so the workflow at
// least gets *something* — same defensive posture as the http block's
// non-JSON fallback.
func extractSignatureOutputs(content string, outputs []dsl.Field) (map[string]any, []string) {
	out := make(map[string]any, len(outputs))
	var parsed map[string]any
	if err := jsonUnmarshalRaw([]byte(content), &parsed); err != nil {
		if len(outputs) > 0 {
			out[outputs[0].Identifier] = content
		}
		return out, []string{fmt.Sprintf("signature: structured response did not parse as JSON object: %v", err)}
	}
	var warnings []string
	for _, f := range outputs {
		if v, ok := parsed[f.Identifier]; ok {
			out[f.Identifier] = v
		} else {
			warnings = append(warnings, fmt.Sprintf("signature: missing %q in structured response", f.Identifier))
		}
	}
	return out, warnings
}

// runEvaluator dispatches an evaluator node to the LangWatch evaluator
// HTTP endpoint via the evaluatorblock executor. Mirrors
// langwatch_nlp/.../evaluators/langwatch.py LangWatchEvaluator.forward —
// the evaluator slug + settings + name come from the node parameters,
// the data dict from upstream inputs.
func (e *Engine) runEvaluator(ctx context.Context, req ExecuteRequest, node *dsl.Node, inputs map[string]any, ns *NodeState) (map[string]any, *NodeError) {
	if e.evaluator == nil {
		return nil, &NodeError{Type: "evaluator_executor_unavailable", Message: "evaluator executor not configured"}
	}
	if e.langwatchBaseURL == "" {
		return nil, &NodeError{Type: "evaluator_unconfigured", Message: "LangWatchBaseURL is required to call the evaluator API"}
	}
	if req.Workflow == nil || req.Workflow.APIKey == "" {
		return nil, &NodeError{Type: "evaluator_unauthorized", Message: "workflow.api_key is required for evaluator dispatch"}
	}

	// Evaluator slug lives on the typed `data.evaluator` field in the
	// canonical Studio shape (langwatch/src/optimization_studio/types/
	// dsl.ts → `evaluator?: EvaluatorTypes | "custom/<id>" | "evaluators/<id>"`).
	// Older workflows may have stuffed it into parameters[]; honor both
	// so existing user workflows keep evaluating.
	slug := ""
	if node.Data.Evaluator != nil {
		slug = *node.Data.Evaluator
	}
	if slug == "" {
		slug = paramString(node.Data.Parameters, "evaluator")
	}
	if slug == "" {
		return nil, &NodeError{Type: "evaluator_missing_slug", Message: "evaluator parameter is required (e.g. langevals/exact_match)"}
	}

	res, err := e.evaluator.Execute(ctx, evaluatorblock.Request{
		BaseURL:       e.langwatchBaseURL,
		APIKey:        req.Workflow.APIKey,
		EvaluatorSlug: slug,
		Name:          paramString(node.Data.Parameters, "name"),
		Settings:      paramAnyMap(node.Data.Parameters, "settings"),
		Data:          inputs,
		TraceID:       req.TraceID,
		Origin:        req.Origin,
		ThreadID:      req.ThreadID,
	})
	if err != nil {
		return nil, &NodeError{Type: "evaluator_error", Message: err.Error()}
	}

	// Surface the full result on the node state for the SSE consumer +
	// final result panel. The Studio expects the same field names the
	// Python EvaluationResultWithMetadata produces.
	out := map[string]any{
		"status":   res.Status,
		"details":  res.Details,
	}
	if res.Score != nil {
		out["score"] = *res.Score
	}
	if res.Passed != nil {
		out["passed"] = *res.Passed
	}
	if res.Label != "" {
		out["label"] = res.Label
	}
	if res.Cost != nil {
		out["cost"] = map[string]any{
			"currency": res.Cost.Currency,
			"amount":   res.Cost.Amount,
		}
		ns.Cost = res.Cost.Amount
	}

	// The evaluator node may declare a subset of outputs (e.g. a
	// workflow that only cares about `passed`). Filter to declared
	// names if present; otherwise hand back everything.
	declared := outputNames(node.Data.Outputs)
	if len(declared) == 0 {
		return out, nil
	}
	filtered := make(map[string]any, len(declared))
	for _, name := range declared {
		if v, ok := out[name]; ok {
			filtered[name] = v
		}
	}
	return filtered, nil
}

// runAgent dispatches an agent node based on its `agent_type` parameter.
// Three modes match langwatch_nlp/.../studio/parser.py "agent" branch:
//
//   - http     → reuse the HTTP-block executor with the agent's URL/method/etc.
//   - code     → reuse the code-block executor with the agent's `code`.
//   - workflow → call the LangWatch app's /api/workflows/<id>[/<version>]/run
//                via the agentblock.WorkflowRunner.
func (e *Engine) runAgent(ctx context.Context, req ExecuteRequest, node *dsl.Node, inputs map[string]any, ns *NodeState) (map[string]any, *NodeError) {
	agentType := paramString(node.Data.Parameters, "agent_type")
	switch agentType {
	case "http":
		return e.runHTTP(ctx, node, inputs, ns)
	case "code":
		return e.runCode(ctx, node, inputs, ns)
	case "workflow":
		return e.runAgentWorkflow(ctx, req, node, inputs, ns)
	case "":
		return nil, &NodeError{Type: "agent_missing_type", Message: "agent_type parameter is required (http | code | workflow)"}
	default:
		return nil, &NodeError{Type: "agent_unknown_type", Message: "unknown agent_type: " + agentType}
	}
}

// runAgentWorkflow handles agent_type=workflow: POST to the LangWatch
// app's /api/workflows/<id>[/<version>]/run with the resolved inputs.
func (e *Engine) runAgentWorkflow(ctx context.Context, req ExecuteRequest, node *dsl.Node, inputs map[string]any, ns *NodeState) (map[string]any, *NodeError) {
	if e.agentWorkflow == nil {
		return nil, &NodeError{Type: "agent_workflow_executor_unavailable", Message: "agent workflow runner not configured"}
	}
	if e.langwatchBaseURL == "" {
		return nil, &NodeError{Type: "agent_unconfigured", Message: "LangWatchBaseURL is required to call workflow agents"}
	}
	if req.Workflow == nil || req.Workflow.APIKey == "" {
		return nil, &NodeError{Type: "agent_unauthorized", Message: "workflow.api_key is required for agent workflow dispatch"}
	}

	workflowID := paramString(node.Data.Parameters, "workflow_id")
	if workflowID == "" {
		return nil, &NodeError{Type: "agent_missing_workflow_id", Message: "workflow_id parameter is required for agent_type=workflow"}
	}

	res, err := e.agentWorkflow.Execute(ctx, agentblock.WorkflowRunRequest{
		BaseURL:    e.langwatchBaseURL,
		APIKey:     req.Workflow.APIKey,
		WorkflowID: workflowID,
		VersionID:  paramString(node.Data.Parameters, "version_id"),
		Inputs:     inputs,
		TraceID:    req.TraceID,
		Origin:     req.Origin,
		ThreadID:   req.ThreadID,
	})
	if err != nil {
		return nil, &NodeError{Type: "agent_workflow_error", Message: err.Error()}
	}

	_ = ns
	// The /run endpoint returns the workflow's output directly. If the
	// agent node declares specific output names, bind to the first one;
	// otherwise expose under "value" matching the http-block convention.
	declared := outputNames(node.Data.Outputs)
	if len(declared) == 1 {
		return map[string]any{declared[0]: res.Result}, nil
	}
	if m, ok := res.Result.(map[string]any); ok && len(declared) > 1 {
		// Workflow already returned a map — try to bind declared names.
		filtered := make(map[string]any, len(declared))
		for _, name := range declared {
			if v, ok := m[name]; ok {
				filtered[name] = v
			}
		}
		if len(filtered) > 0 {
			return filtered, nil
		}
	}
	return map[string]any{"value": res.Result}, nil
}

// applyManualInputs primes runState with the inbound execute_component
// payload's `node_id` + `inputs` so resolveInputs can short-circuit for
// the target node. Both Execute and ExecuteStream MUST call this — the
// streaming path forgot it once already (Bug 1, ash-detected via Studio
// dogfood) and the symptom (Code.__call__() missing input) was bizarre.
// Helper exists to keep that parity from drifting again.
func applyManualInputs(state *runState, req ExecuteRequest) {
	if req.NodeID == "" || len(req.Inputs) == 0 {
		return
	}
	state.manualInputsTarget = req.NodeID
	state.manualInputs = req.Inputs
}

// runState aggregates per-node outputs and tracks the first error
// observed. It is the engine's equivalent of WorkflowState.execution.
type runState struct {
	mu          sync.Mutex
	nodes       map[string]*dsl.Node
	outputs     map[string]map[string]any
	states      map[string]*NodeState
	firstError  *NodeError
	endNodeID   string
	totalCost   float64
	// edgesByTarget indexes Edge entries by their target node id so
	// resolveInputs can rename outputs.<source_name> → inputs.<target_name>
	// per Studio's wire convention.
	edgesByTarget map[string][]dsl.Edge
	// manualInputsTarget + manualInputs back the Studio
	// execute_component flow: when manualInputsTarget == nodeID,
	// resolveInputs returns manualInputs directly instead of walking
	// inbound edges. Both are zero-valued for execute_flow runs.
	manualInputsTarget string
	manualInputs       map[string]any
}

func newRunState(w *dsl.Workflow) *runState {
	r := &runState{
		nodes:         make(map[string]*dsl.Node, len(w.Nodes)),
		outputs:       make(map[string]map[string]any, len(w.Nodes)),
		states:        make(map[string]*NodeState, len(w.Nodes)),
		edgesByTarget: make(map[string][]dsl.Edge, len(w.Edges)),
	}
	for i := range w.Nodes {
		n := &w.Nodes[i]
		r.nodes[n.ID] = n
		if n.Type == dsl.ComponentEnd && r.endNodeID == "" {
			r.endNodeID = n.ID
		}
	}
	for _, e := range w.Edges {
		r.edgesByTarget[e.Target] = append(r.edgesByTarget[e.Target], e)
	}
	return r
}

func (r *runState) recordOutputs(id string, outputs map[string]any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.outputs[id] = outputs
}

func (r *runState) recordState(id string, ns *NodeState) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.states[id] = ns
	r.totalCost += ns.Cost
}

func (r *runState) recordError(e *NodeError) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.firstError == nil {
		r.firstError = e
	}
}

// resolveInputs builds the input map for a node by following each
// inbound Edge from the workflow. The Edge's sourceHandle and
// targetHandle name the columns being plumbed: a typical Studio edge
// has sourceHandle="outputs.q", targetHandle="inputs.x" meaning "this
// node's input 'x' is the source node's output 'q'". We support the
// stripped form too (just "q" / "x") so workflows authored without the
// outputs./inputs. prefix still wire correctly. When an edge has no
// usable handle (rare; typically just a control-flow edge), all
// upstream outputs are merged in by their original names — preserving
// today's "all keys flow through" behavior for legacy workflows.
func (r *runState) resolveInputs(_ *planner.Plan, id string) map[string]any {
	out := map[string]any{}
	// Lock spans the entire read of r.outputs because sibling goroutines
	// in the same layer can be writing to r.outputs (recordOutputs)
	// concurrently. The previous shape (lock for edges, unlock, then
	// read r.outputs unsynchronised) tripped the race detector reliably
	// in TestPattern002_BranchingParallelSignatures — and could in
	// principle return a half-written upstream output map under load.
	r.mu.Lock()
	defer r.mu.Unlock()
	// execute_component: return the user's manual inputs verbatim for
	// the named target. Skips edge resolution entirely so a fresh-dragged
	// node with no Entry→target wiring still receives the typed values.
	// `Code.__call__()` missing-positional-arg errors traced back here.
	if id == r.manualInputsTarget && r.manualInputs != nil {
		copied := make(map[string]any, len(r.manualInputs))
		for k, v := range r.manualInputs {
			copied[k] = v
		}
		return copied
	}
	edges := r.edgesByTarget[id]
	for _, e := range edges {
		parentOut, ok := r.outputs[e.Source]
		if !ok {
			continue
		}
		srcKey := stripHandlePrefix(e.SourceHandle, "outputs.")
		tgtKey := stripHandlePrefix(e.TargetHandle, "inputs.")
		switch {
		case srcKey != "" && tgtKey != "":
			if v, exists := parentOut[srcKey]; exists {
				out[tgtKey] = v
			}
		case srcKey != "":
			if v, exists := parentOut[srcKey]; exists {
				out[srcKey] = v
			}
		case tgtKey != "":
			// No source key — bind all parent outputs under the target.
			out[tgtKey] = parentOut
		default:
			// Control-flow edge with no handles: merge everything.
			for k, v := range parentOut {
				out[k] = v
			}
		}
	}
	return out
}

// stripHandlePrefix removes a leading "outputs." or "inputs." from a
// Studio edge handle. Returns the bare key. Empty input → empty output
// (signals "no handle on this edge").
func stripHandlePrefix(handle, prefix string) string {
	if handle == "" {
		return ""
	}
	if strings.HasPrefix(handle, prefix) {
		return handle[len(prefix):]
	}
	return handle
}

func finalize(state *runState, traceID string, started time.Time, ctxErr error) *ExecuteResult {
	res := &ExecuteResult{
		TraceID:    traceID,
		Nodes:      state.states,
		TotalCost:  state.totalCost,
		DurationMS: time.Since(started).Milliseconds(),
	}
	if ctxErr != nil {
		res.Status = "error"
		res.Error = &NodeError{Type: "context_cancelled", Message: ctxErr.Error()}
		return res
	}
	if state.firstError != nil {
		res.Status = "error"
		res.Error = state.firstError
		return res
	}
	res.Status = "success"
	if state.endNodeID != "" {
		if outs, ok := state.outputs[state.endNodeID]; ok {
			res.Result = outs
		}
	}
	if res.Result == nil {
		res.Result = map[string]any{}
	}
	return res
}

// paramString reads a string parameter by identifier. Returns "" if
// missing or not a string.
func paramString(params []dsl.Field, name string) string {
	for _, p := range params {
		if p.Identifier != name {
			continue
		}
		if len(p.Value) == 0 {
			return ""
		}
		var s string
		if err := jsonUnmarshalRaw(p.Value, &s); err == nil {
			return s
		}
	}
	return ""
}

// paramInt reads a parameter as int. Accepts both raw JSON numbers
// (`30000`) and string-encoded numbers (`"30000"`) — Studio's DSL
// fixtures sometimes emit `type: "str"` for what should be `type:
// "int"` (e.g. timeout_ms in useAgentPickerFlow.ts), and a strict
// number-only unmarshal would silently drop those. Returns 0 only when
// the field is genuinely missing or unparseable.
func paramInt(params []dsl.Field, name string) int {
	for _, p := range params {
		if p.Identifier != name {
			continue
		}
		var i int
		if err := jsonUnmarshalRaw(p.Value, &i); err == nil {
			return i
		}
		var s string
		if err := jsonUnmarshalRaw(p.Value, &s); err == nil {
			if n, err := strconv.Atoi(strings.TrimSpace(s)); err == nil {
				return n
			}
		}
	}
	return 0
}

// paramAnyMap reads a parameter as map[string]any. Unlike paramStringMap,
// the values can be any JSON-decodable type — useful for evaluator
// settings like {"threshold": 0.8, "model": "openai/gpt-5-mini"}.
func paramAnyMap(params []dsl.Field, name string) map[string]any {
	for _, p := range params {
		if p.Identifier != name {
			continue
		}
		var m map[string]any
		if err := jsonUnmarshalRaw(p.Value, &m); err == nil {
			return m
		}
	}
	return nil
}

func paramStringMap(params []dsl.Field, name string) map[string]string {
	for _, p := range params {
		if p.Identifier != name {
			continue
		}
		var m map[string]string
		if err := jsonUnmarshalRaw(p.Value, &m); err == nil {
			return m
		}
	}
	return nil
}

func paramAuth(params []dsl.Field) *httpblock.Auth {
	for _, p := range params {
		if p.Identifier != "auth" {
			continue
		}
		var raw struct {
			Type     string `json:"type"`
			Token    string `json:"token"`
			Header   string `json:"header"`
			Value    string `json:"value"`
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := jsonUnmarshalRaw(p.Value, &raw); err != nil {
			return nil
		}
		if raw.Type == "" {
			return nil
		}
		return &httpblock.Auth{
			Type:     raw.Type,
			Token:    raw.Token,
			Header:   raw.Header,
			Value:    raw.Value,
			Username: raw.Username,
			Password: raw.Password,
		}
	}
	return nil
}

func paramLLMConfig(params []dsl.Field) *dsl.LLMConfig {
	for _, p := range params {
		if p.Identifier != "llm" || p.Type != dsl.FieldTypeLLM {
			continue
		}
		var c dsl.LLMConfig
		if err := jsonUnmarshalRaw(p.Value, &c); err != nil {
			return nil
		}
		return &c
	}
	return nil
}

// resolveLLMConfig returns the effective LLM config for a signature
// node, falling back to workflow.DefaultLLM when the node-level
// `llm` parameter is missing, null, or carries no model. Mirrors
// langwatch_nlp's `has_llm_node_using_default_llm` (regression
// 6d3d8a823) — a workflow with a signature node relying on
// default_llm pre-fix had its default_llm blanked before dispatch
// because the previous `node.type == "llm"` check never matched
// (signature nodes carry an `llm` parameter, not a node of type
// "llm"). Without this fallback, dispatch would emit an empty model
// and the gateway would 400.
func resolveLLMConfig(node *dsl.Node, w *dsl.Workflow) *dsl.LLMConfig {
	if cfg := paramLLMConfig(node.Data.Parameters); cfg != nil &&
		cfg.Model != nil && *cfg.Model != "" {
		return cfg
	}
	if w != nil {
		return w.DefaultLLM
	}
	return nil
}

func outputNames(fields []dsl.Field) []string {
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		out = append(out, f.Identifier)
	}
	return out
}

// splitModel splits "openai/gpt-5-mini" into ("gpt-5-mini", "openai").
// When no slash is present, the model is returned with empty provider
// (the translator chooses a default).
func splitModel(s string) (model, provider string) {
	idx := strings.IndexByte(s, '/')
	if idx < 0 {
		return s, ""
	}
	return s[idx+1:], s[:idx]
}

// buildMessages constructs the OpenAI-style chat history for a
// signature node. Strategy: if the inputs include a "chat_messages"
// list use it verbatim; else fold each scalar input into a single
// user-role message so simple text-in/text-out signatures work
// without explicit chat structure.
//
// Multi-turn preservation contract (contract.md §10, regression
// cb76144a6): chat_messages must round-trip through JSON without
// losing role / content / tool_calls. A node receiving chat_messages
// from an upstream node sees them via state.recordOutputs +
// state.resolveInputs, where they are []any of map[string]any after
// going through json.Unmarshal — NOT the in-memory []app.ChatMessage
// type. We accept both shapes; the legacy `messages` key is also
// accepted for callers that pre-populate explicit history.
func buildMessages(node *dsl.Node, inputs map[string]any) []app.ChatMessage {
	if msgs := coerceChatMessages(inputs["chat_messages"]); msgs != nil {
		return msgs
	}
	if msgs := coerceChatMessages(inputs["messages"]); msgs != nil {
		return msgs
	}
	if instr := paramString(node.Data.Parameters, "instructions"); instr != "" {
		// Render Liquid-subset placeholders against the upstream
		// inputs so {{ var }} / {{ x.y }} / {{ x[0] }} in the system
		// prompt resolve like they do on the Python path. Unresolved
		// keys come back as warnings — non-fatal here, the engine
		// still emits the partially-rendered string. Full Liquid
		// (loops, ifs, filters) intentionally not supported yet:
		// see specs/nlp-go/llm-block.feature.
		rendered, _ := template.Render(instr, inputs)
		return []app.ChatMessage{
			{Role: "system", Content: rendered},
			{Role: "user", Content: composeUserPrompt(inputs)},
		}
	}
	return []app.ChatMessage{{Role: "user", Content: composeUserPrompt(inputs)}}
}

// coerceChatMessages accepts the three shapes a chat-history value can
// arrive in and returns it as []app.ChatMessage. Returns nil when the
// value is anything else (so the caller can fall through to the next
// branch).
//
// Shape 1: []app.ChatMessage — literal Go value, used by in-process
// callers (mostly tests).
//
// Shape 2: []any of map[string]any — JSON-unmarshalled form. tool_calls
// arrive as []any of map[string]any too; we preserve them verbatim on
// the message struct's ToolCalls field so the gateway sees the same
// structured tool-call list the upstream model emitted.
//
// Shape 3: string of a JSON-encoded list — the TS adapter
// (resolve-field-mappings.ts:71) JSON-stringifies any non-string field
// value before crossing into the NLP service. A signature node
// declared with a `str`-typed `messages` input therefore receives the
// chat history as `"[{\"role\":...}]"`. Pre-fix the string was
// formatted as a single user-turn JSON blob and multi-turn context
// was silently lost — see Python regression cb76144a6 (the same shape
// issue _coerce_for_liquid covers on the Python side). The string is
// only treated as chat history when every parsed element looks like a
// {role, ...} message; non-history JSON strings (numeric arrays,
// non-message objects, etc.) fall through untouched.
func coerceChatMessages(v any) []app.ChatMessage {
	switch x := v.(type) {
	case []app.ChatMessage:
		return x
	case []any:
		return coerceChatMessageList(x)
	case string:
		stripped := strings.TrimLeft(x, " \t\r\n")
		if !strings.HasPrefix(stripped, "[") {
			return nil
		}
		var parsed []any
		if err := json.Unmarshal([]byte(x), &parsed); err != nil {
			return nil
		}
		// Only treat the parsed list as a chat history when every entry
		// is a map carrying a "role" key. Avoids false positives like
		// `[1,2,3]` or `[{"name":"item"}]` being mistaken for messages.
		for _, e := range parsed {
			m, ok := e.(map[string]any)
			if !ok {
				return nil
			}
			if _, hasRole := m["role"].(string); !hasRole {
				return nil
			}
		}
		return coerceChatMessageList(parsed)
	}
	return nil
}

// coerceChatMessageList builds the typed chat-message slice from a
// JSON-unmarshalled []any. Shared between the direct-list path
// (shape 2) and the JSON-string path (shape 3) so the two stay in
// lockstep.
func coerceChatMessageList(x []any) []app.ChatMessage {
	if len(x) == 0 {
		return nil
	}
	out := make([]app.ChatMessage, 0, len(x))
	for _, m := range x {
		mm, ok := m.(map[string]any)
		if !ok {
			continue
		}
		role, _ := mm["role"].(string)
		msg := app.ChatMessage{Role: role, Content: mm["content"]}
		if name, ok := mm["name"].(string); ok {
			msg.Name = name
		}
		if tcid, ok := mm["tool_call_id"].(string); ok {
			msg.ToolCallID = tcid
		}
		if rawTC, ok := mm["tool_calls"].([]any); ok && len(rawTC) > 0 {
			msg.ToolCalls = coerceToolCalls(rawTC)
		}
		out = append(out, msg)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// coerceToolCalls converts the JSON-unmarshalled []any slice into a
// typed []app.ToolCall, preserving the function name + raw arguments
// JSON. The arguments map is kept as-is so the gateway sees the same
// bytes the upstream model emitted (canonical JSON, no re-encoding).
func coerceToolCalls(raw []any) []app.ToolCall {
	out := make([]app.ToolCall, 0, len(raw))
	for _, r := range raw {
		rm, ok := r.(map[string]any)
		if !ok {
			continue
		}
		tc := app.ToolCall{}
		if id, ok := rm["id"].(string); ok {
			tc.ID = id
		}
		if typ, ok := rm["type"].(string); ok {
			tc.Type = typ
		}
		if fn, ok := rm["function"].(map[string]any); ok {
			tc.Function = fn
		}
		out = append(out, tc)
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func composeUserPrompt(inputs map[string]any) string {
	if s, ok := inputs["question"].(string); ok {
		return s
	}
	if s, ok := inputs["prompt"].(string); ok {
		return s
	}
	if s, ok := inputs["input"].(string); ok {
		return s
	}
	// Fallback: render the inputs map as JSON-ish text so the LLM at
	// least sees something. Caller can override by setting "instructions".
	// Sort keys so the same input map produces the same prompt every
	// run — Go map iteration is randomized and a non-deterministic
	// system prompt breaks both replay and provider response caching.
	keys := make([]string, 0, len(inputs))
	for k := range inputs {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var b strings.Builder
	for _, k := range keys {
		fmt.Fprintf(&b, "%s: %v\n", k, inputs[k])
	}
	return strings.TrimSpace(b.String())
}

func jsonUnmarshalRaw(raw []byte, v any) error {
	if len(raw) == 0 {
		return errors.New("empty raw value")
	}
	return jsonUnmarshalCompat(raw, v)
}

type noopLogger struct{}

func (noopLogger) Info(string, ...any)  {}
func (noopLogger) Warn(string, ...any)  {}
func (noopLogger) Error(string, ...any) {}
