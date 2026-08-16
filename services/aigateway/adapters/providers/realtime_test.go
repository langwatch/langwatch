package providers

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func realtimeRouter(server *httptest.Server) *BifrostRouter {
	return &BifrostRouter{realtimeClient: server.Client()}
}

func elevenLabsCredential(server *httptest.Server) domain.Credential {
	return domain.Credential{
		ID:         "eleven_1",
		ProviderID: domain.ProviderElevenLabs,
		APIKey:     "xi-secret",
		Extra:      map[string]string{"base_url": server.URL},
	}
}

// @scenario "An ElevenLabs signed URL is minted for a hosted agent"
func TestElevenLabsMintAsksForTheConversationIdAndReadsItBack(t *testing.T) {
	t.Parallel()

	var gotPath, gotQuery, gotKey string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotQuery, gotKey = r.URL.Path, r.URL.RawQuery, r.Header.Get("xi-api-key")
		w.Header().Set("Content-Type", "application/json")
		// The live vendor puts the conversation id in the URL's own query
		// string, not in the JSON body. Measured 2026-08-16.
		_, _ = w.Write([]byte(`{"signed_url":"wss://api.example/v1/convai/conversation?agent_id=agent_1&conversation_signature=cvtkn_x&conversation_id=conv_9"}`))
	}))
	defer server.Close()

	req := &domain.Request{
		Type:  domain.RequestTypeRealtimeSession,
		Model: domain.ElevenLabsConvAIModel,
		RealtimeSession: &domain.RealtimeSessionRequest{
			Vendor:    domain.RealtimeVendorElevenLabs,
			AgentID:   "agent_1",
			SessionID: "req_abc",
		},
	}
	resp, err := realtimeRouter(server).dispatchRealtimeSession(
		context.Background(), req, elevenLabsCredential(server))
	require.NoError(t, err)

	assert.Equal(t, "/v1/convai/conversation/get-signed-url", gotPath)
	assert.Contains(t, gotQuery, "agent_id=agent_1")
	assert.Contains(t, gotQuery, "include_conversation_id=true",
		"without the flag the vendor omits the id and the post-call report can only be guessed at")
	assert.Equal(t, "xi-secret", gotKey)

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "conv_9", resp.RealtimeConversationID)
	assert.Contains(t, string(resp.Body), `"signed_url"`,
		"the vendor's own answer is forwarded so an SDK parses it unchanged")
	assert.Contains(t, string(resp.Body), `"session_id":"req_abc"`)
}

// @scenario "A residency base URL on the credential is honoured"
func TestElevenLabsMintHonoursAResidencyBaseURL(t *testing.T) {
	t.Parallel()

	var reached bool
	residency := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		reached = true
		_, _ = w.Write([]byte(`{"signed_url":"wss://residency/x"}`))
	}))
	defer residency.Close()

	req := &domain.Request{
		Type: domain.RequestTypeRealtimeSession,
		RealtimeSession: &domain.RealtimeSessionRequest{
			Vendor:  domain.RealtimeVendorElevenLabs,
			AgentID: "agent_1",
		},
	}
	_, err := realtimeRouter(residency).dispatchRealtimeSession(
		context.Background(), req, elevenLabsCredential(residency))
	require.NoError(t, err)
	assert.True(t, reached, "a customer on a regional host must be minted there")
}

// @scenario "A signed-URL request without an agent_id is refused"
func TestElevenLabsMintRefusesAMissingAgentID(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Error("no provider may be called when the request names no agent")
	}))
	defer server.Close()

	req := &domain.Request{
		Type:            domain.RequestTypeRealtimeSession,
		RealtimeSession: &domain.RealtimeSessionRequest{Vendor: domain.RealtimeVendorElevenLabs},
	}
	_, err := realtimeRouter(server).dispatchRealtimeSession(
		context.Background(), req, elevenLabsCredential(server))
	require.Error(t, err)
}

