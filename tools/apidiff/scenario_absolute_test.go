package apidiff

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// uploadStack is a side that mints a presigned URL on a second host, like an
// object store, and reports what that host received.
type uploadStack struct {
	mu          sync.Mutex
	body        string
	contentType string
	auth        string
}

func (stack *uploadStack) handlers(t *testing.T) http.Handler {
	store := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		raw, _ := io.ReadAll(request.Body)
		stack.mu.Lock()
		stack.body, stack.contentType, stack.auth = string(raw), request.Header.Get("Content-Type"), request.Header.Get("X-Auth-Token")
		stack.mu.Unlock()
		replyJSON(writer, http.StatusOK, map[string]any{"ok": true})
	}))
	t.Cleanup(store.Close)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/upload", func(writer http.ResponseWriter, _ *http.Request) {
		replyJSON(writer, http.StatusCreated, map[string]any{"uploadUrl": store.URL + "/bucket/object?sig=abc"})
	})
	mux.HandleFunc("/api/upload/last", func(writer http.ResponseWriter, _ *http.Request) {
		stack.mu.Lock()
		defer stack.mu.Unlock()
		replyJSON(writer, http.StatusOK, map[string]any{"body": stack.body, "contentType": stack.contentType, "auth": stack.auth})
	})
	return mux
}

const absoluteScenario = `
- id: absolute-put-sends-raw-bytes-and-no-credentials
  endpoint: PUT /api/upload
  setup:
    - request: POST /api/upload
      capture: { uploadUrl: uploadUrl }
  request: { method: PUT, path: "{uploadUrl}", bodyRaw: "hello-{uid}", contentType: text/plain }
  expect: { status: 200 }
  verify:
    - request: GET /api/upload/last
      expect: { status: 200, body: { body: "hello-{uid}", contentType: text/plain, auth: "" } }
`

func TestAbsoluteURLStepSendsRawBytesToTheCapturedHostWithoutCredentials(t *testing.T) {
	branch, main := &uploadStack{}, &uploadStack{}
	serverA, serverB := httptest.NewServer(branch.handlers(t)), httptest.NewServer(main.handlers(t))
	t.Cleanup(serverA.Close)
	t.Cleanup(serverB.Close)
	options := scenarioOptions{
		A: serverA.URL, B: serverB.URL, Keys: Keys{ProjectKey: "key", OrgKey: "org"}, Timeout: 5 * time.Second,
		Concurrency: 2, Shards: 1, Glob: writeScenarioYAML(t, absoluteScenario), RunDir: t.TempDir(),
	}
	var report bytes.Buffer
	runScenarioPhase(context.Background(), scenarioPhase{options: options, report: &report, progress: &report})
	results := readResults(t, options.RunDir)
	if len(results) != 1 || results[0].Verdict != verdictPass {
		t.Fatalf("results %+v\n%s", results, report.String())
	}
}
