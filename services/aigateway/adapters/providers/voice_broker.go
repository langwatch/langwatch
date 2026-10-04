package providers

import (
	"bytes"
	"context"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"path"
	"strings"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Brokered voice calls. The gateway makes the vendor's call setup request
// itself, so it learns the call id and can attach its own server-side socket
// to meter and end the call. Media runs client to vendor over WebRTC.

const (
	openAILiveSessionsPath  = "/v1/live/sessions"
	openAIRealtimeCallsPath = "/v1/realtime/calls"
)

// VoiceHTTPClient is the client a voice supervisor dials the vendor with. It
// applies the endpoint policy at dial time and never follows a redirect, the
// same as the setup call.
func (r *BifrostRouter) VoiceHTTPClient() *http.Client {
	if r.realtimeClient != nil {
		return r.realtimeClient
	}
	return fallbackRealtimeClient(r.endpointPolicy)
}

// OpenAIVoiceEndpoint resolves an OpenAI voice path against the credential's
// own host, so the server-side socket reaches the region the call is in.
func OpenAIVoiceEndpoint(cred domain.Credential, urlPath string) string {
	return realtimeEndpoint(cred, openAIRealtimeDefaultBaseURL, urlPath)
}

func (r *BifrostRouter) dispatchVoiceBroker(
	ctx context.Context,
	req *domain.Request,
	cred domain.Credential,
) (*domain.Response, error) {
	switch req.RealtimeSession.Broker {
	case domain.RealtimeBrokerLive:
		return r.brokerOpenAILive(ctx, req, cred)
	case domain.RealtimeBrokerCall:
		return r.brokerOpenAIRealtimeCall(ctx, req, cred)
	default:
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"message": "unsupported voice broker " + string(req.RealtimeSession.Broker),
			"fault":   "gateway",
		})
	}
}

// brokerOpenAILive posts the caller's session and SDP offer to OpenAI Live
// and returns the answer verbatim. The session id in it is what the
// supervisor attaches to.
func (r *BifrostRouter) brokerOpenAILive(
	ctx context.Context,
	req *domain.Request,
	cred domain.Credential,
) (*domain.Response, error) {
	endpoint := realtimeEndpoint(cred, openAIRealtimeDefaultBaseURL, openAILiveSessionsPath)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(req.Body))
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"reason": err.Error()})
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+cred.APIKey)

	resp, err := r.doRealtimeMint(ctx, httpReq)
	if err != nil || resp.StatusCode >= 400 {
		return resp, err
	}
	resp.RealtimeConversationID = gjson.GetBytes(resp.Body, "session.id").String()
	if resp.RealtimeConversationID == "" {
		return nil, brokerAnswerWithoutID(ctx, "session.id")
	}
	resp.Body = withLangWatchSessionEcho(resp.Body, req.RealtimeSession.SessionID)
	return resp, nil
}

// brokerOpenAIRealtimeCall posts the SDP offer and the session declaration
// to OpenAI Realtime as multipart, and returns the SDP answer with the
// vendor's Location header, which carries the call id.
func (r *BifrostRouter) brokerOpenAIRealtimeCall(
	ctx context.Context,
	req *domain.Request,
	cred domain.Credential,
) (*domain.Response, error) {
	form, contentType, err := realtimeCallForm(req.RealtimeSession.SDP, gjson.GetBytes(req.Body, "session").Raw)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrInternal, herr.M{"reason": err.Error(), "fault": "gateway"})
	}
	endpoint := realtimeEndpoint(cred, openAIRealtimeDefaultBaseURL, openAIRealtimeCallsPath)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, form)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"reason": err.Error()})
	}
	httpReq.Header.Set("Content-Type", contentType)
	httpReq.Header.Set("Authorization", "Bearer "+cred.APIKey)

	resp, header, err := r.doRealtimeCall(ctx, httpReq)
	if err != nil || resp.StatusCode >= 400 {
		return resp, err
	}
	location := header.Get("Location")
	resp.RealtimeConversationID = realtimeCallID(location)
	if resp.RealtimeConversationID == "" {
		return nil, brokerAnswerWithoutID(ctx, "the Location header")
	}
	resp.Headers = map[string]string{"Content-Type": "application/sdp", "Location": location}
	return resp, nil
}

// realtimeCallForm builds the multipart body OpenAI's call route takes: the
// offer as application/sdp and the session as application/json.
func realtimeCallForm(sdp []byte, session string) (*bytes.Buffer, string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	parts := []struct {
		name, contentType string
		content           []byte
	}{
		{"sdp", "application/sdp", sdp},
		{"session", "application/json", []byte(session)},
	}
	for _, part := range parts {
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", `form-data; name="`+part.name+`"`)
		header.Set("Content-Type", part.contentType)
		w, err := writer.CreatePart(header)
		if err != nil {
			return nil, "", err
		}
		if _, err := w.Write(part.content); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return &body, writer.FormDataContentType(), nil
}

// realtimeCallID reads the call id off a Location such as
// /v1/realtime/calls/rtc_123.
func realtimeCallID(location string) string {
	location = strings.TrimSpace(location)
	if i := strings.IndexAny(location, "?#"); i >= 0 {
		location = location[:i]
	}
	id := path.Base(strings.TrimSuffix(location, "/"))
	if id == "." || id == "/" || id == "calls" {
		return ""
	}
	return id
}

// brokerAnswerWithoutID refuses a call the vendor created but did not name.
// The gateway could neither meter nor end it, so it is not handed out.
func brokerAnswerWithoutID(ctx context.Context, where string) error {
	return herr.New(ctx, domain.ErrProviderError, herr.M{
		"reason": "the provider created the call but its answer carried no id in " + where +
			", so the call cannot be metered and was not issued",
		"fault": "provider",
	})
}
