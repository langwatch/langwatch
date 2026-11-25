package voicesession

// The relay against the real vendors. Skipped unless LW_GATEWAY_RELAY_LIVE=1
// and the vendor's key are set: it spends a few tokens and characters.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// liveRelay serves one relayed socket to a real vendor host.
func liveRelay(t *testing.T, kind domain.RealtimeSessionKind, cred domain.Credential, call RelayCall) (*httptest.Server, *fakeRegistry) {
	t.Helper()
	registry := newFakeRegistry()
	hosts := map[domain.ProviderID]string{
		domain.ProviderOpenAI:     "https://api.openai.com",
		domain.ProviderElevenLabs: "https://api.elevenlabs.io",
	}
	manager := NewManager(Options{
		Registry:      registry,
		Vendor:        NewOpenAIVendor(&http.Client{Timeout: 15 * time.Second}, nil),
		RelayEndpoint: func(cred domain.Credential, path string) string { return hosts[cred.ProviderID] + path },
		DrainBudget:   time.Hour,
		Timing:        Timing{Tick: 200 * time.Millisecond, UsageInterval: 200 * time.Millisecond},
	})
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		slot, err := manager.Admit(r.Context(), kind)
		if err != nil {
			return
		}
		call.Ticket = &domain.VoiceRelayTicket{
			Session: domain.BrokeredVoiceSession{
				SessionID: "live_check", Kind: kind, Credential: cred,
				Bundle: &domain.Bundle{VirtualKeyID: "vk_1", ProjectID: "proj_1"},
			},
			Slot:    slot,
			Release: func(context.Context, string) { slot.Release() },
		}
		if err := manager.Relay(w, r, call); err != nil {
			t.Logf("the relay refused: %v", err)
			w.WriteHeader(http.StatusBadGateway)
		}
	}))
	t.Cleanup(gateway.Close)
	return gateway, registry
}

func requireLiveKey(t *testing.T, name string) string {
	t.Helper()
	key := os.Getenv(name)
	if os.Getenv("LW_GATEWAY_RELAY_LIVE") != "1" || key == "" {
		t.Skip("set LW_GATEWAY_RELAY_LIVE=1 and " + name + " to relay to the real vendor")
	}
	return key
}

func TestRelayAgainstOpenAIRealtime(t *testing.T) {
	key := requireLiveKey(t, "OPENAI_API_KEY")
	header := http.Header{}
	header.Set("Authorization", "Bearer "+key)
	gateway, registry := liveRelay(t, domain.RealtimeKindRealtime,
		domain.Credential{ID: "cred_1", ProviderID: domain.ProviderOpenAI, APIKey: key},
		RelayCall{Path: "/v1/realtime", RawQuery: "model=gpt-realtime-2.1-mini", Header: header})

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	client, _, err := websocket.Dial(ctx, gateway.URL, nil)
	require.NoError(t, err)
	defer func() { _ = client.CloseNow() }()
	client.SetReadLimit(relayReadLimit)

	require.NoError(t, client.Write(ctx, websocket.MessageText, []byte(
		`{"type":"response.create","response":{"output_modalities":["text"],"instructions":"Reply with the single word: pong"}}`)))
	var types []string
	for {
		_, frame, err := client.Read(ctx)
		require.NoError(t, err, "events so far: %v", types)
		eventType := gjson.GetBytes(frame, "type").String()
		types = append(types, eventType)
		if eventType == "error" {
			t.Fatalf("the vendor answered an error: %s", gjson.GetBytes(frame, "error.message").String())
		}
		if eventType == "response.done" {
			break
		}
	}
	report := registry.awaitReports(t, 1)[0]
	t.Logf("events relayed: %s", strings.Join(types, ", "))
	t.Logf("response.done usage observed: prompt=%d completion=%d cached=%d", report.Usage.PromptTokens,
		report.Usage.CompletionTokens, report.Usage.CacheReadTokens)
	assert.True(t, strings.HasPrefix(report.ReportKey, "resp_"), report.ReportKey)
	assert.Positive(t, report.Usage.PromptTokens+report.Usage.CompletionTokens)
	assert.Contains(t, types, "session.created")

	require.NoError(t, client.Close(websocket.StatusNormalClosure, ""))
	assert.True(t, registry.awaitReports(t, 2)[1].Final)
}

func TestRelayAgainstElevenLabsSpeech(t *testing.T) {
	key := requireLiveKey(t, "ELEVENLABS_API_KEY")
	header := http.Header{}
	header.Set("xi-api-key", key)
	gateway, registry := liveRelay(t, domain.RealtimeKindTTSSocket,
		domain.Credential{ID: "cred_1", ProviderID: domain.ProviderElevenLabs, APIKey: key},
		RelayCall{
			Path:     "/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM/stream-input",
			RawQuery: "model_id=eleven_flash_v2_5&output_format=mp3_22050_32",
			Header:   header, Count: CountSpeechChars, FirstFrame: StripSocketKeys,
		})

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	client, _, err := websocket.Dial(ctx, gateway.URL, nil)
	require.NoError(t, err)
	defer func() { _ = client.CloseNow() }()
	client.SetReadLimit(relayReadLimit)

	for _, frame := range []string{`{"text":" ","xi-api-key":"vk-not-a-real-key"}`, `{"text":"Hi. "}`, `{"text":""}`} {
		require.NoError(t, client.Write(ctx, websocket.MessageText, []byte(frame)))
	}
	audioFrames := 0
	for {
		_, frame, err := client.Read(ctx)
		if err != nil {
			t.Logf("the socket ended: close status %d", websocket.CloseStatus(err))
			break
		}
		if gjson.GetBytes(frame, "audio").String() != "" {
			audioFrames++
		}
		if gjson.GetBytes(frame, "isFinal").Bool() {
			_ = client.Close(websocket.StatusNormalClosure, "")
			break
		}
	}
	assert.Positive(t, audioFrames, "the vendor synthesized audio through the relay")
	reports := registry.awaitReports(t, 2)
	chars := 0
	for _, report := range reports {
		if report.Usage != nil {
			chars += report.Usage.InputChars
		}
	}
	t.Logf("audio frames relayed: %d, characters counted: %d", audioFrames, chars)
	assert.Equal(t, 5, chars)
}
