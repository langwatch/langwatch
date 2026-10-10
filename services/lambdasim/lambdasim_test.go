package lambdasim

import (
	"bytes"
	"cmp"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream"
)

// nlpgoSeen is what the stub nlpgo last received.
type nlpgoSeen struct {
	method, path, query, header, body string
}

// newStack is lambdasim in front of a stub nlpgo that answers 201 with a body naming the path.
func newStack(t *testing.T, cfg Config) (*Server, *nlpgoSeen) {
	t.Helper()
	seen := &nlpgoSeen{}
	nlpgo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		*seen = nlpgoSeen{r.Method, r.URL.Path, r.URL.RawQuery, r.Header.Get("X-LangWatch-Origin"), string(body)}
		if r.URL.Path == "/studio/execute" {
			w.Header().Set("Content-Type", "text/event-stream")
			for i := range 3 {
				_, _ = fmt.Fprintf(w, "data: frame %d\n\n", i)
				w.(http.Flusher).Flush()
			}
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ran":"` + r.URL.Path + `"}`))
	}))
	t.Cleanup(nlpgo.Close)
	cfg.Target = cmp.Or(cfg.Target, nlpgo.URL)
	return newServer(cfg, fstest.MapFS{"index.html": {Data: []byte("<div id=root></div>")}}), seen
}

func send(t *testing.T, s *Server, method, path, body string, headers ...string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func decode(t *testing.T, rec *httptest.ResponseRecorder, into any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), into); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
}

const event = `{"rawPath":"/go/run","rawQueryString":"a=1","requestContext":{"http":{"method":"POST"}},"headers":{"X-LangWatch-Origin":"studio"},"body":"{\"x\":1}"}`

const createBody = `{"FunctionName":"langwatch_nlp-p1","Role":"arn:role","Code":{"ImageUri":"img:1"},"PackageType":"Image","Timeout":900,"MemorySize":2048,"Environment":{"Variables":{"A":"1"}}}`

// @scenario "A project's function is created and read back"
func TestFunctionLifecycle(t *testing.T) {
	s, _ := newStack(t, Config{})
	if rec := send(t, s, "GET", "/2015-03-31/functions/langwatch_nlp-p1", ""); rec.Code != 404 || rec.Header().Get("X-Amzn-ErrorType") != "ResourceNotFoundException" {
		t.Fatalf("missing function answered %d %q", rec.Code, rec.Header().Get("X-Amzn-ErrorType"))
	}
	if rec := send(t, s, "POST", "/2015-03-31/functions", createBody); rec.Code != 201 {
		t.Fatalf("create answered %d %s", rec.Code, rec.Body)
	}
	var got struct {
		Configuration function
		Code          struct{ ImageUri string }
	}
	decode(t, send(t, s, "GET", "/2015-03-31/functions/langwatch_nlp-p1", ""), &got)
	c := got.Configuration
	if c.State != "Active" || c.LastUpdateStatus != "Successful" || c.MemorySize != 2048 || c.Timeout != 900 ||
		c.Environment.Variables["A"] != "1" || got.Code.ImageUri != "img:1" || !strings.HasSuffix(c.FunctionArn, ":function:langwatch_nlp-p1") {
		t.Fatalf("read back %+v code %+v", c, got.Code)
	}
	if rec := send(t, s, "POST", "/2015-03-31/functions", createBody); rec.Code != 409 || rec.Header().Get("X-Amzn-ErrorType") != "ResourceConflictException" {
		t.Fatalf("second create answered %d", rec.Code)
	}
	send(t, s, "PUT", "/2015-03-31/functions/"+c.FunctionArn+"/code", `{"ImageUri":"img:2"}`)
	send(t, s, "PUT", "/2015-03-31/functions/langwatch_nlp-p1/configuration", `{"MemorySize":1024,"Environment":{"Variables":{"B":"2"}}}`)
	decode(t, send(t, s, "GET", "/2015-03-31/functions/langwatch_nlp-p1", ""), &got)
	if got.Code.ImageUri != "img:2" || got.Configuration.MemorySize != 1024 || got.Configuration.Timeout != 900 || got.Configuration.Environment.Variables["B"] != "2" {
		t.Fatalf("after updates %+v code %+v", got.Configuration, got.Code)
	}
	var list struct{ Functions []function }
	decode(t, send(t, s, "GET", "/2015-03-31/functions/", ""), &list)
	if len(list.Functions) != 1 || list.Functions[0].FunctionName != "langwatch_nlp-p1" {
		t.Fatalf("list %+v", list)
	}
	if rec := send(t, s, "DELETE", "/2015-03-31/functions/langwatch_nlp-p1", ""); rec.Code != 204 {
		t.Fatalf("delete answered %d", rec.Code)
	}
	if rec := send(t, s, "GET", "/2015-03-31/functions/langwatch_nlp-p1", ""); rec.Code != 404 {
		t.Fatalf("deleted function answered %d", rec.Code)
	}
}

