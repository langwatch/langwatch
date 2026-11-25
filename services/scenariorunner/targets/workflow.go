package targets

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

// WorkflowAgent runs a published workflow on the engine once per turn
// (http.serialized-workflow-agent.channel.ts).
type WorkflowAgent struct {
	config        WorkflowAgentData
	projectAPIKey string
	parameters    *jsjson.Object
	timeouts      NLPTimeouts
	transport     executeSyncTransport
}

// EngineAgentOptions build a workflow or code agent.
type EngineAgentOptions struct {
	ProjectAPIKey string
	Parameters    *jsjson.Object
	Timeouts      NLPTimeouts
	Transport     TransportInput
}

// NewWorkflowAgent returns the adapter.
func NewWorkflowAgent(config WorkflowAgentData, opts EngineAgentOptions) *WorkflowAgent {
	return &WorkflowAgent{
		config:        config,
		projectAPIKey: opts.ProjectAPIKey,
		parameters:    opts.Parameters,
		timeouts:      opts.Timeouts,
		transport:     newExecuteSyncTransport(opts.Transport),
	}
}

// Name implements Agent.
func (a *WorkflowAgent) Name() string { return "SerializedWorkflowAgentAdapter" }

// Call implements Agent.
func (a *WorkflowAgent) Call(ctx context.Context, turn Turn) (string, error) {
	inputs := a.inputValues(turn)
	result, err := a.execute(ctx, inputs, turnParameters(ctx, a.parameters))
	if err != nil {
		return "", err
	}
	return extractOutput(outputSpec{result: result, field: a.config.ScenarioOutputField, outputs: a.config.Outputs})
}

// inputValues are the run's parameters as entry inputs (as text), with each
// declared input laid over them, so a parameter named `input` never replaces
// the turn the target is meant to answer.
func (a *WorkflowAgent) inputValues(turn Turn) *jsjson.Object {
	record := jsjson.NewObject()
	if a.parameters != nil {
		for _, k := range a.parameters.Keys() {
			v, _ := a.parameters.Get(k)
			record.Set(k, jsString(v))
		}
	}
	declared := a.config.Inputs
	if len(declared) == 0 {
		declared = []IO{{Identifier: "input", Type: "str"}}
	}
	if a.config.ScenarioMappings.Len() > 0 {
		resolved := resolveFieldMappings(&a.config.ScenarioMappings, turn, nil)
		for _, in := range declared {
			record.Set(in.Identifier, resolved[in.Identifier])
		}
		return record
	}
	for i, in := range declared {
		value := ""
		if i == 0 {
			value = lastUserText(turn)
		}
		record.Set(in.Identifier, value)
	}
	return record
}

func (a *WorkflowAgent) execute(ctx context.Context, inputs *jsjson.Object, params *jsjson.Object) (any, error) {
	workflow := cloneObject(a.config.Workflow)
	secrets := jsjson.NewObject()
	if existing, ok := workflow.Get("secrets"); ok {
		if obj, isObj := existing.(*jsjson.Object); isObj {
			secrets = cloneObject(obj)
		}
	}
	for _, k := range sortedKeys(a.config.Secrets) {
		secrets.Set(k, a.config.Secrets[k])
	}
	workflow.Set("api_key", a.projectAPIKey).Set("secrets", secrets).Set("params", params)
	event := executeFlowEvent(workflow, inputs)

	timeout := time.Duration(min(a.timeouts.maxMs(), a.timeouts.floorMs())) * time.Millisecond
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	resp, err := a.transport.post(ctx, jsjson.Stringify(event), timeout)
	if err != nil {
		return nil, newError(fmt.Sprintf("Workflow execution failed: fetch to %s failed - %s", a.transport.endpoint, err.Error()))
	}
	if !resp.ok {
		return nil, newError(fmt.Sprintf("Workflow execution failed: HTTP %d%s", resp.status, workflowErrorDetail(resp.body)))
	}
	parsed, err := jsjson.Parse([]byte(resp.body))
	if err != nil {
		return nil, &Error{Name: "SyntaxError", Message: err.Error()}
	}
	obj, _ := parsed.(*jsjson.Object)
	result, _ := obj.Get("result")
	return result, nil
}

func workflowErrorDetail(body string) string {
	detail := body
	if parsed, err := jsjson.Parse([]byte(body)); err == nil {
		if obj, ok := parsed.(*jsjson.Object); ok {
			if d, ok := obj.Get("detail"); ok && d != nil {
				detail = jsString(d)
			}
		}
	}
	if detail == "" {
		return ""
	}
	return " - " + detail
}

// executeFlowEvent is the engine's execute_flow event for one turn.
func executeFlowEvent(workflow *jsjson.Object, inputs *jsjson.Object) *jsjson.Object {
	payload := jsjson.NewObject().
		Set("trace_id", randomTraceID()).
		Set("workflow", workflow).
		Set("inputs", []any{inputs}).
		Set("manual_execution_mode", false).
		Set("do_not_trace", true).
		Set("run_evaluations", false)
	return jsjson.NewObject().Set("type", "execute_flow").Set("payload", payload)
}

func randomTraceID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

// turnParameters are the run's values plus this turn's trace context, which
// win over a parameter of the same name.
func turnParameters(ctx context.Context, parameters *jsjson.Object) *jsjson.Object {
	out := cloneObject(parameters)
	tc := traceContextOf(ctx)
	if tc.TraceID != "" {
		out.Set("trace_id", tc.TraceID)
	}
	if tc.Traceparent != "" {
		out.Set("traceparent", tc.Traceparent)
	}
	return out
}

func cloneObject(o *jsjson.Object) *jsjson.Object {
	out := jsjson.NewObject()
	if o == nil {
		return out
	}
	for _, k := range o.Keys() {
		v, _ := o.Get(k)
		out.Set(k, v)
	}
	return out
}

// jsString is `String(value)` for a decoded JSON scalar.
func jsString(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case nil:
		return "null"
	case bool, float64:
		return jsjson.Stringify(t)
	case *jsjson.Object:
		return "[object Object]"
	case []any:
		parts := make([]string, len(t))
		for i, e := range t {
			if e != nil {
				parts[i] = jsString(e)
			}
		}
		return strings.Join(parts, ",")
	}
	return jsjson.Stringify(v)
}

// outputSpec is what extractOutput reads.
type outputSpec struct {
	result  any
	field   *string
	outputs []IO
}

// extractOutput picks the reply out of the end node's result: the named
// scenario output field, else the first declared output, else the first value.
func extractOutput(spec outputSpec) (string, error) {
	if !truthy(spec.result) {
		return "", nil
	}
	if s, ok := spec.result.(string); ok {
		return s, nil
	}
	obj, ok := spec.result.(*jsjson.Object)
	if !ok {
		return jsjson.ToText(spec.result), nil
	}
	if spec.field != nil && *spec.field != "" {
		if v, has := obj.Get(*spec.field); has {
			return jsjson.ToText(v), nil
		}
		return "", newError("Scenario output field \"" + *spec.field + "\" not found in agent output. Available fields: " +
			strings.Join(obj.Keys(), ", "))
	}
	first := "output"
	if len(spec.outputs) > 0 {
		first = spec.outputs[0].Identifier
	}
	if v, has := obj.Get(first); has {
		return jsjson.ToText(v), nil
	}
	if keys := obj.Keys(); len(keys) > 0 {
		v, _ := obj.Get(keys[0])
		return jsjson.ToText(v), nil
	}
	return jsjson.ToText(obj), nil
}
