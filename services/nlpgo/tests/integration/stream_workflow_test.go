package integration_test

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// streamFrame represents one decoded SSE event from /go/studio/execute.
type streamFrame struct {
	Event string
	Data  map[string]any
}

// readSSE consumes an SSE stream until done, error, or stop returns
// true. Returns the decoded frames in order. Caller times out the
// underlying HTTP request via http.Client.Timeout.
//
// Wire format (matches Python's /studio/execute):
//
//	data: {"type":"<name>","payload":{...}}\n\n
//
// frame.Event surfaces the JSON's `type`; frame.Data surfaces the
// JSON's `payload` so test assertions stay terse.
func readSSE(t *testing.T, r io.Reader, stop func(streamFrame) bool) []streamFrame {
	t.Helper()
	out := []streamFrame{}
	br := bufio.NewReader(r)
	var data string
	for {
		line, err := br.ReadString('\n')
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("readSSE: %v", err)
		}
		line = strings.TrimRight(line, "\r\n")
		switch {
		case line == "":
			if data != "" {
				var raw map[string]any
				_ = json.Unmarshal([]byte(data), &raw)
				eventType, _ := raw["type"].(string)
				payload, _ := raw["payload"].(map[string]any)
				frame := streamFrame{Event: eventType, Data: payload}
				out = append(out, frame)
				if stop != nil && stop(frame) {
					return out
				}
				data = ""
			}
		case strings.HasPrefix(line, "data: "):
			if data != "" {
				data += "\n"
			}
			data += strings.TrimPrefix(line, "data: ")
		}
	}
	return out
}

func postStreamURL(t *testing.T, url, body string, hdrs map[string]string) *http.Response {
	t.Helper()
	req, err := http.NewRequest("POST", url+"/go/studio/execute", bytes.NewBufferString(body))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-LangWatch-Origin", "workflow")
	for k, v := range hdrs {
		req.Header.Set(k, v)
	}
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)
	require.Contains(t, resp.Header.Get("Content-Type"), "text/event-stream")
	return resp
}

// TestStream_EmitsExecutionStateChangePerNodeThenDone exercises the
// happy path: a 3-node workflow streams one execution_state_change per
// node transition (running + success), then a single done frame.
func TestStream_EmitsExecutionStateChangePerNodeThenDone(t *testing.T) {
	stack := setupStack(t)
	defer stack.close()

	body := `{
	  "workflow": {
	    "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{
	        "outputs":[{"identifier":"q","type":"str"}],
	        "dataset":{"inline":{"records":{"q":["hi"]}}},
	        "entry_selection":0,
	        "train_size":1.0,"test_size":0.0,"seed":1
	      }},
	      {"id":"end","type":"end","data":{
	        "inputs":[{"identifier":"q","type":"str"}]
	      }}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"outputs.q","target":"end","targetHandle":"inputs.q","type":"default"}
	    ],
	    "state":{}
	  }
	}`

	resp := postStreamURL(t, stack.url, body, nil)
	defer resp.Body.Close()

	frames := readSSE(t, resp.Body, func(f streamFrame) bool { return f.Event == "done" })

	// Each node should appear at least once with status "running" and
	// once with "success" (or directly success for entry). Wire shape:
	// {type: "component_state_change", payload: {component_id, execution_state}}.
	stateCount := map[string]int{}
	for _, f := range frames {
		if f.Event == "component_state_change" {
			es, _ := f.Data["execution_state"].(map[string]any)
			id, _ := f.Data["component_id"].(string)
			status, _ := es["status"].(string)
			stateCount[id+":"+status]++
		}
	}
	assert.GreaterOrEqual(t, stateCount["entry:success"], 1, "entry should have a success state event")
	assert.GreaterOrEqual(t, stateCount["end:success"], 1, "end should have a success state event")

	// Final frame should be done with status success and the result
	// containing the entry's output. Done's payload still carries the
	// Go-engine-internal {status, result, ...} since these tests assert
	// on the full envelope; Python's done is bare but the TS Studio
	// reducer ignores extra fields.
	last := frames[len(frames)-1]
	require.Equal(t, "done", last.Event)
	assert.Equal(t, "success", last.Data["status"])
	result, _ := last.Data["result"].(map[string]any)
	assert.Equal(t, "hi", result["q"])
}

// TestStream_HeartbeatTicksDuringSlowRun proves is_alive_response frames keep
// the SSE stream warm during a long-running node.
func TestStream_HeartbeatTicksDuringSlowRun(t *testing.T) {
	if testing.Short() {
		t.Skip("heartbeat test waits ~1.5s; skip in -short")
	}
	stack := setupStack(t)
	defer stack.close()

	body := `{
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
	      {"id":"slow","type":"code","data":{
	        "parameters":[
	          {"identifier":"code","type":"code","value":"def execute(q):\n    import time\n    time.sleep(1.2)\n    return {'q': q}\n"}
	        ],
	        "inputs":[{"identifier":"q","type":"str"}],
	        "outputs":[{"identifier":"q","type":"str"}]
	      }},
	      {"id":"end","type":"end","data":{"inputs":[{"identifier":"q","type":"str"}]}}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"outputs.q","target":"slow","targetHandle":"inputs.q","type":"default"},
	      {"id":"e2","source":"slow","sourceHandle":"outputs.q","target":"end","targetHandle":"inputs.q","type":"default"}
	    ],
	    "state":{}
	  }
	}`

	// Override heartbeat to 250ms so we get plenty of ticks during the
	// 1.2s sleep.
	resp := postStreamURL(t, stack.url, body, map[string]string{
		"X-LangWatch-NLPGO-Heartbeat-MS": "250",
	})
	defer resp.Body.Close()

	frames := readSSE(t, resp.Body, func(f streamFrame) bool { return f.Event == "done" })

	heartbeats := 0
	for _, f := range frames {
		if f.Event == "is_alive_response" {
			heartbeats++
		}
	}
	assert.GreaterOrEqual(t, heartbeats, 2, "expected at least 2 heartbeats during 1.2s sleep with 250ms tick")

	last := frames[len(frames)-1]
	assert.Equal(t, "done", last.Event)
	assert.Equal(t, "success", last.Data["status"])
}
