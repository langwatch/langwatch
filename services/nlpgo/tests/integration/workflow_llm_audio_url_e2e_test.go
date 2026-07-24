//go:build live_openai

package integration_test

// Known-answer audio probe. Proves the remote-attachment-URL path delivers a
// non-image attachment (audio) end to end: a prompt references an audio file by
// a plain http URL, nlpgo fetches it, detects audio/wav, structures it as an
// input_audio content part, and a real audio-capable model (via the in-process
// gateway) answers a question only answerable by actually hearing the clip.
//
// The clip asks aloud "Do I have a male voice or a female voice?" (confirmed by
// a separate Whisper transcription). Asking the model to repeat the spoken
// question verbatim makes the assertion independent of the voice's gender and
// impossible to satisfy from the opaque URL alone, so a correct echo proves the
// audio was fetched, structured, and heard rather than hallucinated.
//
// Build tag: live_openai (needs a real OPENAI_API_KEY). The audio fixture is
// supplied via AUDIO_FIXTURE_PATH so no large binary is committed; the test
// skips when either is absent.

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSync_RealWorkflowEndToEnd_OpenAI_AudioAttachmentURL(t *testing.T) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		t.Skip("OPENAI_API_KEY not set")
	}
	fixturePath := os.Getenv("AUDIO_FIXTURE_PATH")
	if fixturePath == "" {
		t.Skip("AUDIO_FIXTURE_PATH not set (point it at a wav whose spoken content you know)")
	}
	wav, err := os.ReadFile(fixturePath)
	require.NoError(t, err, "read audio fixture")

	audioSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write(wav)
	}))
	defer audioSrv.Close()
	audioURL := audioSrv.URL + "/clip"

	stack := setupVisionStack(t)

	body := `{
	  "type": "execute_flow",
	  "payload": {
	    "trace_id": "real-e2e-audio-url",
	    "origin": "workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"Audio","icon":"🔊","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"clip","type":"str"}],
	          "dataset":{"inline":{"records":{"clip":["` + audioURL + `"]}}},
	          "entry_selection":0,
	          "train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"answer","type":"signature","data":{
	          "name":"Answer",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{
	              "model":"openai/gpt-audio",
	              "litellm_params":{"api_key":"` + apiKey + `"}
	            }},
	            {"identifier":"instructions","type":"str","value":"You are given one audio clip. Repeat, verbatim and in English, the question that is asked in it, and nothing else."}
	          ],
	          "inputs":[{"identifier":"clip","type":"str"}],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{
	          "inputs":[{"identifier":"answer","type":"str"}]
	        }}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.clip","target":"answer","targetHandle":"inputs.clip","type":"default"},
	        {"id":"e2","source":"answer","sourceHandle":"outputs.answer","target":"end","targetHandle":"inputs.answer","type":"default"}
	      ],
	      "state":{}
	    },
	    "inputs":[{}]
	  }
	}`

	res := postSync(t, stack, body)
	require.Equal(t, "success", res.Status, "engine error: %+v", res.Error)

	answer, _ := res.Result["answer"].(string)
	require.NotEmpty(t, answer, "expected a non-empty answer from the real audio call")
	// The clip asks about a "male voice or a female voice" — words the model can
	// only produce by hearing the fetched audio, since the URL gives nothing away.
	lower := strings.ToLower(answer)
	assert.True(t, strings.Contains(lower, "male voice") && strings.Contains(lower, "female voice"),
		"expected the model to echo the spoken question (male/female voice), got %q", answer)
}
