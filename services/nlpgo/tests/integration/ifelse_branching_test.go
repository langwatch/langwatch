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
