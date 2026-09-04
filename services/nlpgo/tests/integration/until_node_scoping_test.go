package integration_test

import (
	"os/exec"
	"sort"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// untilNodeWorkflow is a branch and a chain around one target node, so
// "run until double" has something to trim in both directions:
//
//	entry ─┬─▶ double ──▶ square ──▶ end
//	       └─▶ side
//
// Scoped to `double`, the plan should keep entry and double and drop
// square (downstream), side (a sibling branch that does not feed it)
// and end (downstream).
const untilNodeWorkflow = `
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{
	        "outputs":[{"identifier":"a","type":"int"}],
	        "dataset":{"inline":{"records":{"a":[3]}}},
	        "entry_selection":0,
	        "train_size":1.0,"test_size":0.0,"seed":1
	      }},
	      {"id":"double","type":"code","data":{
	        "parameters":[
	          {"identifier":"code","type":"code","value":"def execute(a):\n    return {'out': a * 2}\n"}
	        ],
	        "inputs":[{"identifier":"a","type":"int"}],
	        "outputs":[{"identifier":"out","type":"int"}]
	      }},
	      {"id":"side","type":"code","data":{
	        "parameters":[
	          {"identifier":"code","type":"code","value":"def execute(a):\n    return {'out': a + 100}\n"}
	        ],
	        "inputs":[{"identifier":"a","type":"int"}],
	        "outputs":[{"identifier":"out","type":"int"}]
	      }},
	      {"id":"square","type":"code","data":{
	        "parameters":[
	          {"identifier":"code","type":"code","value":"def execute(x):\n    return {'out': x * x}\n"}
	        ],
	        "inputs":[{"identifier":"x","type":"int"}],
	        "outputs":[{"identifier":"out","type":"int"}]
	      }},
	      {"id":"end","type":"end","data":{
	        "inputs":[{"identifier":"out","type":"int"}]
	      }}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"outputs.a","target":"double","targetHandle":"inputs.a","type":"default"},
	      {"id":"e2","source":"entry","sourceHandle":"outputs.a","target":"side","targetHandle":"inputs.a","type":"default"},
	      {"id":"e3","source":"double","sourceHandle":"outputs.out","target":"square","targetHandle":"inputs.x","type":"default"},
	      {"id":"e4","source":"square","sourceHandle":"outputs.out","target":"end","targetHandle":"inputs.out","type":"default"}
	    ],
	    "state":{}
	  }`

func sortedKeys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// TestSync_UntilNodeIDTrimsDownstreamAndSiblings drives Studio's "Run
// until here" gesture through /go/studio/execute_sync.
//
// Both runs are asserted, and that is what makes the test bite. An
// executor that silently drops `until_node_id` still satisfies the
// scoped run's positive assertions, because entry and double execute
// either way; only the absence of square, side and end separates them.
// The integration harness used to be a hand copy of the real executor
// that did exactly that, so no test at this surface could fail on it.
//
// This also covers the planner's until-node exemption at the API
// surface for the first time: a trimmed plan has no End node, and a
// run without one is otherwise an error.
func TestSync_UntilNodeIDTrimsDownstreamAndSiblings(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not installed")
	}
	stack := setupStack(t)
	defer stack.close()

	unscoped := postSync(t, stack, `{`+untilNodeWorkflow+`}`)
	require.Equal(t, "success", unscoped.Status, "engine error: %+v", unscoped.Error)
	assert.Equal(t,
		[]string{"double", "end", "entry", "side", "square"},
		sortedKeys(unscoped.Nodes),
		"without until_node_id every node should run")
	// Asserted on this workflow rather than a faster one: it shells out
	// to python3 per code node, so the run is comfortably over a
	// millisecond. A sub-millisecond workflow truncates to 0 and the
	// assertion would be flaky rather than meaningful.
	assert.Positive(t, unscoped.DurationMS, "duration_ms should reach the caller")

	scoped := postSync(t, stack, `{"until_node_id":"double",`+untilNodeWorkflow+`}`)
	require.Equal(t, "success", scoped.Status, "engine error: %+v", scoped.Error)
	assert.Equal(t,
		[]string{"double", "entry"},
		sortedKeys(scoped.Nodes),
		"until_node_id=double should trim square (downstream), side (sibling) and end")
}

// TestStream_UntilNodeIDTrimsDownstreamAndSiblings is the streaming
// half. Studio's per-node Play button runs over /go/studio/execute, so
// the sync test alone leaves the path the gesture actually takes
// uncovered: dropping `until_node_id` from the streaming translation
// only was invisible to the whole suite.
func TestStream_UntilNodeIDTrimsDownstreamAndSiblings(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not installed")
	}
	stack := setupStack(t)
	defer stack.close()

	ranNodes := func(body string) []string {
		resp := postStreamURL(t, stack.url, body, nil)
		defer resp.Body.Close()
		frames := readSSE(t, resp.Body, func(f streamFrame) bool { return f.Event == "done" })
		seen := map[string]any{}
		for _, f := range frames {
			if f.Event != "component_state_change" {
				continue
			}
			if id, ok := f.Data["component_id"].(string); ok {
				seen[id] = struct{}{}
			}
		}
		return sortedKeys(seen)
	}

	assert.Equal(t,
		[]string{"double", "end", "entry", "side", "square"},
		ranNodes(`{`+untilNodeWorkflow+`}`),
		"without until_node_id every node should report state")
	assert.Equal(t,
		[]string{"double", "entry"},
		ranNodes(`{"until_node_id":"double",`+untilNodeWorkflow+`}`),
		"until_node_id=double should trim square (downstream), side (sibling) and end")
}

// TestStream_InvalidWorkflowErrorNamesItself pins the error frame the
// streaming translation emits when the workflow will not parse.
//
// The prefix is the whole point: on the streaming path the frame
// carries a bare message with no error type beside it, so without
// "invalid_workflow: " a parse failure and an engine failure read
// identically to the Studio reducer. The deleted harness copy emitted
// the bare form, which is why no test noticed the difference.
func TestStream_InvalidWorkflowErrorNamesItself(t *testing.T) {
	stack := setupStack(t)
	defer stack.close()

	resp := postStreamURL(t, stack.url, `{"workflow": {"spec_version":"1.3","nodes":"not-an-array"}}`, nil)
	defer resp.Body.Close()

	frames := readSSE(t, resp.Body, func(f streamFrame) bool { return f.Event == "error" })
	require.NotEmpty(t, frames)
	last := frames[len(frames)-1]
	require.Equal(t, "error", last.Event)
	msg, _ := last.Data["message"].(string)
	assert.Contains(t, msg, "invalid_workflow: ",
		"a parse failure should name itself, not arrive as a bare message")
}
