//go:build live_openai

package integration_test

// Known-answer vision probe. Proves the remote-attachment-URL path end to end:
// a prompt references an image by a plain http URL, nlpgo fetches it, inlines it
// as a base64 image part, and a real vision model (via the in-process gateway)
// answers a question that is only answerable by actually seeing the pixels.
//
// The image is served from a local httptest server with an opaque path
// (/image.png), and its content is a solid color we generate here, so the model
// cannot guess the answer from the URL or a filename — a correct color proves it
// received and understood the picture rather than hallucinating.
//
// Build tag: live_openai (needs a real OPENAI_API_KEY).

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/dispatcheradapter"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/llmexecutor"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
)

// setupVisionStack mirrors setupStackWithLLM but allows the loopback image
// server past the SSRF guard so the engine can fetch the test attachment.
func setupVisionStack(t *testing.T) *stack {
	t.Helper()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))

	disp, err := dispatcher.New(context.Background(), dispatcher.Options{})
	require.NoError(t, err)
	llm := llmexecutor.New(dispatcheradapter.New(disp))

	httpExec := httpblock.New(httpblock.Options{})
	codeExec, err := codeblock.New(codeblock.Options{})
	require.NoError(t, err)
	eng := engine.New(engine.Options{
		HTTP: httpExec,
		Code: codeExec,
		LLM:  llm,
		// Allow the loopback image server; production fetches still bind to the
		// default private/loopback ban.
		SSRF: httpblock.SSRFOptions{AllowedHosts: []string{"127.0.0.1"}},
	})

	executor := liveExecutorAdapter{eng: eng}
	application := app.New(app.WithWorkflowExecutor(executor))
	probes := health.New("test")
	probes.MarkStarted()
	router := httpapi.NewRouter(httpapi.RouterDeps{App: application, Health: probes, Version: "test"})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	t.Cleanup(upstream.Close)
	return &stack{url: srv.URL, upstream: upstream, upstreamURL: upstream.URL}
}

func solidColorPNG(t *testing.T, c color.Color) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 96, 96))
	draw.Draw(img, img.Bounds(), &image.Uniform{C: c}, image.Point{}, draw.Src)
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, img))
	return buf.Bytes()
}

// TestSync_RealWorkflowEndToEnd_OpenAI_VisionAttachmentURL is the headline
// dogfood: a plain http image URL in a prompt reaches a real vision model as a
// real image, and the model reports the color it could only have seen.
func TestSync_RealWorkflowEndToEnd_OpenAI_VisionAttachmentURL(t *testing.T) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		t.Skip("OPENAI_API_KEY not set")
	}

	imgSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(solidColorPNG(t, color.RGBA{R: 0, G: 0, B: 255, A: 255}))
	}))
	defer imgSrv.Close()
	imageURL := imgSrv.URL + "/image.png"

	stack := setupVisionStack(t)

	body := `{
	  "type": "execute_flow",
	  "payload": {
	    "trace_id": "real-e2e-vision-url",
	    "origin": "workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"Vision","icon":"🖼️","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"picture","type":"str"}],
	          "dataset":{"inline":{"records":{"picture":["` + imageURL + `"]}}},
	          "entry_selection":0,
	          "train_size":1.0,"test_size":0.0,"seed":1
	        }},
	        {"id":"answer","type":"signature","data":{
	          "name":"Answer",
	          "parameters":[
	            {"identifier":"llm","type":"llm","value":{
	              "model":"openai/gpt-5-mini",
	              "litellm_params":{"api_key":"` + apiKey + `"}
	            }},
	            {"identifier":"instructions","type":"str","value":"You are shown one image. Reply with the single lowercase English word naming its dominant color, and nothing else."}
	          ],
	          "inputs":[{"identifier":"picture","type":"str"}],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{
	          "inputs":[{"identifier":"answer","type":"str"}]
	        }}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.picture","target":"answer","targetHandle":"inputs.picture","type":"default"},
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
	require.NotEmpty(t, answer, "expected a non-empty answer from the real vision call")
	// "blue" is only knowable by seeing the generated pixels — the URL gives
	// nothing away — so a correct color is proof the image was fetched, inlined,
	// and understood, not hallucinated.
	assert.Contains(t, strings.ToLower(answer), "blue",
		"expected the model to report the image color blue, got %q", answer)
}
