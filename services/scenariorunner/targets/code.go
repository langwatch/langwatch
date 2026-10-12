package targets

import (
	"context"
	"errors"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/services/scenariorunner/internal/jsjson"
)

// latestSpecVersion is the workflow DSL version the synthesized workflow
// declares (LATEST_SPEC_VERSION in the workflow contract).
const latestSpecVersion = "1.5"

const (
	entryNodeID = "entry"
	codeNodeID  = "code_agent"
	endNodeID   = "end"
)

// codeAgentTracer names the span around the engine request.
const codeAgentTracer = "langwatch.scenarios.code-agent-adapter"

// CodeAgent runs the agent's Python on the engine once per turn, through a
// synthesized entry, code, end workflow (http.serialized-code-agent.channel.ts).
type CodeAgent struct {
	config        CodeAgentData
	projectAPIKey string
	parameters    *jsjson.Object
	timeouts      NLPTimeouts
	transport     executeSyncTransport
	sessions      sessions
}

// NewCodeAgent returns the adapter.
func NewCodeAgent(config CodeAgentData, opts EngineAgentOptions) *CodeAgent {
	return &CodeAgent{
		config:        config,
		projectAPIKey: opts.ProjectAPIKey,
		parameters:    opts.Parameters,
		timeouts:      opts.Timeouts,
		transport:     newExecuteSyncTransport(opts.Transport),
	}
}

// Name implements Agent.
func (a *CodeAgent) Name() string { return "SerializedCodeAgentAdapter" }

// Call implements Agent.
func (a *CodeAgent) Call(ctx context.Context, turn Turn) (string, error) {
	inputs := a.inputValues(turn)
	workflow := a.buildWorkflow(inputs, turnParameters(ctx, a.parameters))
	output, session, err := a.execute(ctx, workflow, inputs)
	if err != nil {
		return "", err
	}
	if err := a.sessions.store(turn.ThreadID, session); err != nil {
		return "", err
	}
	return output, nil
}

func (a *CodeAgent) declaredInputs() []IO {
	if len(a.config.Inputs) > 0 {
		return a.config.Inputs
	}
	return []IO{{Identifier: "input", Type: "str"}}
}

func (a *CodeAgent) declaredOutputs() []IO {
	if len(a.config.Outputs) > 0 {
		return a.config.Outputs
	}
	return []IO{{Identifier: "output", Type: "str"}}
}

// inputValues resolves each declared input; one mapped to the session gets
// the code's own JSON value, and null on a thread's first turn.
func (a *CodeAgent) inputValues(turn Turn) *jsjson.Object {
	record := jsjson.NewObject()
	if a.config.ScenarioMappings.Len() == 0 {
		for i, in := range a.declaredInputs() {
			value := ""
			if i == 0 {
				value = lastUserText(turn)
			}
			record.Set(in.Identifier, value)
		}
		return record
	}
	held, _ := a.sessions.of(turn.ThreadID)
	resolved := resolveFieldMappings(&a.config.ScenarioMappings, turn, held)
	for _, in := range a.declaredInputs() {
		m, mapped := a.config.ScenarioMappings.Items[in.Identifier]
		if mapped && m.SourceField() == "session" {
			record.Set(in.Identifier, held)
			continue
		}
		record.Set(in.Identifier, resolved[in.Identifier])
	}
	return record
}

func ioList(ios []IO) []any {
	out := make([]any, len(ios))
	for i, io := range ios {
		out[i] = jsjson.NewObject().Set("identifier", io.Identifier).Set("type", io.Type)
	}
	return out
}

func (a *CodeAgent) buildWorkflow(values *jsjson.Object, params *jsjson.Object) *jsjson.Object {
	inputs := make([]any, 0, len(a.declaredInputs()))
	for _, in := range a.declaredInputs() {
		v, ok := values.Get(in.Identifier)
		if !ok || v == nil {
			v = ""
		}
		inputs = append(inputs, jsjson.NewObject().Set("identifier", in.Identifier).Set("type", in.Type).Set("value", v))
	}
	secrets := jsjson.NewObject()
	for _, k := range sortedKeys(a.config.Secrets) {
		secrets.Set(k, a.config.Secrets[k])
	}
	wf := jsjson.NewObject().
		Set("api_key", a.projectAPIKey).
		Set("workflow_id", "scenario-code-"+a.config.AgentID).
		Set("spec_version", latestSpecVersion).
		Set("name", "Scenario Code Execution").
		Set("icon", "🔧").
		Set("description", "Minimal workflow for scenario code agent execution").
		Set("version", "1.0").
		Set("template_adapter", "default").
		Set("secrets", secrets).
		Set("params", params)
	if a.config.SandboxAPIKey != nil && *a.config.SandboxAPIKey != "" {
		wf.Set("sandbox_api_key", *a.config.SandboxAPIKey)
	}
	return wf.
		Set("nodes", []any{a.entryNode(), a.codeNode(inputs), a.endNode()}).
		Set("edges", a.edges()).
		Set("state", jsjson.NewObject().Set("execution", jsjson.NewObject().Set("status", "idle")))
}

