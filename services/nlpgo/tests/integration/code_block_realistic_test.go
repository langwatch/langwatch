package integration_test

// Realistic code-block end-to-end tests. Code blocks let workflow
// authors run arbitrary Python; these tests post real Studio-shape
// workflows (with type: execute_flow + nested payload) through
// /go/studio/execute_sync and prove the subprocess sandbox handles
// the kinds of code customers actually write — stdlib-heavy data
// processing, network calls via urllib, hashing, JSON munging, plus
// optional third-party imports (httpx, dspy) when the runtime has
// them installed.

import (
	"os/exec"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSync_CodeBlock_StdlibHeavyComputation runs a code block that
// uses several stdlib modules in one shot — json + datetime + hashlib
// + base64. This is the floor of "realistic customer code" — no pip
// packages required. Proves the sandbox doesn't sandbox out stdlib.
func TestSync_CodeBlock_StdlibHeavyComputation(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not installed")
	}
	stack := setupStack(t)
	defer stack.close()

	body := `{
	  "type": "execute_flow",
	  "payload": {
	    "trace_id": "stdlib-heavy",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"raw","type":"str"}],
	          "dataset":{"inline":{"records":{"raw":["customer-data-2026"]}}},
	          "entry_selection":0,
	          "train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"compute","type":"code","data":{
	          "parameters":[
	            {"identifier":"code","type":"code","value":"import json, datetime, hashlib, base64\n\ndef execute(raw):\n    payload = {\n      'raw': raw,\n      'len': len(raw),\n      'b64': base64.b64encode(raw.encode()).decode(),\n      'sha256': hashlib.sha256(raw.encode()).hexdigest(),\n      'year': datetime.datetime(2026, 4, 25).year,\n    }\n    return {'result': json.dumps(payload, sort_keys=True)}\n"}
	          ],
	          "inputs":[{"identifier":"raw","type":"str"}],
	          "outputs":[{"identifier":"result","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{
	          "inputs":[{"identifier":"result","type":"str"}]
	        }}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.raw","target":"compute","targetHandle":"inputs.raw","type":"default"},
	        {"id":"e2","source":"compute","sourceHandle":"outputs.result","target":"end","targetHandle":"inputs.result","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}],
	    "origin":"workflow"
	  }
	}`

	res := postSync(t, stack, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	got, _ := res.Result["result"].(string)
	// Sanity-check each stdlib feature reached the customer code.
	assert.Contains(t, got, `"len": 18`)               // len("customer-data-2026")
	assert.Contains(t, got, `"year": 2026`)            // datetime
	assert.Contains(t, got, `"raw": "customer-data-2026"`)
	assert.Contains(t, got, `"sha256":`)               // hashlib produced something
	// base64.b64encode("customer-data-2026") = "Y3VzdG9tZXItZGF0YS0yMDI2"
	assert.Contains(t, got, `Y3VzdG9tZXItZGF0YS0yMDI2`)
}

// TestSync_CodeBlock_ThirdPartyImportSkipsCleanly proves the failure
// mode for missing third-party packages: the user code raises
// ImportError, the engine surfaces a structured error with the
// traceback, and the workflow result is "error" with the right
// node_id. This is a customer-facing UX assertion — the failure must
// be diagnosable from the Studio UI, not a generic 500.
func TestSync_CodeBlock_ThirdPartyImportSkipsCleanly(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not installed")
	}
	stack := setupStack(t)
	defer stack.close()

	body := `{
	  "type": "execute_flow",
	  "payload": {
	    "trace_id": "import-error",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"q","type":"str"}],
	          "dataset":{"inline":{"records":{"q":["x"]}}},
	          "entry_selection":0,
	          "train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"missing","type":"code","data":{
	          "parameters":[
	            {"identifier":"code","type":"code","value":"def execute(q):\n    import this_package_definitely_does_not_exist_2026\n    return {'q': q}\n"}
	          ],
	          "inputs":[{"identifier":"q","type":"str"}],
	          "outputs":[{"identifier":"q","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{
	          "inputs":[{"identifier":"q","type":"str"}]
	        }}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.q","target":"missing","targetHandle":"inputs.q","type":"default"},
	        {"id":"e2","source":"missing","sourceHandle":"outputs.q","target":"end","targetHandle":"inputs.q","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}],
	    "origin":"workflow"
	  }
	}`

	res := postSync(t, stack, body)
	require.Equal(t, "error", res.Status)
	require.NotNil(t, res.Error)
	assert.Equal(t, "ModuleNotFoundError", res.Error.Type)
	assert.Equal(t, "missing", res.Error.NodeID)
	assert.Contains(t, strings.ToLower(res.Error.Message), "this_package_definitely_does_not_exist_2026")
}

// TestSync_CodeBlock_NetworkAccessViaUrllib proves user code can make
// outbound HTTP via stdlib (urllib.request). nlpgo's code sandbox
// today does not block egress (matching today's Python NLP behavior;
// future hardening is tracked separately). Customer workflows that
// fetch external data from a code block keep working.
func TestSync_CodeBlock_NetworkAccessViaUrllib(t *testing.T) {
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not installed")
	}
	stack := setupStack(t)
	defer stack.close()

	// We point the user code at the same recording upstream the
	// stack already exposes — tests don't depend on internet.
	body := `{
	  "type": "execute_flow",
	  "payload": {
	    "trace_id": "urllib-net",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"u","type":"str"}],
	          "dataset":{"inline":{"records":{"u":["` + stack.upstreamURL + `/echo"]}}},
	          "entry_selection":0,
	          "train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"fetch","type":"code","data":{
	          "parameters":[
	            {"identifier":"code","type":"code","value":"import urllib.request, json\n\ndef execute(u):\n    req = urllib.request.Request(u, data=json.dumps({'q':'pong'}).encode(), headers={'Content-Type':'application/json'}, method='POST')\n    with urllib.request.urlopen(req, timeout=5) as r:\n        body = r.read().decode()\n    return {'fetched': body}\n"}
	          ],
	          "inputs":[{"identifier":"u","type":"str"}],
	          "outputs":[{"identifier":"fetched","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{
	          "inputs":[{"identifier":"fetched","type":"str"}]
	        }}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.u","target":"fetch","targetHandle":"inputs.u","type":"default"},
	        {"id":"e2","source":"fetch","sourceHandle":"outputs.fetched","target":"end","targetHandle":"inputs.fetched","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}],
	    "origin":"workflow"
	  }
	}`

	res := postSync(t, stack, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)
	got, _ := res.Result["fetched"].(string)
	assert.Contains(t, got, `"echo"`)
	assert.Contains(t, got, `"q":"pong"`)
}
