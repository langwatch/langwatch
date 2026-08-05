package otelrelay

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/pkg/herr"
)

// The in-stream error event exactly as the gateway forwards it (a verbatim
// OpenAI Responses quota failure on a 200-established stream).
const quotaErrorEvent = `{"type":"error","error":{"type":"insufficient_quota","code":"insufficient_quota","message":"You exceeded your current quota, please check your plan and billing details.","param":null},"sequence_number":2}`

// sseStreamGateway answers every call 200 text/event-stream with the given
// frames.
func sseStreamGateway(t *testing.T, frames *string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(*frames))
	}))
}

const quotaFailingStream = "event: response.created\n" +
	`data: {"type":"response.created","sequence_number":0}` + "\n\n" +
	"event: error\n" +
	"data: " + quotaErrorEvent + "\n\n"

const cleanStream = "event: response.created\n" +
	`data: {"type":"response.created","sequence_number":0}` + "\n\n" +
	"event: response.completed\n" +
	`data: {"type":"response.completed","sequence_number":1}` + "\n\n" +
	"data: [DONE]\n\n"

// @scenario "A hard limit delivered inside a 200 stream is cut like a rejected call"
func TestLLMProxyStreamCut_InStreamHardLimit(t *testing.T) {
	frames := quotaFailingStream
	gateway := sseStreamGateway(t, &frames)
	defer gateway.Close()

	relay := startRelay(t)
	token, _ := relay.Register(WorkerInfo{ConversationID: "conv-stream-quota", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})

	// First call: the 200 stream passes through UNTOUCHED, the worker's SDK
	// must receive the provider's own frames, error event included.
	first := rateLimitCall(t, relay, token)
	if first.StatusCode != http.StatusOK {
		t.Fatalf("first call answered %d, want the 200 stream passed through", first.StatusCode)
	}
	firstBody, _ := io.ReadAll(first.Body)
	if string(firstBody) != quotaFailingStream {
		t.Errorf("stream was altered in flight:\n got %s\nwant %s", firstBody, quotaFailingStream)
	}

	// The capture names the real cause for the turn's terminal error frame.
	e, ok := relay.LastLLMError(token)
	if !ok {
		t.Fatal("an in-stream error event must leave a captured cause")
	}
	// The provider's prose stays out of the frame. OpenAI's quota body sets
	// type == code, the exact shape isGatewayEnvelope reads as the gateway's
	// own, so this event used to decode "typed" and carry its sentence through
	// as though we had written it. The sniffer now decodes provider-native
	// outright (see decodeProviderErrorBody): an error event inside a 200
	// stream is never our envelope.
	if _, hasMessage := e.Meta["message"]; hasMessage {
		t.Errorf("captured message = %v, want the provider's prose dropped", e.Meta["message"])
	}
	// The discriminant is what survives, and it is all the panel needs.
	hasDiscriminant := e.Code == "insufficient_quota"
	for _, reason := range e.Reasons {
		var cause herr.E
		if errors.As(reason, &cause) && cause.Code == "insufficient_quota" {
			hasDiscriminant = true
		}
	}
	if !hasDiscriminant {
		t.Errorf("captured code = %q, reasons = %v, want the insufficient_quota discriminant", e.Code, e.Reasons)
	}

	// The SDK's retry is answered terminally with the provider's payload.
	second := rateLimitCall(t, relay, token)
	if second.StatusCode != http.StatusBadRequest {
		t.Fatalf("retry after in-stream hard limit answered %d, want 400: the SDK must not re-open the same dying stream", second.StatusCode)
	}
	secondBody, _ := io.ReadAll(second.Body)
	if !strings.Contains(string(secondBody), "insufficient_quota") ||
		!strings.Contains(string(secondBody), "exceeded your current quota") {
		t.Errorf("cut body must carry the provider's own error payload, got %s", secondBody)
	}
}

// @scenario "A clean stream clears the in-stream failure capture"
func TestLLMProxyStreamCut_CleanStreamClears(t *testing.T) {
	frames := cleanStream
	gateway := sseStreamGateway(t, &frames)
	defer gateway.Close()

	relay := startRelay(t)
	token, _ := relay.Register(WorkerInfo{ConversationID: "conv-stream-clean", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})

	resp := rateLimitCall(t, relay, token)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("clean stream answered %d, want 200", resp.StatusCode)
	}
	_, _ = io.ReadAll(resp.Body)

	if _, ok := relay.LastLLMError(token); ok {
		t.Error("a clean stream must not leave a captured cause")
	}

	// A failing stream latches the cut, the cut fires once, and the clean
	// stream after it clears every trace of the failure.
	frames = quotaFailingStream
	failing := rateLimitCall(t, relay, token)
	_, _ = io.ReadAll(failing.Body)
	frames = cleanStream

	cut := rateLimitCall(t, relay, token)
	if cut.StatusCode != http.StatusBadRequest {
		t.Fatalf("armed cut answered %d, want 400", cut.StatusCode)
	}
	_, _ = io.ReadAll(cut.Body)

	// The cut is consumed: the next call proxies again and streams clean.
	cleanPass := rateLimitCall(t, relay, token)
	if cleanPass.StatusCode != http.StatusOK {
		t.Fatalf("call after the cut answered %d, want the clean 200 stream proxied", cleanPass.StatusCode)
	}
	_, _ = io.ReadAll(cleanPass.Body)

	if _, ok := relay.LastLLMError(token); ok {
		t.Error("the clean stream must clear the captured cause")
	}
	final := rateLimitCall(t, relay, token)
	if final.StatusCode != http.StatusOK {
		t.Fatalf("call after a clean stream answered %d, want 200: the capture must be cleared", final.StatusCode)
	}
	_, _ = io.ReadAll(final.Body)
}