func position(x float64) *jsjson.Object {
	return jsjson.NewObject().Set("x", x).Set("y", 0.0)
}

func (a *CodeAgent) entryNode() *jsjson.Object {
	data := jsjson.NewObject().
		Set("name", "Entry").
		Set("outputs", ioList(a.declaredInputs())).
		Set("entry_selection", "first").
		Set("train_size", 1.0).
		Set("test_size", 1.0).
		Set("seed", 42.0).
		Set("dataset", jsjson.NewObject().Set("id", "scenario-input").Set("name", "Scenario Input").Set("inline", nil))
	return jsjson.NewObject().Set("id", entryNodeID).Set("type", "entry").Set("position", position(0)).Set("data", data)
}

func (a *CodeAgent) codeNode(inputs []any) *jsjson.Object {
	params := []any{jsjson.NewObject().Set("identifier", "code").Set("type", "code").Set("value", a.config.Code)}
	if a.config.TimeoutMs != nil {
		params = append(params, jsjson.NewObject().Set("identifier", "timeout_ms").Set("type", "int").Set("value", float64(*a.config.TimeoutMs)))
	}
	data := jsjson.NewObject().
		Set("name", "CodeAgent").
		Set("inputs", inputs).
		Set("outputs", ioList(a.declaredOutputs())).
		Set("parameters", params).
		Set("cls", "Code")
	return jsjson.NewObject().Set("id", codeNodeID).Set("type", "code").Set("position", position(200)).Set("data", data)
}

func (a *CodeAgent) endNode() *jsjson.Object {
	data := jsjson.NewObject().Set("name", "End").Set("inputs", ioList(a.declaredOutputs()))
	return jsjson.NewObject().Set("id", endNodeID).Set("type", "end").Set("position", position(400)).Set("data", data)
}

func (a *CodeAgent) edges() []any {
	var edges []any
	edge := func(source, target, field string) *jsjson.Object {
		return jsjson.NewObject().
			Set("id", source+"-"+target+"-"+field).
			Set("source", source).
			Set("sourceHandle", "outputs."+field).
			Set("target", target).
			Set("targetHandle", "inputs."+field).
			Set("type", "default")
	}
	for _, in := range a.declaredInputs() {
		edges = append(edges, edge(entryNodeID, codeNodeID, in.Identifier))
	}
	for _, out := range a.declaredOutputs() {
		edges = append(edges, edge(codeNodeID, endNodeID, out.Identifier))
	}
	return edges
}

// fetchTimeoutMs is the floor (engine ceiling plus headroom) or the agent's
// own budget plus headroom, whichever is larger, clamped to the platform max.
func (a *CodeAgent) fetchTimeoutMs() int {
	floor, ceiling := a.timeouts.floorMs(), a.timeouts.maxMs()
	if a.config.TimeoutMs == nil {
		return min(ceiling, floor)
	}
	return min(ceiling, max(floor, *a.config.TimeoutMs+nlpFetchHeadroomMs))
}

func (a *CodeAgent) knownSecrets() []string {
	out := []string{a.projectAPIKey}
	for _, k := range sortedKeys(a.config.Secrets) {
		out = append(out, a.config.Secrets[k])
	}
	return out
}

// adapterError is a classified failure with every known secret scrubbed.
func (a *CodeAgent) adapterError(message string, cause error) *Error {
	return &Error{Name: "SerializedCodeAgentAdapterError", Message: scrubKnownSecrets(message, a.knownSecrets()), Cause: cause}
}

