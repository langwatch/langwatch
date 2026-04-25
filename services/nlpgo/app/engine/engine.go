// Package engine orchestrates a workflow execution: it takes a parsed
// Workflow, plans the DAG, and dispatches each node to the right block
// executor with the resolved upstream inputs. Layers run sequentially;
// nodes within a layer run concurrently (one goroutine each).
//
// See _shared/contract.md §6 + specs/nlp-go/engine.feature.
package engine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/dataset"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/planner"
)

// Engine wires the per-block executors together. It's the unit the
// HTTP handler invokes per /go/studio/execute_sync request.
type Engine struct {
	http  *httpblock.Executor
	code  *codeblock.Executor
	llm   app.LLMClient
	logger Logger
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
	HTTP   *httpblock.Executor
	Code   *codeblock.Executor
	LLM    app.LLMClient
	Logger Logger
}

// New builds an Engine.
func New(opts Options) *Engine {
	if opts.Logger == nil {
		opts.Logger = noopLogger{}
	}
	return &Engine{
		http:   opts.HTTP,
		code:   opts.Code,
		llm:    opts.LLM,
		logger: opts.Logger,
	}
}

// ExecuteRequest is what the handler hands to the engine per call.
type ExecuteRequest struct {
	Workflow *dsl.Workflow
	// Inputs, if non-nil, provide entry-node outputs explicitly and
	// bypass dataset materialization. For dataset-driven runs leave
	// nil and the engine reads workflow.nodes[entry].dataset.inline.
	Inputs    map[string]any
	Origin    string
	TraceID   string
	ProjectID string
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
	}
	plan, err := planner.New(req.Workflow)
	if err != nil {
		return nil, err
	}
	state := newRunState(req.Workflow)
	started := time.Now()
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
			started := time.Now()
			outputs, derr := e.dispatch(ctx, req, node, inputs, ns)
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
		return e.runSignature(ctx, node, inputs)
	case dsl.ComponentPromptingTechnique:
		// Decorator: produces no outputs of its own; signature nodes
		// reference it via a parameter and apply it at LLM-call time.
		return map[string]any{}, nil
	default:
		return nil, &NodeError{Type: "unsupported_node_kind", Message: "node kind not supported on Go engine: " + string(node.Type)}
	}
}

func (e *Engine) runEntry(node *dsl.Node, req ExecuteRequest) (map[string]any, *NodeError) {
	if req.Inputs != nil {
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

func (e *Engine) runSignature(ctx context.Context, node *dsl.Node, inputs map[string]any) (map[string]any, *NodeError) {
	if e.llm == nil {
		return nil, &NodeError{Type: "llm_executor_unavailable", Message: "LLM executor not yet wired"}
	}
	llmCfg := paramLLMConfig(node.Data.Parameters)
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
	resp, err := e.llm.Execute(ctx, req)
	if err != nil {
		return nil, &NodeError{Type: "llm_error", Message: err.Error()}
	}
	out := make(map[string]any, len(outputNames(node.Data.Outputs)))
	for _, name := range outputNames(node.Data.Outputs) {
		out[name] = resp.Content
	}
	return out, nil
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
}

func newRunState(w *dsl.Workflow) *runState {
	r := &runState{
		nodes:   make(map[string]*dsl.Node, len(w.Nodes)),
		outputs: make(map[string]map[string]any, len(w.Nodes)),
		states:  make(map[string]*NodeState, len(w.Nodes)),
	}
	for i := range w.Nodes {
		n := &w.Nodes[i]
		r.nodes[n.ID] = n
		if n.Type == dsl.ComponentEnd && r.endNodeID == "" {
			r.endNodeID = n.ID
		}
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

// resolveInputs walks parents[id] and copies upstream outputs into the
// new map. The Edge's sourceHandle ("outputs.x") and targetHandle
// ("inputs.y") name the columns: this node's input "y" = source node's
// output "x". When source/target handles aren't of the form "outputs.X"
// or "inputs.X" the engine falls back to mapping by identifier (so
// short-form workflow files still work).
func (r *runState) resolveInputs(plan *planner.Plan, id string) map[string]any {
	out := map[string]any{}
	// Build a list of edges that target this node by walking the
	// workflow's edge table — planner's Parents/Children map is keyed
	// by node id, not by edge id, so we re-derive from the plan once
	// per node. Cheap enough at the scales workflows run at.
	r.mu.Lock()
	parents := plan.Parents[id]
	r.mu.Unlock()
	for _, parentID := range parents {
		parentOut, ok := r.outputs[parentID]
		if !ok {
			continue
		}
		// If we don't know the edge handles, copy all parent outputs
		// into the input map keyed by their original names. Downstream
		// nodes that need handle-specific routing will re-derive when
		// the engine learns the workflow's edge mapping (next iter).
		for k, v := range parentOut {
			out[k] = v
		}
	}
	return out
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

func paramInt(params []dsl.Field, name string) int {
	for _, p := range params {
		if p.Identifier != name {
			continue
		}
		var i int
		if err := jsonUnmarshalRaw(p.Value, &i); err == nil {
			return i
		}
	}
	return 0
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
func buildMessages(node *dsl.Node, inputs map[string]any) []app.ChatMessage {
	if msgs, ok := inputs["chat_messages"].([]app.ChatMessage); ok {
		return msgs
	}
	if raw, ok := inputs["messages"].([]any); ok {
		out := make([]app.ChatMessage, 0, len(raw))
		for _, m := range raw {
			mm, ok := m.(map[string]any)
			if !ok {
				continue
			}
			role, _ := mm["role"].(string)
			out = append(out, app.ChatMessage{Role: role, Content: mm["content"]})
		}
		return out
	}
	if instr := paramString(node.Data.Parameters, "instructions"); instr != "" {
		return []app.ChatMessage{
			{Role: "system", Content: instr},
			{Role: "user", Content: composeUserPrompt(inputs)},
		}
	}
	return []app.ChatMessage{{Role: "user", Content: composeUserPrompt(inputs)}}
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
	var b strings.Builder
	for k, v := range inputs {
		fmt.Fprintf(&b, "%s: %v\n", k, v)
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
