package apidiff

import (
	"bytes"
	"context"
	"net/http/httptest"
	"testing"
	"time"
)

const contentTypePlaceholderScenario = `
- id: content-type-expands-placeholders
  endpoint: PUT /api/upload
  setup:
    - request: POST /api/upload
      capture: { uploadUrl: uploadUrl }
  request:
    method: PUT
    path: "{uploadUrl}"
    bodyRaw: "--b{uid}\r\n\r\nx\r\n--b{uid}--\r\n"
    contentType: "multipart/form-data; boundary=--b{uid}"
  expect: { status: 200 }
  verify:
    - request: GET /api/upload/last
      expect: { status: 200, body: { contentType: "multipart/form-data; boundary=--b{uid}" } }
`

func TestContentTypeExpandsPlaceholdersLikeTheBody(t *testing.T) {
	branch, main := &uploadStack{}, &uploadStack{}
	serverA, serverB := httptest.NewServer(branch.handlers(t)), httptest.NewServer(main.handlers(t))
	t.Cleanup(serverA.Close)
	t.Cleanup(serverB.Close)
	options := scenarioOptions{
		A: serverA.URL, B: serverB.URL, Keys: Keys{ProjectKey: "key", OrgKey: "org"}, Timeout: 5 * time.Second,
		Concurrency: 2, Shards: 1, Glob: writeScenarioYAML(t, contentTypePlaceholderScenario), RunDir: t.TempDir(),
	}
	var report bytes.Buffer
	runScenarioPhase(context.Background(), options, &report, &report)
	results := readResults(t, options.RunDir)
	if len(results) != 1 || results[0].Verdict != verdictPass {
		t.Fatalf("results %+v\n%s", results, report.String())
	}
}