// splitPrelude is the adapter framing read back: the prelude's status and the body.
func splitPrelude(t *testing.T, payload []byte) (int, string) {
	t.Helper()
	i := bytes.Index(payload, lwaSeparator)
	if i < 0 {
		t.Fatalf("no prelude separator in %q", payload)
	}
	var head struct{ StatusCode int }
	if err := json.Unmarshal(payload[:i], &head); err != nil {
		t.Fatal(err)
	}
	return head.StatusCode, string(payload[i+len(lwaSeparator):])
}

// @scenario "A synchronous invoke runs on nlpgo and answers in the adapter's framing"
func TestInvokeForwardsToNlpgo(t *testing.T) {
	s, seen := newStack(t, Config{})
	send(t, s, "POST", "/2015-03-31/functions", createBody)
	rec := send(t, s, "POST", "/2015-03-31/functions/arn:aws:lambda:us-east-1:000000000000:function:langwatch_nlp-p1/invocations", event)
	if rec.Code != 200 || rec.Header().Get("X-Amz-Function-Error") != "" {
		t.Fatalf("invoke answered %d %q", rec.Code, rec.Header().Get("X-Amz-Function-Error"))
	}
	if *seen != (nlpgoSeen{"POST", "/go/run", "a=1", "studio", `{"x":1}`}) {
		t.Fatalf("nlpgo saw %+v", *seen)
	}
	status, body := splitPrelude(t, rec.Body.Bytes())
	if status != 201 || body != `{"ran":"/go/run"}` {
		t.Fatalf("payload status %d body %q", status, body)
	}
}

// readEvents decodes an event stream with the AWS SDK's own codec, CRCs checked.
func readEvents(t *testing.T, raw []byte) []eventstream.Message {
	t.Helper()
	var out []eventstream.Message
	dec, r := eventstream.NewDecoder(), bytes.NewReader(raw)
	for r.Len() > 0 {
		msg, err := dec.Decode(r, nil)
		if err != nil {
			t.Fatalf("event %d: %v", len(out), err)
		}
		out = append(out, msg)
	}
	return out
}

func eventType(m eventstream.Message) string { return m.Headers.Get(":event-type").String() }

