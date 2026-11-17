package a2aproxy

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const ghToken = "ghp_" + "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5"

func secretsFixture(t *testing.T) *fixture {
	t.Helper()
	f := newFixture(t)
	f.bundle.Config.Guardrails.Pre = []domain.GuardrailEntry{{ID: "g1"}}
	f.bundle.Config.Guardrails.Post = []domain.GuardrailEntry{{ID: "g2"}}
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: ghToken}}
	return f
}

// @scenario "a phrase split across streamed events is scanned whole"
func TestTokenSplitAcrossStreamEventsIsBlocked(t *testing.T) {
	f := secretsFixture(t)
	event := `{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","append":true,"artifact":{"parts":[{"text":%q}]}}}}`
	f.reply = sseReply(fmt.Sprintf(event, "a"), fmt.Sprintf(event, ghToken[:12]), fmt.Sprintf(event, ghToken[12:]),
		fmt.Sprintf(event, "b"), fmt.Sprintf(event, "c"))
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	chunks := strings.Split(strings.TrimSpace(rec.Body.String()), "\n\n")
	require.Len(t, chunks, 3, rec.Body.String())
	assert.Contains(t, chunks[2], `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), ghToken[12:])
}

// @scenario "content outside text parts is scanned before the upstream"
func TestTokenOutsideTextPartsIsBlockedBeforeTheUpstream(t *testing.T) {
	file := base64.StdEncoding.EncodeToString([]byte("config: " + ghToken))
	for name, part := range map[string]string{
		"data part": `{"data":{"note":"` + ghToken + `"}}`,
		"file part": `{"raw":"` + file + `","filename":"a.txt","mediaType":"text/plain"}`,
		"metadata":  `{"text":"hi","metadata":{"k":"` + ghToken + `"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			f := secretsFixture(t)
			body := `{"jsonrpc":"2.0","id":7,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[` + part + `]}}}`
			rec := f.do(http.MethodPost, "/a2a/billing", body)
			_, reason, _ := rpcError(t, rec)
			assert.Equal(t, "a2a_content_blocked", reason)
			assert.Empty(t, f.upstreamCalls())
		})
	}
}

// @scenario "a JSON-RPC method that is not an A2A method is refused"
func TestUnknownJSONRPCMethodIsRefusedBeforeTheUpstream(t *testing.T) {
	f := newFixture(t)
	rec := f.do(http.MethodPost, "/a2a/billing", `{"jsonrpc":"2.0","id":7,"method":"admin/drop_all"}`)
	code, reason, _ := rpcError(t, rec)
	assert.Equal(t, -32601, code)
	assert.Equal(t, "a2a_operation_not_supported", reason)
	assert.Empty(t, f.upstreamCalls())

	rec = f.do(http.MethodPost, "/a2a/billing", `{"jsonrpc":"2.0","id":7,"method":"message/send","params":{}}`)
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

// @scenario "the query string of the upstream URL stays after the forwarded path"
func TestUpstreamQueryStringStaysAfterThePath(t *testing.T) {
	f := newFixture(t)
	var gotURI string
	f.reply = func(w http.ResponseWriter, r *http.Request) {
		gotURI = r.URL.RequestURI()
		_, _ = io.WriteString(w, `{}`)
	}
	f.setTarget(func(tg *domain.A2ATarget) { tg.UpstreamURL = f.upstream.URL + "/?tenant=7" })
	rec := f.do(http.MethodPost, "/a2a/billing/message:send?x=1", `{"message":{"parts":[{"text":"hi"}]}}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "/message:send?tenant=7&x=1", gotURI)
}

// @scenario "the Agent Card lists only the endpoint the gateway serves"
func TestCardAdvertisesOnlyTheServedEndpointAndV02PathWorks(t *testing.T) {
	f := newFixture(t)
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		base := f.upstream.URL + "/a2a"
		_, _ = fmt.Fprintf(w, `{"url":%q,"supportedInterfaces":[{"url":%q},{"url":%q}]}`, base+"/v1", base, base+"/v1")
	}
	rec := f.do(http.MethodGet, "/a2a/billing/.well-known/agent.json", "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.JSONEq(t, `{"url":"http://gw.acme.test/a2a/billing","supportedInterfaces":[{"url":"http://gw.acme.test/a2a/billing"}]}`, rec.Body.String())
}

// @scenario "a path refusal says the path is not allowed"
func TestUnsafePathSaysThePathIsRefused(t *testing.T) {
	f := newFixture(t)
	rec := f.do(http.MethodPost, "/a2a/billing/a%2Fb/message:send", `{}`)
	assert.Contains(t, rec.Body.String(), `"message":"the A2A path is not allowed"`)
}

// @scenario "a stream line that is not an SSE data, event, id or retry field never reaches the caller"
func TestStreamLineWithoutDataPrefixNeverReachesTheCaller(t *testing.T) {
	f := secretsFixture(t)
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, ": "+ghToken+"\n"+ghToken+"\ndata: {\"result\":{}}\n\n")
	}
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))
	assert.Equal(t, "data: {\"result\":{}}\n\n", rec.Body.String())

	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "id: "+ghToken+"\ndata: {\"result\":{}}\n\n")
	}
	rec = f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))
	assert.Contains(t, rec.Body.String(), `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), ghToken)
}
