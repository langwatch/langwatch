package integration_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// ifElseWorkflowBody builds the canonical gated-evaluator shape from the
// customer ask: faithfulness-style work should only run when a tool
// produced context. entry → gate(if_else, condition `context != ""`) →
// true branch: code node A (+ a chained code node A2 to prove cascade);
// false branch: code node B. Both branches merge into end.
//
//	entry ──ctx──► gate ──true──► codeA ──► codeA2 ──► end.result
//	  │              └───false──► codeB ─────────────► end.fallback
//	  └────ctx────────────────────► codeA (data edge)
func ifElseWorkflowBody(contextValue string) string {
	return `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-ifelse",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"sk-pattern-ifelse","spec_version":"1.3",
	      "name":"PatternIfElse","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"context","type":"str"}],
	          "dataset":{"inline":{"records":{
	            "context":["` + contextValue + `"]
	          },"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"gate","type":"if_else","data":{
	          "name":"If/Else",
	          "parameters":[{"identifier":"condition","type":"str","value":"context != \"\""}],
	          "inputs":[{"identifier":"context","type":"str"}],
	          "outputs":[
	            {"identifier":"true","type":"bool"},
	            {"identifier":"false","type":"bool"}
	          ]
	        }},
	        {"id":"codeA","type":"code","data":{
	          "parameters":[{"identifier":"code","type":"code","value":"def execute(context='', gate=None):\n    return {'checked': 'faithful:' + context}\n"}],
	          "inputs":[
	            {"identifier":"context","type":"str"},
	            {"identifier":"gate","type":"bool"}
	          ],
	          "outputs":[{"identifier":"checked","type":"str"}]
	        }},
	        {"id":"codeA2","type":"code","data":{
	          "parameters":[{"identifier":"code","type":"code","value":"def execute(checked=''):\n    return {'final': checked + '!'}\n"}],
	          "inputs":[{"identifier":"checked","type":"str"}],
	          "outputs":[{"identifier":"final","type":"str"}]
	        }},
	        {"id":"codeB","type":"code","data":{
	          "parameters":[{"identifier":"code","type":"code","value":"def execute(gate=None):\n    return {'fallback': 'no-context'}\n"}],
	          "inputs":[{"identifier":"gate","type":"bool"}],
	          "outputs":[{"identifier":"fallback","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{"inputs":[
	          {"identifier":"result","type":"str"},
	          {"identifier":"fallback","type":"str"}
	        ]}}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.context","target":"gate","targetHandle":"inputs.context","type":"default"},
	        {"id":"e2","source":"entry","sourceHandle":"outputs.context","target":"codeA","targetHandle":"inputs.context","type":"default"},
	        {"id":"e3","source":"gate","sourceHandle":"outputs.true","target":"codeA","targetHandle":"inputs.gate","type":"default"},
	        {"id":"e4","source":"gate","sourceHandle":"outputs.false","target":"codeB","targetHandle":"inputs.gate","type":"default"},
	        {"id":"e5","source":"codeA","sourceHandle":"outputs.checked","target":"codeA2","targetHandle":"inputs.checked","type":"default"},
	        {"id":"e6","source":"codeA2","sourceHandle":"outputs.final","target":"end","targetHandle":"inputs.result","type":"default"},
	        {"id":"e7","source":"codeB","sourceHandle":"outputs.fallback","target":"end","targetHandle":"inputs.fallback","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
}

func nodeStatus(t *testing.T, res *app.WorkflowResult, id string) string {
	t.Helper()
	node, ok := res.Nodes[id].(map[string]any)
	require.True(t, ok, "node %q missing from result: %+v", id, res.Nodes)
	status, _ := node["status"].(string)
	return status
}

/** @scenario True condition executes only the true branch */
/** @scenario Legacy branch-into-input workflows still gate correctly */
func TestPatternIfElse_TrueBranchRuns_FalseBranchSkipped(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	res := postSync(t, &stack{url: url}, ifElseWorkflowBody("tool produced this"))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	assert.Equal(t, "success", nodeStatus(t, res, "gate"))
	assert.Equal(t, "success", nodeStatus(t, res, "codeA"))
	assert.Equal(t, "success", nodeStatus(t, res, "codeA2"))
	assert.Equal(t, "skipped", nodeStatus(t, res, "codeB"),
		"false-branch node must be skipped, not executed")

	// The merge end node runs with the taken branch's value.
	assert.Equal(t, "success", nodeStatus(t, res, "end"))
	endNode := res.Nodes["end"].(map[string]any)
	outputs, _ := endNode["outputs"].(map[string]any)
	assert.Equal(t, "faithful:tool produced this!", outputs["result"])
	_, hasFallback := outputs["fallback"]
	assert.False(t, hasFallback, "skipped branch must contribute no outputs")
}

/** @scenario False condition executes only the false branch */
/** @scenario Skipping cascades to downstream-only nodes of the skipped branch */
/** @scenario A node fed by both branches runs when either branch is taken */
func TestPatternIfElse_FalseBranchRuns_TrueBranchCascadeSkipped(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	res := postSync(t, &stack{url: url}, ifElseWorkflowBody(""))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	assert.Equal(t, "success", nodeStatus(t, res, "gate"))
	assert.Equal(t, "skipped", nodeStatus(t, res, "codeA"))
	assert.Equal(t, "skipped", nodeStatus(t, res, "codeA2"),
		"skip must cascade down the not-taken branch chain")
	assert.Equal(t, "success", nodeStatus(t, res, "codeB"))

	assert.Equal(t, "success", nodeStatus(t, res, "end"),
		"merge node fed by both branches runs when either branch is taken")
	endNode := res.Nodes["end"].(map[string]any)
	outputs, _ := endNode["outputs"].(map[string]any)
	assert.Equal(t, "no-context", outputs["fallback"])
}

/** @scenario Condition errors fail the if/else node, not the whole engine */
func TestPatternIfElse_UndefinedConditionInputFailsTheGate(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	body := ifElseWorkflowBody("anything")
	// Sabotage: condition references a field the gate doesn't receive.
	sabotaged := strings.Replace(body,
		`"value":"context != \"\""`,
		`"value":"tool_called == true"`, 1)
	require.NotEqual(t, body, sabotaged, "sabotage replacement must apply")

	res := postSync(t, &stack{url: url}, sabotaged)
	require.Equal(t, "error", res.Status)

	assert.Equal(t, "error", nodeStatus(t, res, "gate"))
	gateNode := res.Nodes["gate"].(map[string]any)
	gateErr, _ := gateNode["error"].(map[string]any)
	require.NotNil(t, gateErr, "gate must carry the condition error")
	assert.Contains(t, gateErr["message"], "tool_called",
		"error must name the undefined input")
}

// pythonGateParams swaps the gate's liquid condition for a python one.
// The user code returns a plain bool; the engine adapts it to the
// sandbox runner's dict contract.
func pythonGateParams(body string, pythonCode string) string {
	return strings.Replace(body,
		`"parameters":[{"identifier":"condition","type":"str","value":"context != \"\""}]`,
		`"parameters":[
		  {"identifier":"condition_language","type":"str","value":"python"},
		  {"identifier":"code","type":"code","value":"`+pythonCode+`"}
		]`, 1)
}

/** @scenario A python condition routes the true branch */
func TestPatternIfElse_PythonConditionRoutesTrueBranch(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	body := pythonGateParams(
		ifElseWorkflowBody("tool produced this"),
		`def execute(context=''):\n    return len(context) > 0\n`,
	)
	require.Contains(t, body, "condition_language", "python swap must apply")

	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	assert.Equal(t, "success", nodeStatus(t, res, "gate"))
	assert.Equal(t, "success", nodeStatus(t, res, "codeA"))
	assert.Equal(t, "skipped", nodeStatus(t, res, "codeB"))
}

/** @scenario A python condition routes the false branch */
func TestPatternIfElse_PythonConditionRoutesFalseBranch(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	body := pythonGateParams(
		ifElseWorkflowBody(""),
		`def execute(context=''):\n    return len(context) > 0\n`,
	)

	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	assert.Equal(t, "skipped", nodeStatus(t, res, "codeA"))
	assert.Equal(t, "skipped", nodeStatus(t, res, "codeA2"))
	assert.Equal(t, "success", nodeStatus(t, res, "codeB"))
}

/** @scenario A python condition that returns a non-boolean fails the gate */
func TestPatternIfElse_PythonConditionNonBoolFailsTheGate(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	body := pythonGateParams(
		ifElseWorkflowBody("anything"),
		`def execute(context=''):\n    return 'yes'\n`,
	)

	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "error", res.Status)

	assert.Equal(t, "error", nodeStatus(t, res, "gate"))
	gateNode := res.Nodes["gate"].(map[string]any)
	gateErr, _ := gateNode["error"].(map[string]any)
	require.NotNil(t, gateErr, "gate must carry the condition error")
	assert.Contains(t, gateErr["message"], "True or False",
		"error must state the bool contract")
}

// convergeWorkflowBody builds the customer's convergence shape: an If/Else
// fork whose two branches feed the SAME end input. Only the taken branch
// runs, so the shared input deterministically carries that branch's value
// while the skipped branch contributes nothing.
//
//	entry ──ctx──► gate ──true──► codeA ─┐
//	                 └───false──► codeB ─┴──► end.answer
func convergeWorkflowBody(contextValue string) string {
	return `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-converge",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"sk-pattern-converge","spec_version":"1.3",
	      "name":"PatternConverge","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"context","type":"str"}],
	          "dataset":{"inline":{"records":{
	            "context":["` + contextValue + `"]
	          },"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"gate","type":"if_else","data":{
	          "name":"If/Else",
	          "parameters":[{"identifier":"condition","type":"str","value":"context != \"\""}],
	          "inputs":[{"identifier":"context","type":"str"}],
	          "outputs":[
	            {"identifier":"true","type":"bool"},
	            {"identifier":"false","type":"bool"}
	          ]
	        }},
	        {"id":"codeA","type":"code","data":{
	          "parameters":[{"identifier":"code","type":"code","value":"def execute(context='', gate=None):\n    return {'answer': 'A:' + context}\n"}],
	          "inputs":[
	            {"identifier":"context","type":"str"},
	            {"identifier":"gate","type":"bool"}
	          ],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"codeB","type":"code","data":{
	          "parameters":[{"identifier":"code","type":"code","value":"def execute(gate=None):\n    return {'answer': 'B:fallback'}\n"}],
	          "inputs":[{"identifier":"gate","type":"bool"}],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{"inputs":[
	          {"identifier":"answer","type":"str"}
	        ]}}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.context","target":"gate","targetHandle":"inputs.context","type":"default"},
	        {"id":"e2","source":"entry","sourceHandle":"outputs.context","target":"codeA","targetHandle":"inputs.context","type":"default"},
	        {"id":"e3","source":"gate","sourceHandle":"outputs.true","target":"codeA","targetHandle":"inputs.gate","type":"default"},
	        {"id":"e4","source":"gate","sourceHandle":"outputs.false","target":"codeB","targetHandle":"inputs.gate","type":"default"},
	        {"id":"e5","source":"codeA","sourceHandle":"outputs.answer","target":"end","targetHandle":"inputs.answer","type":"default"},
	        {"id":"e6","source":"codeB","sourceHandle":"outputs.answer","target":"end","targetHandle":"inputs.answer","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
}

func convergedAnswer(t *testing.T, res *app.WorkflowResult) any {
	t.Helper()
	endNode, ok := res.Nodes["end"].(map[string]any)
	require.True(t, ok, "end node missing: %+v", res.Nodes)
	outputs, _ := endNode["outputs"].(map[string]any)
	return outputs["answer"]
}

/** @scenario A converged input receives the value from whichever branch ran */
func TestPatternIfElse_ConvergeOnSameInput_TrueBranchValueWins(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	res := postSync(t, &stack{url: url}, convergeWorkflowBody("ctx"))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	assert.Equal(t, "success", nodeStatus(t, res, "codeA"))
	assert.Equal(t, "skipped", nodeStatus(t, res, "codeB"))
	assert.Equal(t, "success", nodeStatus(t, res, "end"),
		"the convergence node runs on the taken branch")
	assert.Equal(t, "A:ctx", convergedAnswer(t, res),
		"the shared input must carry the true branch value")
}

// autoparseIfElseBody feeds a string dataset value into a python if/else
// condition that does float arithmetic. The `amount` input is declared
// `float`, so the engine must coerce "1" -> 1.0 before the sandbox runs;
// otherwise `amount > 5` raises "'>' not supported between str and int".
func autoparseIfElseBody(amountValue string) string {
	return `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-autoparse",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"sk-pattern-autoparse","spec_version":"1.3",
	      "name":"PatternAutoparse","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"amount","type":"str"}],
	          "dataset":{"inline":{"records":{
	            "amount":["` + amountValue + `"]
	          },"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"gate","type":"if_else","data":{
	          "name":"If/Else",
	          "parameters":[
	            {"identifier":"condition_language","type":"str","value":"python"},
	            {"identifier":"code","type":"code","value":"def execute(amount: float) -> bool:\n    return amount > 5\n"}
	          ],
	          "inputs":[{"identifier":"amount","type":"float"}],
	          "outputs":[
	            {"identifier":"true","type":"bool"},
	            {"identifier":"false","type":"bool"}
	          ]
	        }}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.amount","target":"gate","targetHandle":"inputs.amount","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
}

/** @scenario A string dataset value is coerced to the declared input type */
func TestPatternIfElse_PythonConditionAutoparsesStringToFloat(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// "1" arrives as a string from the dataset; with autoparse the gate
	// evaluates 1.0 > 5 instead of erroring on a str/int comparison.
	res := postSync(t, &stack{url: url}, autoparseIfElseBody("1"))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.Equal(t, "success", nodeStatus(t, res, "gate"),
		"the gate must not error on a string-typed numeric input")
	gate := res.Nodes["gate"].(map[string]any)
	gateOut, _ := gate["outputs"].(map[string]any)
	assert.Equal(t, false, gateOut["true"], "1 > 5 must evaluate to false")

	res2 := postSync(t, &stack{url: url}, autoparseIfElseBody("9"))
	require.Equal(t, "success", res2.Status, "engine error: %+v", res2.Error)
	gate2 := res2.Nodes["gate"].(map[string]any)
	gateOut2, _ := gate2["outputs"].(map[string]any)
	assert.Equal(t, true, gateOut2["true"], "9 > 5 must evaluate to true")
}

// autoparseLiquidIfElseBody feeds a string dataset value into a Liquid
// if/else condition that does numeric comparison. The `amount` input is
// declared `float`, so the engine must coerce "6" -> 6.0 before evaluating;
// otherwise Liquid compares the string "6" against 5, treats the mismatched
// types as incomparable, and silently routes false for every value.
func autoparseLiquidIfElseBody(amountValue string) string {
	return `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-autoparse-liquid",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"sk-pattern-autoparse-liquid","spec_version":"1.3",
	      "name":"PatternAutoparseLiquid","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"amount","type":"str"}],
	          "dataset":{"inline":{"records":{
	            "amount":["` + amountValue + `"]
	          },"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"gate","type":"if_else","data":{
	          "name":"If/Else",
	          "parameters":[{"identifier":"condition","type":"str","value":"amount > 5"}],
	          "inputs":[{"identifier":"amount","type":"float"}],
	          "outputs":[
	            {"identifier":"true","type":"bool"},
	            {"identifier":"false","type":"bool"}
	          ]
	        }}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.amount","target":"gate","targetHandle":"inputs.amount","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
}

/** @scenario A liquid condition coerces a numeric-string input before comparing */
func TestPatternIfElse_LiquidConditionAutoparsesStringToFloat(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// "6" arrives as a string from the dataset; with autoparse the Liquid
	// gate evaluates 6 > 5 (true) instead of a str/int mismatch that routes
	// false for every value.
	res := postSync(t, &stack{url: url}, autoparseLiquidIfElseBody("6"))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.Equal(t, "success", nodeStatus(t, res, "gate"))
	gate := res.Nodes["gate"].(map[string]any)
	gateOut, _ := gate["outputs"].(map[string]any)
	assert.Equal(t, true, gateOut["true"], "6 > 5 must evaluate to true")

	res2 := postSync(t, &stack{url: url}, autoparseLiquidIfElseBody("4"))
	require.Equal(t, "success", res2.Status, "engine error: %+v", res2.Error)
	gate2 := res2.Nodes["gate"].(map[string]any)
	gateOut2, _ := gate2["outputs"].(map[string]any)
	assert.Equal(t, false, gateOut2["true"], "4 > 5 must evaluate to false")
}

// componentIfElseBody builds an execute_component payload: a SINGLE
// if/else gate run in isolation with a manually-typed input, exactly
// like the Studio drawer's Execute button. The `question` input is
// declared `float`, the manual value arrives as the string the input
// textarea produces, and the condition is supplied per call (liquid by
// default, or python via condition_language+code).
func componentIfElseBody(questionValue, params string) string {
	return `{
	  "type":"execute_component",
	  "payload": {
	    "trace_id":"component-ifelse",
	    "node_id":"gate",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"sk-component-ifelse","spec_version":"1.3",
	      "name":"ComponentIfElse","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"gate","type":"if_else","data":{
	          "name":"If/Else",
	          "parameters":` + params + `,
	          "inputs":[{"identifier":"question","type":"float"}],
	          "outputs":[
	            {"identifier":"true","type":"bool"},
	            {"identifier":"false","type":"bool"}
	          ]
	        }}
	      ],
	      "edges":[],
	      "state":{}
	    },
	    "inputs":{"question":"` + questionValue + `"}
	  }
	}`
}

/** @scenario A liquid condition coerces a numeric-string input before comparing */
func TestPatternIfElse_ComponentLiquidCondition_ManualInputAutoparses(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// The Studio drawer's manual Execute on a single gate: "7" typed into
	// the input panel must evaluate 7 > 5 = true, not the string "7" which
	// Liquid mismatches against 5 and routes false.
	liquidParams := `[{"identifier":"condition","type":"str","value":"question > 5"}]`

	res := postSync(t, &stack{url: url}, componentIfElseBody("7", liquidParams))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.Equal(t, "success", nodeStatus(t, res, "gate"))
	gate := res.Nodes["gate"].(map[string]any)
	gateOut, _ := gate["outputs"].(map[string]any)
	assert.Equal(t, true, gateOut["true"], "7 > 5 must evaluate to true")

	res2 := postSync(t, &stack{url: url}, componentIfElseBody("4", liquidParams))
	require.Equal(t, "success", res2.Status, "engine error: %+v", res2.Error)
	gate2 := res2.Nodes["gate"].(map[string]any)
	gateOut2, _ := gate2["outputs"].(map[string]any)
	assert.Equal(t, false, gateOut2["true"], "4 > 5 must evaluate to false")
}

/** @scenario A string dataset value is coerced to the declared input type */
func TestPatternIfElse_ComponentPythonCondition_ManualInputAutoparses(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// The same single-node Execute, but the condition is python. "7" must
	// reach execute() as a float so `question > 5` returns True instead of
	// raising on a str/int comparison.
	pythonParams := `[
	  {"identifier":"condition_language","type":"str","value":"python"},
	  {"identifier":"code","type":"code","value":"def execute(question: float) -> bool:\n    return question > 5\n"}
	]`

	res := postSync(t, &stack{url: url}, componentIfElseBody("7", pythonParams))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	assert.Equal(t, "success", nodeStatus(t, res, "gate"),
		"the gate must not error on a string-typed numeric manual input")
	gate := res.Nodes["gate"].(map[string]any)
	gateOut, _ := gate["outputs"].(map[string]any)
	assert.Equal(t, true, gateOut["true"], "7 > 5 must evaluate to true")
}

// controlFlowWorkflowBody wires the if/else branches to downstream nodes
// through CONTROL-FLOW edges (targetHandle "control", type "control"): the
// branch connects to the node itself, not to a data input. codeA has a
// strict `execute(context)` signature and a data edge feeding `context`,
// so if the control edge wrongly passed the branch boolean as an extra
// kwarg the sandbox would error — a clean run proves control flow carries
// no value. codeB takes no inputs and rides the false branch.
//
//	entry ──ctx(data)──► codeA ─┐
//	  └──ctx──► gate ══true(control)══► codeA ─┴──► end.answer
//	             └════false(control)═══► codeB ─────► end.answer
func controlFlowWorkflowBody(contextValue string) string {
	return `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"pattern-controlflow",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"sk-pattern-controlflow","spec_version":"1.3",
	      "name":"PatternControlFlow","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"context","type":"str"}],
	          "dataset":{"inline":{"records":{
	            "context":["` + contextValue + `"]
	          },"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"gate","type":"if_else","data":{
	          "name":"If/Else",
	          "parameters":[{"identifier":"condition","type":"str","value":"context != \"\""}],
	          "inputs":[{"identifier":"context","type":"str"}],
	          "outputs":[
	            {"identifier":"true","type":"bool"},
	            {"identifier":"false","type":"bool"}
	          ]
	        }},
	        {"id":"codeA","type":"code","data":{
	          "parameters":[{"identifier":"code","type":"code","value":"def execute(context):\n    return {'answer': 'A:' + context}\n"}],
	          "inputs":[{"identifier":"context","type":"str"}],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"codeB","type":"code","data":{
	          "parameters":[{"identifier":"code","type":"code","value":"def execute():\n    return {'answer': 'B:fallback'}\n"}],
	          "inputs":[],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{"inputs":[
	          {"identifier":"answer","type":"str"}
	        ]}}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.context","target":"gate","targetHandle":"inputs.context","type":"default"},
	        {"id":"e2","source":"entry","sourceHandle":"outputs.context","target":"codeA","targetHandle":"inputs.context","type":"default"},
	        {"id":"e3","source":"gate","sourceHandle":"outputs.true","target":"codeA","targetHandle":"control","type":"control"},
	        {"id":"e4","source":"gate","sourceHandle":"outputs.false","target":"codeB","targetHandle":"control","type":"control"},
	        {"id":"e5","source":"codeA","sourceHandle":"outputs.answer","target":"end","targetHandle":"inputs.answer","type":"default"},
	        {"id":"e6","source":"codeB","sourceHandle":"outputs.answer","target":"end","targetHandle":"inputs.answer","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`
}

/** @scenario Connecting a branch to a node gates it without adding an input */
/** @scenario A control-flow connection passes no value into the gated node */
func TestPatternIfElse_ControlFlowEdge_GatesAndPassesNoValue(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	res := postSync(t, &stack{url: url}, controlFlowWorkflowBody("ctx"))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	// True branch taken: codeA runs over its control edge. A success here
	// proves the control edge passed NO value — codeA's strict
	// execute(context) signature would have errored on an extra branch kwarg.
	assert.Equal(t, "success", nodeStatus(t, res, "codeA"))
	assert.Equal(t, "skipped", nodeStatus(t, res, "codeB"))
	assert.Equal(t, "success", nodeStatus(t, res, "end"))
	assert.Equal(t, "A:ctx", convergedAnswer(t, res),
		"the gated node runs and only its real data input flows through")
}

/** @scenario A node behind a not-taken branch is skipped over a control-flow edge */
func TestPatternIfElse_ControlFlowEdge_SkipsNotTakenBranch(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	res := postSync(t, &stack{url: url}, controlFlowWorkflowBody(""))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	// Condition false: the true-branch node is skipped over its control
	// edge, the false-branch node runs.
	assert.Equal(t, "skipped", nodeStatus(t, res, "codeA"))
	assert.Equal(t, "success", nodeStatus(t, res, "codeB"))
	assert.Equal(t, "B:fallback", convergedAnswer(t, res))
}

/** @scenario A converged input receives the value from whichever branch ran */
func TestPatternIfElse_ConvergeOnSameInput_FalseBranchValueWins(t *testing.T) {
	llm := &fakeLLMClient{}
	url, _ := setupPatternStack(t, llm, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	res := postSync(t, &stack{url: url}, convergeWorkflowBody(""))
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	assert.Equal(t, "skipped", nodeStatus(t, res, "codeA"))
	assert.Equal(t, "success", nodeStatus(t, res, "codeB"))
	assert.Equal(t, "success", nodeStatus(t, res, "end"))
	assert.Equal(t, "B:fallback", convergedAnswer(t, res),
		"the shared input must carry the false branch value when it is taken")
}
