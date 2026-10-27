package providers

// The vendor hop of a brokered voice call: one REST request with the
// provider key, answered verbatim.
//
// Binds specs/ai-gateway/realtime-sessions.feature.

import (
	"context"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func openAIVoiceCredential(server *httptest.Server) domain.Credential {
	return domain.Credential{
		ID:         "openai_1",
		ProviderID: domain.ProviderOpenAI,
		APIKey:     "sk-provider-secret",
		Extra:      map[string]string{"base_url": server.URL},
	}
}

func liveBrokerRequest(body string) *domain.Request {
	return &domain.Request{
		Type:  domain.RequestTypeRealtimeSession,
		Model: "gpt-live",
		Body:  []byte(body),
		RealtimeSession: &domain.RealtimeSessionRequest{
			Vendor:    domain.RealtimeVendorOpenAI,
			Broker:    domain.RealtimeBrokerLive,
			SessionID: "req_abc",
		},
	}
}

func callBrokerRequest() *domain.Request {
	return &domain.Request{
		Type:  domain.RequestTypeRealtimeSession,
		Model: "gpt-realtime",
		Body:  []byte(`{"session":{"type":"realtime","model":"gpt-realtime","audio":{"output":{"voice":"marin"}}}}`),
		RealtimeSession: &domain.RealtimeSessionRequest{
			Vendor:    domain.RealtimeVendorOpenAI,
			Broker:    domain.RealtimeBrokerCall,
			SessionID: "req_abc",
			SDP:       []byte("v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n"),
		},
	}
}

// @scenario "A Live session is created with the provider key and answered verbatim"
func TestLiveBrokerPostsTheSessionAndEchoesTheAnswer(t *testing.T) {
	t.Parallel()

	const sent = `{"session":{"model":"gpt-live","voice":"marin"},"transport":{"type":"webrtc","sdp":"v=0 offer"}}`
	var gotPath, gotAuth, gotType, gotBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		gotPath, gotAuth, gotType, gotBody = r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("Content-Type"), string(body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"session":{"id":"live_123","model":"gpt-live"},"transport":{"type":"webrtc","sdp":"v=0 answer"}}`))
	}))
	defer server.Close()

	resp, err := realtimeRouter(server).dispatchRealtimeSession(
		context.Background(), liveBrokerRequest(sent), openAIVoiceCredential(server))
	require.NoError(t, err)

	assert.Equal(t, "/v1/live/sessions", gotPath)
	assert.Equal(t, "Bearer sk-provider-secret", gotAuth, "the vendor sees the provider key, never the virtual key")
	assert.Equal(t, "application/json", gotType)
	assert.JSONEq(t, sent, gotBody, "the caller's session reaches the vendor unchanged")
	assert.Equal(t, http.StatusCreated, resp.StatusCode, "the vendor's own status is kept")
	assert.Equal(t, "live_123", resp.RealtimeConversationID)
	assert.JSONEq(t,
		`{"session":{"id":"live_123","model":"gpt-live"},"transport":{"type":"webrtc","sdp":"v=0 answer"},"langwatch":{"session_id":"req_abc"}}`,
		string(resp.Body))
}

// @scenario "A Realtime call is created as multipart and its Location is returned"
func TestRealtimeCallBrokerPostsMultipartAndReturnsTheLocation(t *testing.T) {
	t.Parallel()

	const answer = "v=0\r\no=- 2 2 IN IP4 10.0.0.1\r\n"
	parts := map[string][2]string{}
	var gotPath, gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotAuth = r.URL.Path, r.Header.Get("Authorization")
		_, params, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		reader := multipart.NewReader(r.Body, params["boundary"])
		for {
			part, err := reader.NextPart()
			if err != nil {
				break
			}
			content, _ := io.ReadAll(part)
			parts[part.FormName()] = [2]string{part.Header.Get("Content-Type"), string(content)}
		}
		w.Header().Set("Content-Type", "application/sdp")
		w.Header().Set("Location", "/v1/realtime/calls/rtc_456")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(answer))
	}))
	defer server.Close()

	req := callBrokerRequest()
	resp, err := realtimeRouter(server).dispatchRealtimeSession(
		context.Background(), req, openAIVoiceCredential(server))
	require.NoError(t, err)

	assert.Equal(t, "/v1/realtime/calls", gotPath)
	assert.Equal(t, "Bearer sk-provider-secret", gotAuth)
	assert.Equal(t, "application/sdp", parts["sdp"][0])
	assert.Equal(t, string(req.RealtimeSession.SDP), parts["sdp"][1])
	assert.Equal(t, "application/json", parts["session"][0])
	assert.JSONEq(t, `{"type":"realtime","model":"gpt-realtime","audio":{"output":{"voice":"marin"}}}`, parts["session"][1])

	assert.Equal(t, http.StatusCreated, resp.StatusCode)
	assert.Equal(t, answer, string(resp.Body), "the SDP answer is returned byte for byte")
	assert.Equal(t, "rtc_456", resp.RealtimeConversationID)
	assert.Equal(t, "/v1/realtime/calls/rtc_456", resp.Headers["Location"])
	assert.Equal(t, "application/sdp", resp.Headers["Content-Type"])
}

func TestVoiceBrokerForwardsTheVendorsOwnError(t *testing.T) {
	t.Parallel()

	const refusal = `{"error":{"message":"Invalid SDP offer","type":"invalid_request_error"}}`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(refusal))
	}))
	defer server.Close()

	for name, req := range map[string]*domain.Request{
		"live": liveBrokerRequest(`{"session":{"model":"gpt-live"},"transport":{"type":"webrtc","sdp":"junk"}}`),
		"call": callBrokerRequest(),
	} {
		resp, err := realtimeRouter(server).dispatchRealtimeSession(
			context.Background(), req, openAIVoiceCredential(server))
		require.NoError(t, err, name)
		assert.Equal(t, http.StatusBadRequest, resp.StatusCode, name)
		assert.JSONEq(t, refusal, string(resp.Body), name)
		assert.Empty(t, resp.RealtimeConversationID, name)
	}
}

// @scenario "A call the vendor did not name is not handed out"
func TestVoiceBrokerRefusesAnAnswerWithNoID(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"session":{"model":"gpt-live"}}`))
	}))
	defer server.Close()

	for name, req := range map[string]*domain.Request{
		"live": liveBrokerRequest(`{"session":{"model":"gpt-live"},"transport":{"type":"webrtc","sdp":"v=0"}}`),
		"call": callBrokerRequest(),
	} {
		_, err := realtimeRouter(server).dispatchRealtimeSession(
			context.Background(), req, openAIVoiceCredential(server))
		require.Error(t, err, name)
		assert.True(t, herr.IsCode(err, domain.ErrProviderError), name)
	}
}