// @scenario "A streaming invoke hands on nlpgo's body as it arrives"
func TestInvokeStreamFramesNlpgoBody(t *testing.T) {
	s, _ := newStack(t, Config{})
	send(t, s, "POST", "/2015-03-31/functions", createBody)
	studio := strings.Replace(event, "/go/run", "/studio/execute", 1)
	rec := send(t, s, "POST", "/2021-11-15/functions/langwatch_nlp-p1/response-streaming-invocations", studio)
	if rec.Code != 200 || rec.Header().Get("Content-Type") != "application/vnd.amazon.eventstream" {
		t.Fatalf("stream answered %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	events := readEvents(t, rec.Body.Bytes())
	last := events[len(events)-1]
	if eventType(last) != "InvokeComplete" || string(last.Payload) != "{}" {
		t.Fatalf("last event %s %s", eventType(last), last.Payload)
	}
	var payload []byte
	for _, e := range events[:len(events)-1] {
		if eventType(e) != "PayloadChunk" {
			t.Fatalf("middle event %s", eventType(e))
		}
		payload = append(payload, e.Payload...)
	}
	status, body := splitPrelude(t, payload)
	if status != 200 || body != "data: frame 0\n\ndata: frame 1\n\ndata: frame 2\n\n" {
		t.Fatalf("stream status %d body %q", status, body)
	}
}

// @scenario "An invoke of an unknown function still runs"
func TestInvokeRegistersAnUnknownFunction(t *testing.T) {
	s, seen := newStack(t, Config{})
	rec := send(t, s, "POST", "/2015-03-31/functions/langwatch_nlp-gone/invocations", event)
	if rec.Code != 200 || seen.path != "/go/run" {
		t.Fatalf("unknown function invoke answered %d, nlpgo saw %+v", rec.Code, *seen)
	}
	if send(t, s, "GET", "/2015-03-31/functions/langwatch_nlp-gone", "").Code != 200 {
		t.Fatal("the invoked function was not registered")
	}
}

// @scenario "An operator forces a Lambda failure"
func TestForcedErrors(t *testing.T) {
	s, seen := newStack(t, Config{})
	for _, tc := range []struct {
		kind, errorType, functionError string
		status                         int
	}{
		{ErrorThrottled, "TooManyRequestsException", "", 429},
		{ErrorNotFound, "ResourceNotFoundException", "", 404},
		{ErrorFunctionError, "", "Unhandled", 200},
		{ErrorService, "ServiceException", "", 500},
	} {
		if rec := send(t, s, "PUT", "/_sim/api/settings", `{"forcedError":"`+tc.kind+`"}`); rec.Code != 200 {
			t.Fatalf("set %s answered %d", tc.kind, rec.Code)
		}
		*seen = nlpgoSeen{}
		rec := send(t, s, "POST", "/2015-03-31/functions/langwatch_nlp-p1/invocations", event)
		if rec.Code != tc.status || rec.Header().Get("X-Amzn-ErrorType") != tc.errorType || rec.Header().Get("X-Amz-Function-Error") != tc.functionError {
			t.Errorf("%s answered %d %q %q", tc.kind, rec.Code, rec.Header().Get("X-Amzn-ErrorType"), rec.Header().Get("X-Amz-Function-Error"))
		}
		if seen.path != "" {
			t.Errorf("%s reached nlpgo", tc.kind)
		}
	}
	if rec := send(t, s, "PUT", "/_sim/api/settings", `{"forcedError":"teapot"}`); rec.Code != 400 {
		t.Fatalf("an unknown forced error answered %d", rec.Code)
	}
	send(t, s, "PUT", "/_sim/api/settings", `{"forcedError":""}`)
	if rec := send(t, s, "POST", "/2015-03-31/functions/langwatch_nlp-p1/invocations", event); rec.Code != 200 || seen.path != "/go/run" {
		t.Fatalf("after reset answered %d, nlpgo saw %+v", rec.Code, *seen)
	}
}

// @scenario "An nlpgo that cannot be reached is a function error"
func TestUnreachableNlpgoIsAFunctionError(t *testing.T) {
	s, _ := newStack(t, Config{Target: "http://127.0.0.1:1"})
	rec := send(t, s, "POST", "/2015-03-31/functions/langwatch_nlp-p1/invocations", event)
	if rec.Code != 200 || rec.Header().Get("X-Amz-Function-Error") != "Unhandled" || !strings.Contains(rec.Body.String(), "errorMessage") {
		t.Fatalf("answered %d %q %s", rec.Code, rec.Header().Get("X-Amz-Function-Error"), rec.Body)
	}
	stream := send(t, s, "POST", "/2021-11-15/functions/langwatch_nlp-p1/response-streaming-invocations", event)
	events := readEvents(t, stream.Body.Bytes())
	if len(events) != 1 || eventType(events[0]) != "InvokeComplete" || !strings.Contains(string(events[0].Payload), `"ErrorCode":"Unhandled"`) {
		t.Fatalf("stream events %+v", events)
	}
}

func logs(t *testing.T, s *Server, op, body string) *httptest.ResponseRecorder {
	t.Helper()
	return send(t, s, "POST", "/", body, "X-Amz-Target", "Logs_20140328."+op, "Content-Type", "application/x-amz-json-1.1")
}

// @scenario "The CloudWatch log group calls are answered"
func TestLogGroups(t *testing.T) {
	s, _ := newStack(t, Config{})
	group := `{"logGroupName":"/aws/lambda/langwatch_nlp-p1","retentionInDays":365}`
	if rec := logs(t, s, "CreateLogGroup", group); rec.Code != 200 {
		t.Fatalf("create group answered %d", rec.Code)
	}
	if rec := logs(t, s, "CreateLogGroup", group); rec.Code != 400 || !strings.Contains(rec.Body.String(), "ResourceAlreadyExistsException") {
		t.Fatalf("second create group answered %d %s", rec.Code, rec.Body)
	}
	logs(t, s, "PutRetentionPolicy", group)
	var groups struct {
		LogGroups []struct{ LogGroupName string }
	}
	decode(t, logs(t, s, "DescribeLogGroups", `{"logGroupNamePrefix":"/aws/lambda/langwatch_nlp-"}`), &groups)
	if len(groups.LogGroups) != 1 {
		t.Fatalf("groups %+v", groups)
	}
	var streams struct {
		LogStreams []struct{ LastEventTimestamp int64 } `json:"logStreams"`
	}
	decode(t, logs(t, s, "DescribeLogStreams", group), &streams)
	if len(streams.LogStreams) != 0 {
		t.Fatalf("a function never invoked has streams %+v", streams)
	}
	send(t, s, "POST", "/2015-03-31/functions/langwatch_nlp-p1/invocations", event)
	decode(t, logs(t, s, "DescribeLogStreams", group), &streams)
	if len(streams.LogStreams) != 1 || streams.LogStreams[0].LastEventTimestamp == 0 {
		t.Fatalf("after an invoke streams %+v", streams)
	}
	if rec := logs(t, s, "DescribeLogStreams", `{"logGroupName":"/aws/lambda/nope"}`); !strings.Contains(rec.Body.String(), "ResourceNotFoundException") {
		t.Fatalf("unknown group answered %s", rec.Body)
	}
	logs(t, s, "DeleteLogGroup", group)
	decode(t, logs(t, s, "DescribeLogGroups", `{}`), &groups)
	if len(groups.LogGroups) != 0 {
		t.Fatalf("after delete groups %+v", groups)
	}
}

// @scenario "The console lists recent invocations"
func TestConsoleCalls(t *testing.T) {
	s, _ := newStack(t, Config{MaxCalls: 2, MaxBodyBytes: 8})
	for range 3 {
		send(t, s, "POST", "/2015-03-31/functions/langwatch_nlp-p1/invocations", event)
	}
	var list struct{ Calls []call }
	decode(t, send(t, s, "GET", "/_sim/api/calls", ""), &list)
	if len(list.Calls) != 2 || list.Calls[0].ID != "3" || list.Calls[0].Function != "langwatch_nlp-p1" ||
		list.Calls[0].Path != "/go/run" || list.Calls[0].Status != 201 || list.Calls[0].Request != "" {
		t.Fatalf("calls %+v", list.Calls)
	}
	var one call
	decode(t, send(t, s, "GET", "/_sim/api/calls/3", ""), &one)
	if !strings.HasPrefix(one.Request, `{"rawPat`) || !strings.Contains(one.Request, "cut at 8") || !strings.HasPrefix(one.Response, `{"ran":"`) {
		t.Fatalf("detail %+v", one)
	}
	if rec := send(t, s, "DELETE", "/_sim/api/calls", ""); rec.Code != 204 {
		t.Fatalf("clear answered %d", rec.Code)
	}
	send(t, s, "POST", "/2015-03-31/functions/langwatch_nlp-p1/invocations", event)
	decode(t, send(t, s, "GET", "/_sim/api/calls", ""), &list)
	if len(list.Calls) != 1 || list.Calls[0].ID != "4" {
		t.Fatalf("after clear %+v", list.Calls)
	}
	if rec := send(t, s, "GET", "/2015-03-31/functions/x/policy", ""); rec.Code != 404 {
		t.Fatalf("an unfaked Lambda path answered %d", rec.Code)
	}
}
