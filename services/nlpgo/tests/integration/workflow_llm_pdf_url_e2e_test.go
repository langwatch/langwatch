//go:build live_openai

package integration_test

// Known-answer document probe. Proves the remote-attachment-URL path delivers a
// PDF attachment end to end: a prompt references a document by a plain http URL,
// nlpgo fetches it, detects application/pdf, structures it as a file content
// part, and a real document-capable model (via the in-process gateway) answers
// a question only answerable by actually reading the file.
//
// The fixture contains "The order number is 4729." and "The customer city is
// Lisbon." (a known-content PDF). The two facts are absent from the opaque URL,
// so a correct answer proves the document was fetched, structured, and read
// rather than hallucinated.
//
// Build tag: live_openai (needs a real OPENAI_API_KEY). The PDF fixture is
// supplied via PDF_FIXTURE_PATH so no binary is committed; the test skips when
// either is absent.

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSync_RealWorkflowEndToEnd_OpenAI_PDFAttachmentURL(t *testing.T) {
	apiKey := os.Getenv("OPENAI_API_KEY")
	if apiKey == "" {
		t.Skip("OPENAI_API_KEY not set")
	}
	fixturePath := os.Getenv("PDF_FIXTURE_PATH")
	if fixturePath == "" {
		t.Skip("PDF_FIXTURE_PATH not set (point it at a pdf whose text you know: order 4729, city Lisbon)")
	}
	pdf, err := os.ReadFile(fixturePath)
	require.NoError(t, err, "read pdf fixture")

	pdfSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/pdf")
		_, _ = w.Write(pdf)
	}))
	defer pdfSrv.Close()
	pdfURL := pdfSrv.URL + "/document"

	stack := setupVisionStack(t)

	body := `{
	  "type": "execute_flow",
	  "payload": {
	    "trace_id": "real-e2e-pdf-url",
	    "origin": "workflow",
	    "workflow": {
	      "workflow_id":"wf","api_key":"k","spec_version":"1.3","name":"PDF","icon":"📄","description":"x","version":"x",
	      "template_adapter":"default",
	      "nodes":[
	        {"id":"entry","type":"entry","data":{
	          "outputs":[{"identifier":"document","type":"str"}],
	          "dataset":{"inline":{"records":{"document":["` + pdfURL + `"]}}},
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
	            {"identifier":"instructions","type":"str","value":"Read the attached document and answer in one short sentence: what is the order number and the customer city?"}
	          ],
	          "inputs":[{"identifier":"document","type":"str"}],
	          "outputs":[{"identifier":"answer","type":"str"}]
	        }},
	        {"id":"end","type":"end","data":{
	          "inputs":[{"identifier":"answer","type":"str"}]
	        }}
	      ],
	      "edges":[
	        {"id":"e1","source":"entry","sourceHandle":"outputs.document","target":"answer","targetHandle":"inputs.document","type":"default"},
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
	require.NotEmpty(t, answer, "expected a non-empty answer from the real document call")
	// 4729 and Lisbon live only inside the fetched PDF, not in the URL, so both
	// appearing proves the document was fetched, structured, and read.
	lower := strings.ToLower(answer)
	assert.True(t, strings.Contains(lower, "4729") && strings.Contains(lower, "lisbon"),
		"expected the model to read the order number and city from the PDF, got %q", answer)
}