func TestRealtimeCallIDIsTheLastSegmentOfTheLocation(t *testing.T) {
	t.Parallel()

	for location, want := range map[string]string{
		"/v1/realtime/calls/rtc_456":                       "rtc_456",
		"https://api.openai.com/v1/realtime/calls/rtc_456": "rtc_456",
		"/v1/realtime/calls/rtc_456/":                      "rtc_456",
		"/v1/realtime/calls/rtc_456?x=1":                   "rtc_456",
		"/v1/realtime/calls":                               "",
		"":                                                 "",
	} {
		assert.Equal(t, want, realtimeCallID(location), location)
	}
}

func TestOpenAIVoiceEndpointFollowsTheCredentialsHost(t *testing.T) {
	t.Parallel()

	regional := domain.Credential{ProviderID: domain.ProviderOpenAI, Extra: map[string]string{"base_url": "https://eu.api.openai.com/v1"}}

	assert.Equal(t, "https://api.openai.com/v1/live/sessions/live_1/hangup",
		OpenAIVoiceEndpoint(domain.Credential{ProviderID: domain.ProviderOpenAI}, "/v1/live/sessions/live_1/hangup"))
	assert.Equal(t, "https://eu.api.openai.com/v1/realtime/calls/rtc_1/hangup",
		OpenAIVoiceEndpoint(regional, "/v1/realtime/calls/rtc_1/hangup"))
}
