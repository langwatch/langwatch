package integration_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The per-file attachment limit a run was started with travels to the calls
// that run makes back into the application, from either place the request can
// name it, clamped to what an organization can hold.
//
// @scenario "A nested workflow run keeps the limit of the run that started it"
func TestMaxAttachmentBytes_ForwardedToNestedCalls(t *testing.T) {
	var mu sync.Mutex
	var forwarded []string
	url, _, _ := setupEvaluatorStack(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		forwarded = append(forwarded, r.Header.Get("X-LangWatch-Max-Attachment-Bytes"))
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"status": "processed", "passed": true})
	})

	const workflow = `{
	    "workflow_id":"wf","api_key":"sk-project-token","spec_version":"1.3","name":"x","icon":"x","description":"x","version":"x",
	    "template_adapter":"default",
	    "nodes":[
	      {"id":"entry","type":"entry","data":{"train_size":1.0,"test_size":0.0,"seed":1,
	        "outputs":[{"identifier":"input","type":"str"},{"identifier":"output","type":"str"}],
	        "dataset":{"inline":{"records":{"input":["hello"],"output":["hello"]},"count":1}}}},
	      {"id":"eval","type":"evaluator","data":{
	        "parameters":[{"identifier":"evaluator","type":"str","value":"langevals/exact_match"}],
	        "outputs":[{"identifier":"passed","type":"bool"}]}},
	      {"id":"end","type":"end","data":{"inputs":[{"identifier":"passed","type":"bool"}]}}
	    ],
	    "edges":[
	      {"id":"e1","source":"entry","sourceHandle":"input","target":"eval","targetHandle":"input","type":"default"},
	      {"id":"e2","source":"entry","sourceHandle":"output","target":"eval","targetHandle":"output","type":"default"},
	      {"id":"e3","source":"eval","sourceHandle":"passed","target":"end","targetHandle":"passed","type":"default"}
	    ],
	    "state":{}
	  }`

	cases := []struct {
		name    string
		payload string
		header  string
		want    string
	}{
		{"named in the payload", `"max_attachment_bytes": 104857600,`, "", "104857600"},
		{"named in the header", ``, "52428800", "52428800"},
		{"payload wins over the header", `"max_attachment_bytes": 104857600,`, "52428800", "104857600"},
		{"clamped to the ceiling", `"max_attachment_bytes": 9999999999999,`, "", "1073741824"},
		{"not named", ``, "", ""},
		{"malformed header", ``, "lots", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mu.Lock()
			forwarded = nil
			mu.Unlock()

			body := `{"type":"execute_flow","payload":{"trace_id":"t",` + tc.payload + `"workflow":` + workflow + `}}`
			req, err := http.NewRequest(http.MethodPost, url+"/go/studio/execute_sync", bytes.NewBufferString(body))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			if tc.header != "" {
				req.Header.Set("X-LangWatch-Max-Attachment-Bytes", tc.header)
			}
			resp, err := http.DefaultClient.Do(req)
			require.NoError(t, err)
			defer func() { _ = resp.Body.Close() }()
			require.Equal(t, http.StatusOK, resp.StatusCode)

			mu.Lock()
			defer mu.Unlock()
			require.Len(t, forwarded, 1, "the evaluator call must reach the application once")
			assert.Equal(t, tc.want, forwarded[0])
		})
	}
}
