package a2aproxy

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// sseRawReply streams each event exactly as given, blank line included.
func sseRawReply(events ...string) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, e := range events {
			_, _ = fmt.Fprint(w, e)
			w.(http.Flusher).Flush()
		}
	}
}

// artifactEvent is an A2A v1.0 artifact update as an SSE event with an id line.
func artifactEvent(sseID, artifactID, text string) string {
	data := fmt.Sprintf(`{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","contextId":"c1","append":true,`+
		`"artifact":{"artifactId":%q,"name":"answer","parts":[{"text":%q}]}}}}`, artifactID, text)
	return "event: message\nid: " + sseID + "\ndata: " + data + "\n\n"
}

func cardNumberStreamFixture(t *testing.T) *fixture {
	t.Helper()
	f := newFixture(t)
	f.bundle.Config.Guardrails.Post = []domain.GuardrailEntry{{ID: "g2"}}
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "card number"}}
	return f
}

// @scenario "a phrase split across streamed events is scanned whole with names and ids between them"
func TestSplitPhraseIsBlockedThroughArtifactNamesAndSSEFields(t *testing.T) {
	f := cardNumberStreamFixture(t)
	f.reply = sseRawReply(artifactEvent("1", "a1", "your card num"), artifactEvent("2", "a1", "ber 4111"))
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	chunks := strings.Split(strings.TrimSpace(rec.Body.String()), "\n\n")
	require.Len(t, chunks, 2, rec.Body.String())
	assert.Contains(t, chunks[0], "your card num")
	assert.Contains(t, chunks[1], `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), "4111")
}

// @scenario "text of artifacts streamed side by side is scanned per artifact"
func TestSplitPhraseIsBlockedWhenAnotherArtifactStreamsBetween(t *testing.T) {
	f := cardNumberStreamFixture(t)
	f.reply = sseRawReply(artifactEvent("1", "a1", "your card num"), artifactEvent("2", "a2", "a side note"),
		artifactEvent("3", "a1", "ber 4111"))
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	chunks := strings.Split(strings.TrimSpace(rec.Body.String()), "\n\n")
	require.Len(t, chunks, 3, rec.Body.String())
	assert.Contains(t, chunks[2], `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), "4111")
}

// @scenario "text of artifacts streamed side by side is scanned per artifact"
func TestTextOfTwoArtifactsIsNotJoinedIntoOnePhrase(t *testing.T) {
	f := cardNumberStreamFixture(t)
	f.reply = sseRawReply(artifactEvent("1", "a1", "your card"), artifactEvent("2", "a2", " number of items"))
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	assert.NotContains(t, rec.Body.String(), "a2a_content_blocked")
	assert.Contains(t, rec.Body.String(), "number of items")
}

// @scenario "a phrase split across streamed events is scanned whole with names and ids between them"
func TestSplitPhraseInStatusMessagesIsBlocked(t *testing.T) {
	f := cardNumberStreamFixture(t)
	status := `{"jsonrpc":"2.0","id":7,"result":{"statusUpdate":{"taskId":"t1","status":{"state":"TASK_STATE_WORKING",` +
		`"message":{"messageId":%q,"role":"ROLE_AGENT","parts":[{"text":%q}]}}}}}`
	f.reply = sseRawReply("id: 1\ndata: "+fmt.Sprintf(status, "m1", "your card num")+"\n\n",
		"id: 2\ndata: "+fmt.Sprintf(status, "m2", "ber 4111")+"\n\n")
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	assert.Contains(t, rec.Body.String(), `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), "4111")
}

// @scenario "a phrase split across streamed events is scanned whole with names and ids between them"
func TestBareStringStreamEventsAreScannedWithoutPanicking(t *testing.T) {
	f := cardNumberStreamFixture(t)
	f.reply = sseReply(`"your card num"`, `"ber 4111"`)
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	assert.Contains(t, rec.Body.String(), `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), "4111")
}

func TestStreamTailsAreBounded(t *testing.T) {
	var s streamText
	for i := range maxStreamTails + 10 {
		s.add(fmt.Sprintf("a%d", i), strings.Repeat("x", streamTailBytes+5))
	}
	assert.LessOrEqual(t, len(s.tails), maxStreamTails)
	for _, tail := range s.tails {
		assert.LessOrEqual(t, len(tail.text), streamTailBytes)
	}
}
