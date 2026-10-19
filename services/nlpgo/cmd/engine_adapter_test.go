package cmd

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)

type stubLLM struct{}

func (stubLLM) Execute(context.Context, app.LLMRequest) (*app.LLMResponse, error) {
	return &app.LLMResponse{Content: "a cat"}, nil
}

func (stubLLM) ExecuteStream(context.Context, app.LLMRequest) (app.StreamIterator, error) {
	return nil, nil
}

// imageWorkflowJSON is a signature node fed by one image-typed input, the
// shape whose input is fetched before the model is called.
const imageWorkflowJSON = `{
  "workflow_id":"wf","api_key":"k","spec_version":"1.5","name":"x","icon":"x","description":"x","version":"x",
  "template_adapter":"default",
  "nodes":[
    {"id":"entry","type":"entry","data":{"outputs":[{"identifier":"picture","type":"image"}]}},
    {"id":"answer","type":"signature","data":{
      "parameters":[{"identifier":"llm","type":"llm","value":{"model":"openai/gpt-5-mini"}}],
      "inputs":[{"identifier":"picture","type":"image"}],
      "outputs":[{"identifier":"answer","type":"str"}]}},
    {"id":"end","type":"end","data":{"inputs":[{"identifier":"answer","type":"str"}]}}
  ],
  "edges":[
    {"id":"e1","source":"entry","sourceHandle":"outputs.picture","target":"answer","targetHandle":"inputs.picture","type":"default"},
    {"id":"e2","source":"answer","sourceHandle":"outputs.answer","target":"end","targetHandle":"inputs.answer","type":"default"}
  ],
  "state":{}
}`

// The adapter is the only path from the decoded request to the engine, so a
// limit it dropped would leave every run on the default. Both of its entry
// points are driven with a 1 MiB limit against a body one byte larger.
func TestEngineAdapter_MapsMaxAttachmentBytes(t *testing.T) {
	const mib = 1024 * 1024
	body := make([]byte, mib+1)
	copy(body, "\x89PNG\r\n\x1a\n")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(body)
	}))
	defer srv.Close()

	adapter := engineAdapter{eng: engine.New(engine.Options{
		LLM:  stubLLM{},
		SSRF: httpblock.SSRFOptions{AllowedHosts: []string{"127.0.0.1"}},
	})}
	request := func(limit int64) app.WorkflowRequest {
		return app.WorkflowRequest{
			WorkflowJSON:       []byte(imageWorkflowJSON),
			Inputs:             map[string]any{"picture": srv.URL + "/big.png"},
			MaxAttachmentBytes: limit,
		}
	}
	const tooLarge = "is larger than the 1 MB attachment limit"

	t.Run("Execute", func(t *testing.T) {
		limited, err := adapter.Execute(context.Background(), request(mib))
		require.NoError(t, err)
		require.Equal(t, "error", limited.Status)
		require.NotNil(t, limited.Error)
		assert.Contains(t, limited.Error.Message, tooLarge)

		byDefault, err := adapter.Execute(context.Background(), request(0))
		require.NoError(t, err)
		assert.Equal(t, "success", byDefault.Status, "engine error: %+v", byDefault.Error)
	})

	t.Run("ExecuteStream", func(t *testing.T) {
		drain := func(limit int64) string {
			events, err := adapter.ExecuteStream(context.Background(), request(limit), app.WorkflowStreamOptions{})
			require.NoError(t, err)
			var all []app.WorkflowStreamEvent
			for ev := range events {
				all = append(all, ev)
			}
			raw, err := json.Marshal(all)
			require.NoError(t, err)
			return string(raw)
		}
		assert.Contains(t, drain(mib), tooLarge)
		assert.NotContains(t, drain(0), "attachment limit")
	})
}