func TestRealtimeMintForwardsTheVendorsOwnError(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"detail":{"message":"bad key"}}`))
	}))
	defer server.Close()

	req := &domain.Request{
		Type: domain.RequestTypeRealtimeSession,
		RealtimeSession: &domain.RealtimeSessionRequest{
			Vendor:  domain.RealtimeVendorElevenLabs,
			AgentID: "agent_1",
		},
	}
	resp, err := realtimeRouter(server).dispatchRealtimeSession(
		context.Background(), req, elevenLabsCredential(server))
	require.NoError(t, err)
	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	assert.Contains(t, string(resp.Body), "bad key",
		"the caller sees the vendor's own words, not a gateway paraphrase")
	assert.Empty(t, resp.RealtimeConversationID)
}

// @scenario "A session lifetime outside the vendor's own bounds is clamped"
func TestOpenAIMintClampsTheSessionLifetime(t *testing.T) {
	t.Parallel()

	var sent []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(buf)
		sent = buf
		_, _ = w.Write([]byte(`{"value":"ek_x","expires_at":1}`))
	}))
	defer server.Close()

	req := &domain.Request{
		Type: domain.RequestTypeRealtimeSession,
		Body: []byte(`{"session":{"type":"realtime","model":"gpt-realtime"},"expires_after":{"anchor":"created_at","seconds":86400}}`),
		RealtimeSession: &domain.RealtimeSessionRequest{
			Vendor:    domain.RealtimeVendorOpenAI,
			SessionID: "req_abc",
		},
	}
	cred := domain.Credential{
		ID:         "openai_1",
		ProviderID: domain.ProviderOpenAI,
		APIKey:     "sk-x",
		Extra:      map[string]string{"base_url": server.URL},
	}
	resp, err := realtimeRouter(server).dispatchRealtimeSession(context.Background(), req, cred)
	require.NoError(t, err)

	assert.Contains(t, string(sent), `"seconds":7200`,
		"OpenAI refuses anything over two hours, so the caller gets the longest session it can have")
	assert.Contains(t, string(resp.Body), `"session_id":"req_abc"`)
	assert.Empty(t, resp.RealtimeConversationID,
		"no conversation exists until the socket opens, and it opens without us")
}

// @scenario "An OpenAI ephemeral client secret is minted from the caller's session body"
func TestOpenAIMintForwardsTheCallersSessionBodyAndTheVendorsAnswer(t *testing.T) {
	t.Parallel()

	var sent []byte
	var gotAuth, gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth, gotPath = r.Header.Get("Authorization"), r.URL.Path
		sent, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"value":"ek_secret","expires_at":1786873895,` +
			`"session":{"type":"realtime","model":"gpt-realtime","voice":"verse"}}`))
	}))
	defer server.Close()

	// The caller's own declaration: instructions, tools and turn detection
	// are theirs and must reach OpenAI untouched.
	body := []byte(`{"session":{"type":"realtime","model":"gpt-realtime",` +
		`"instructions":"be brief","audio":{"output":{"voice":"verse"}}}}`)
	req := &domain.Request{
		Type: domain.RequestTypeRealtimeSession,
		Body: body,
		RealtimeSession: &domain.RealtimeSessionRequest{
			Vendor:    domain.RealtimeVendorOpenAI,
			SessionID: "req_abc",
		},
	}
	cred := domain.Credential{
		ID:         "openai_1",
		ProviderID: domain.ProviderOpenAI,
		APIKey:     "sk-x",
		Extra:      map[string]string{"base_url": server.URL},
	}

	resp, err := realtimeRouter(server).dispatchRealtimeSession(context.Background(), req, cred)
	require.NoError(t, err)

	assert.Equal(t, "/v1/realtime/client_secrets", gotPath, "OpenAI's own mint path")
	assert.Equal(t, "Bearer sk-x", gotAuth, "the customer's stored key, never the virtual key")
	assert.JSONEq(t, string(body), string(sent),
		"the session declaration reaches the vendor as the caller wrote it")

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Contains(t, string(resp.Body), `"value":"ek_secret"`,
		"the vendor's ephemeral secret comes back verbatim")
	assert.Contains(t, string(resp.Body), `"voice":"verse"`)
	assert.Contains(t, string(resp.Body), `"session_id":"req_abc"`,
		"with the LangWatch session id added beside it")
}

func TestOpenAIMintLeavesAnUnstatedExpiryAlone(t *testing.T) {
	t.Parallel()

	body := []byte(`{"session":{"type":"realtime","model":"gpt-realtime"}}`)
	assert.Equal(t, body, clampOpenAIExpiry(body),
		"a body naming no expiry keeps the vendor's own default rather than one we invented")
}

func TestElevenLabsConversationIDPrefersATopLevelField(t *testing.T) {
	t.Parallel()

	assert.Equal(t, "conv_top", elevenLabsConversationID(
		[]byte(`{"conversation_id":"conv_top","signed_url":"wss://x?conversation_id=conv_url"}`)),
		"a field the vendor promotes later wins over reading it out of the URL")
	assert.Empty(t, elevenLabsConversationID([]byte(`{"signed_url":"wss://x"}`)))
	assert.Empty(t, elevenLabsConversationID([]byte(`not json`)))
}
