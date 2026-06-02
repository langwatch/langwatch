package integration_test

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// TestHTTPBlock_SecretReferenceResolvesAtRequestTime pins
// specs/nlp-go/http-block.feature "secret references resolve at request
// time, not at parse time". A bearer token of `{{ secrets.UPSTREAM_TOKEN }}`
// on the DSL (workflow.secrets, populated upstream by addEnvs.ts) must reach
// the upstream as the resolved plaintext — and must NOT leak into the sync
// response / rendered execution events.
func TestHTTPBlock_SecretReferenceResolvesAtRequestTime(t *testing.T) {
	var mu sync.Mutex
	var observedAuth string

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		observedAuth = r.Header.Get("Authorization")
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(upstream.Close)
	upstreamHost, _, _ := net.SplitHostPort(upstream.Listener.Addr().String())

	// No signature node in this flow, so the LLM is never called.
	llm := &fakeLLMClient{
		respond: func(app.LLMRequest) (*app.LLMResponse, error) {
			return &app.LLMResponse{Content: ""}, nil
		},
	}
	url, _ := setupPatternStackWithUpstream(t, llm, func(http.ResponseWriter, *http.Request) {}, upstreamHost)

	body := `{
	  "type":"execute_flow",
	  "payload": {
	    "trace_id":"http-secret",
	    "origin":"workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3",
	      "name":"HTTPSecret","icon":"x","description":"x","version":"x",
	      "template_adapter":"default",
	      "secrets":{"UPSTREAM_TOKEN":"rotated-value"},
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"q","type":"str"}],
	          "dataset":{"inline":{"records":{"q":["x"]},"count":1}},
	          "entry_selection":0,"train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"call","type":"http","data":{
	          "parameters":[
	            {"identifier":"url","type":"str","value":"` + upstream.URL + `/secure"},
	            {"identifier":"method","type":"str","value":"GET"},
	            {"identifier":"output_path","type":"str","value":"$.ok"},
	            {"identifier":"auth","type":"json","value":{"type":"bearer","token":"{{ secrets.UPSTREAM_TOKEN }}"}}
	          ],
	          "outputs":[{"identifier":"ok","type":"bool"}]
	        }},
	        {"id":"end","type":"end","data":{"inputs":[{"identifier":"ok","type":"bool"}]}}
	      ],
	      "edges":[
	        {"id":"e0","source":"entry","sourceHandle":"outputs.q","target":"call","targetHandle":"inputs.q","type":"default"},
	        {"id":"e1","source":"call","sourceHandle":"outputs.ok","target":"end","targetHandle":"inputs.ok","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`

	res := postSync(t, &stack{url: url}, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	mu.Lock()
	defer mu.Unlock()
	// Resolved at request time: upstream saw the rotated plaintext.
	assert.Equal(t, "Bearer rotated-value", observedAuth)
	// Never leaks the plaintext back into the execution events / result.
	serialized, err := json.Marshal(res)
	require.NoError(t, err)
	assert.NotContains(t, string(serialized), "rotated-value",
		"the resolved secret must not appear anywhere in the sync response")
}
