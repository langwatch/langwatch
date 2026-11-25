package voicesession

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"

	"github.com/coder/websocket"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// sidebandReadLimit caps one server event. Reflected audio arrives as base64
// frames, which are far larger than any event the supervisor keeps.
const sidebandReadLimit = 16 << 20

// errCallGone means the vendor no longer knows the call.
var errCallGone = errors.New("the vendor no longer has this call")

// EndpointFunc resolves a vendor path against a credential's own host.
type EndpointFunc func(cred domain.Credential, urlPath string) string

// OpenAIVendor reaches the OpenAI side of a brokered call: the server-side
// socket and the hangup route. It authenticates with the provider key.
type OpenAIVendor struct {
	client   *http.Client
	endpoint EndpointFunc
}

// NewOpenAIVendor builds the vendor client. The HTTP client must apply the
// endpoint policy at dial time and must not follow redirects.
func NewOpenAIVendor(client *http.Client, endpoint EndpointFunc) *OpenAIVendor {
	return &OpenAIVendor{client: client, endpoint: endpoint}
}

func (v *OpenAIVendor) attachURL(call domain.BrokeredVoiceSession) string {
	if call.Kind == domain.RealtimeKindLive {
		return v.endpoint(call.Credential, "/v1/live/sessions/"+url.PathEscape(call.VendorSessionID)+"/attach")
	}
	return v.endpoint(call.Credential, "/v1/realtime") + "?call_id=" + url.QueryEscape(call.VendorSessionID)
}

func (v *OpenAIVendor) hangupURL(call domain.BrokeredVoiceSession) string {
	if call.Kind == domain.RealtimeKindLive {
		return v.endpoint(call.Credential, "/v1/live/sessions/"+url.PathEscape(call.VendorSessionID)+"/hangup")
	}
	return v.endpoint(call.Credential, "/v1/realtime/calls/"+url.PathEscape(call.VendorSessionID)+"/hangup")
}

// Attach opens the server-side socket of a call. It answers errCallGone
// when the vendor refuses the call id as unknown.
func (v *OpenAIVendor) Attach(ctx context.Context, call domain.BrokeredVoiceSession) (*websocket.Conn, error) {
	header := http.Header{}
	header.Set("Authorization", "Bearer "+call.Credential.APIKey)
	//nolint:bodyclose // coder/websocket closes the handshake response body itself.
	conn, resp, err := websocket.Dial(ctx, v.attachURL(call), &websocket.DialOptions{
		HTTPClient: v.client,
		HTTPHeader: header,
	})
	if err != nil {
		if resp != nil && (resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone) {
			return nil, fmt.Errorf("%w: attach answered %d", errCallGone, resp.StatusCode)
		}
		return nil, err
	}
	conn.SetReadLimit(sidebandReadLimit)
	return conn, nil
}

// Hangup asks the vendor to end the call. A call the vendor no longer has
// is already over, so that answer is not an error.
func (v *OpenAIVendor) Hangup(ctx context.Context, call domain.BrokeredVoiceSession) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.hangupURL(call), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+call.Credential.APIKey)
	resp, err := v.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode == http.StatusNotFound || (resp.StatusCode >= 200 && resp.StatusCode < 300) {
		return nil
	}
	return fmt.Errorf("hangup answered %d", resp.StatusCode)
}