func (a *CodeAgent) execute(ctx context.Context, workflow, inputs *jsjson.Object) (string, any, error) {
	timeoutMs := a.fetchTimeoutMs()
	ctx, span := otel.Tracer(codeAgentTracer).Start(ctx, "SerializedCodeAgentAdapter.execute_nlp_request",
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String("scenario.agent.id", a.config.AgentID),
			attribute.String("http.url", a.transport.endpoint),
			attribute.String("http.method", "POST"),
			attribute.Int("nlp.timeout_ms", timeoutMs),
		))
	defer span.End()
	output, session, err := a.request(ctx, span, engineCall{workflow: workflow, inputs: inputs, timeoutMs: timeoutMs})
	if err != nil {
		span.SetStatus(codes.Error, err.Error())
	}
	return output, session, err
}

// engineCall is one execute_flow request and its deadline.
type engineCall struct {
	workflow  *jsjson.Object
	inputs    *jsjson.Object
	timeoutMs int
}

func (a *CodeAgent) request(ctx context.Context, span trace.Span, call engineCall) (string, any, error) {
	timeoutMs := call.timeoutMs
	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	resp, err := a.transport.post(ctx, jsjson.Stringify(executeFlowEvent(call.workflow, call.inputs)), time.Duration(timeoutMs)*time.Millisecond)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			span.SetAttributes(attribute.String("error.kind", "timeout"))
			return "", nil, a.adapterError(formatFetchError(err, timeoutMs), nil)
		}
		span.SetAttributes(attribute.String("error.kind", "fetch"))
		return "", nil, a.adapterError(formatFetchError(err, 0), nil)
	}
	span.SetAttributes(attribute.Int("http.status_code", resp.status))
	if !resp.ok {
		span.SetAttributes(attribute.String("error.kind", "http"))
		return "", nil, a.adapterError(formatHTTPError(resp.status, resp.body).message, nil)
	}
	return a.readResult(span, resp)
}

func (a *CodeAgent) readResult(span trace.Span, resp syncResponse) (string, any, error) {
	parsed, err := jsjson.Parse([]byte(resp.body))
	result, isObj := parsed.(*jsjson.Object)
	if err != nil || !isObj {
		span.SetAttributes(attribute.String("error.kind", "parse"))
		return "", nil, a.adapterError(formatMalformedBodyError(resp.status, resp.body).message, err)
	}
	status, _ := result.Get("status")
	statusText, _ := status.(string)
	if statusText == "" {
		statusText = "unknown"
	}
	span.SetAttributes(attribute.String("nlp.status", statusText))
	if traceID, ok := result.Get("trace_id"); ok {
		if s, isString := traceID.(string); isString && s != "" {
			span.SetAttributes(attribute.String("nlp.trace_id", s))
		}
	}
	if statusText == "error" {
		span.SetAttributes(attribute.String("error.kind", "execution"))
		return "", nil, a.adapterError(formatEngineError(engineErrorOf(result)).message, nil)
	}
	value, _ := result.Get("result")
	output, err := extractOutput(outputSpec{result: value, field: a.config.ScenarioOutputField, outputs: a.config.Outputs})
	if err != nil {
		span.SetAttributes(attribute.String("error.kind", "output"))
		return "", nil, a.adapterError(err.Error(), err)
	}
	return output, codeNodeSession(result), nil
}

func engineErrorOf(result *jsjson.Object) *engineError {
	raw, ok := result.Get("error")
	obj, isObj := raw.(*jsjson.Object)
	if !ok || !isObj {
		return nil
	}
	str := func(key string) *string {
		v, has := obj.Get(key)
		s, isString := v.(string)
		if !has || !isString {
			return nil
		}
		return &s
	}
	return &engineError{NodeID: str("node_id"), Type: str("type"), Message: str("message"), Traceback: str("traceback")}
}

// codeNodeSession is the `session` the code returned beside its outputs, read
// from the code node's own state, or Absent.
func codeNodeSession(result *jsjson.Object) any {
	nodes, _ := result.Get("nodes")
	nodesObj, _ := nodes.(*jsjson.Object)
	node, _ := nodesObj.Get(codeNodeID)
	nodeObj, _ := node.(*jsjson.Object)
	outputs, _ := nodeObj.Get("outputs")
	outputsObj, ok := outputs.(*jsjson.Object)
	if !ok {
		return Absent
	}
	if session, has := outputsObj.Get("session"); has {
		return session
	}
	return Absent
}
