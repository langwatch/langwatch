package a2aproxy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"
	"unsafe"

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

// @scenario "a streamed event that fails the scan ends the stream"
func TestEventStreamMediaTypeIsReadInAnyCase(t *testing.T) {
	f := cardNumberStreamFixture(t)
	first := `{"jsonrpc":"2.0","id":7,"result":{"task":{"id":"t1","status":{"state":"TASK_STATE_WORKING"}}}}`
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "Text/Event-Stream; charset=utf-8")
		_, _ = fmt.Fprintf(w, "data: %s\n\ndata: %s\n\n", first, `{"result":{"message":{"parts":[{"text":"card number"}]}}}`)
	}
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	chunks := strings.Split(strings.TrimSpace(rec.Body.String()), "\n\n")
	require.Len(t, chunks, 2, rec.Body.String())
	assert.Equal(t, "data: "+first, chunks[0])
	assert.Contains(t, chunks[1], `"reason":"a2a_content_blocked"`)
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

	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "retry: "+ghToken+"\ndata: {\"result\":{}}\n\n")
	}
	rec = f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))
	assert.Contains(t, rec.Body.String(), `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), ghToken)
}

// artifactUpdate is an artifact update event whose append flag is set as given.
func artifactUpdate(artifactID, text string, appendText bool) string {
	return fmt.Sprintf(`{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","append":%t,`+
		`"artifact":{"artifactId":%q,"parts":[{"text":%q}]}}}}`, appendText, artifactID, text)
}

// @scenario "text of artifacts streamed side by side is scanned per artifact"
func TestArtifactThatReplacesItsTextStartsAFreshTail(t *testing.T) {
	f := cardNumberStreamFixture(t)
	f.reply = sseReply(artifactUpdate("a1", "your card", false), artifactUpdate("a1", " number of items", false))
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	assert.NotContains(t, rec.Body.String(), "a2a_content_blocked")
	assert.Contains(t, rec.Body.String(), "number of items")

	f.reply = sseReply(artifactUpdate("a1", "your card", false), artifactUpdate("a1", " number 4111", true))
	rec = f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))
	assert.Contains(t, rec.Body.String(), `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), "4111")
}

// chunkOnlyEvaluator is fakeEvaluator whose stream_chunk evaluation can fail.
type chunkOnlyEvaluator struct {
	fakeEvaluator
	chunkErr error
}

func (e chunkOnlyEvaluator) EvaluateChunk(ctx context.Context, b *domain.Bundle, r *domain.Request, chunk []byte) (domain.GuardrailVerdict, error) {
	if e.chunkErr != nil {
		return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, e.chunkErr
	}
	return e.fakeEvaluator.EvaluateChunk(ctx, b, r, chunk)
}

// @scenario "a key's stream_chunk guardrails judge every streamed event"
func TestStreamChunkGuardrailEndsTheStream(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.Guardrails.StreamChunk = []domain.GuardrailEntry{{ID: "g3"}}
	f.scanner = GuardrailScanner{Evaluator: chunkOnlyEvaluator{fakeEvaluator: fakeEvaluator{deny: "card number"}}}
	first := `{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","artifact":{"parts":[{"text":"hello"}]}}}}`
	f.reply = sseReply(first,
		`{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","artifact":{"parts":[{"text":"card number 4111"}]}}}}`)
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	chunks := strings.Split(strings.TrimSpace(rec.Body.String()), "\n\n")
	require.Len(t, chunks, 2, rec.Body.String())
	assert.Equal(t, "data: "+first, chunks[0])
	assert.Contains(t, chunks[1], `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), "4111")
}

// @scenario "a key's stream_chunk guardrails judge every streamed event"
func TestStreamChunkGuardrailFailureFailsOpen(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.Guardrails.StreamChunk = []domain.GuardrailEntry{{ID: "g3"}}
	f.scanner = GuardrailScanner{Evaluator: chunkOnlyEvaluator{chunkErr: errors.New("policy service slow")}}
	events := []string{
		`{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","artifact":{"parts":[{"text":"hello"}]}}}}`,
		`{"jsonrpc":"2.0","id":7,"result":{"statusUpdate":{"taskId":"t1","status":{"state":"TASK_STATE_COMPLETED"}}}}`,
	}
	f.reply = sseReply(events...)
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	assert.Equal(t, "data: "+events[0]+"\n\ndata: "+events[1]+"\n\n", rec.Body.String())
}

// @scenario "text of artifacts streamed side by side is scanned per artifact"
func TestFileOnlyReplacementClearsTheArtifactsText(t *testing.T) {
	f := cardNumberStreamFixture(t)
	fileOnly := `{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","append":false,` +
		`"artifact":{"artifactId":"a1","parts":[{"file":{"uri":"https://files.acme.test/r.pdf","mediaType":"application/pdf"}}]}}}}`
	f.reply = sseReply(artifactUpdate("a1", "your card", false), fileOnly, artifactUpdate("a1", " number of items", true))
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	assert.NotContains(t, rec.Body.String(), "a2a_content_blocked")
	assert.Contains(t, rec.Body.String(), "number of items")
}

// @scenario "a phrase split across streamed events is scanned whole"
func TestPhraseSplitAcrossTextPartsOfTheFirstEventIsBlocked(t *testing.T) {
	f := cardNumberStreamFixture(t)
	f.reply = sseReply(`{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1",` +
		`"artifact":{"artifactId":"a1","parts":[{"text":"your card"},{"text":" number 4111"}]}}}}`)
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	assert.Contains(t, rec.Body.String(), `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), "4111")
}

func TestStreamTailIsACopyOfTheTextItKeeps(t *testing.T) {
	var s streamText
	text := strings.Repeat("x", 4*streamTailBytes)
	s.add("a1", text)
	tail := s.tail("a1")
	require.Len(t, tail, streamTailBytes)
	start, kept := uintptr(unsafe.Pointer(unsafe.StringData(text))), uintptr(unsafe.Pointer(unsafe.StringData(tail)))
	assert.False(t, kept >= start && kept < start+uintptr(len(text)), "the tail shares the event text's memory")
}
