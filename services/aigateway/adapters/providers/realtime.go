package providers

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Realtime voice session mints. The gateway makes exactly one bounded REST
// call per session, to the vendor's own mint endpoint, and forwards the
// answer verbatim. Nothing here holds a socket: the client dials the vendor
// with the credential this returns (ADR-097).

const (
	openAIRealtimeDefaultBaseURL     = "https://api.openai.com"
	elevenLabsRealtimeDefaultBaseURL = "https://api.elevenlabs.io"

	// openAIClientSecretsPath is OpenAI's own mint path, mirrored by the
	// gateway route so an OpenAI SDK pointed at the gateway needs no change.
	openAIClientSecretsPath = "/v1/realtime/client_secrets"
	// elevenLabsSignedURLPath mints a signed URL bound to one agent.
	elevenLabsSignedURLPath = "/v1/convai/conversation/get-signed-url"

	// realtimeMintTimeout bounds the mint call. It is a small REST request,
	// and a caller waiting on it is a person waiting to start talking.
	realtimeMintTimeout = 15 * time.Second

	// realtimeMintMaxResponseBytes caps what a mint answer may be. Both
	// vendors answer with a credential and a little metadata; anything at
	// this size is a wrong endpoint, not a session.
	realtimeMintMaxResponseBytes = 256 << 10
)

// OpenAI clamps its own ephemeral secret lifetime to between 10 seconds and
// two hours. The gateway clamps to the same window rather than forwarding a
// value OpenAI will reject, so a caller asking for a day gets the longest
// session it can have instead of a 400.
const (
	openAIExpiresAfterMinSeconds = 10
	openAIExpiresAfterMaxSeconds = 7200
)

// newRealtimeClient builds the mint client. Redirects are never followed:
// the mint carries the customer's provider key, and Go strips only
// Authorization across hosts, not the xi-api-key header ElevenLabs uses.
// Every resolved address is re-checked against the endpoint policy at dial
// time, so a customer base URL that resolves public and then private cannot
// slip past the pre-flight check.
func newRealtimeClient(policy customerEndpointPolicy) *http.Client {
	dialer := policyDialer(policy, realtimeMintTimeout)
	return &http.Client{
		Timeout:   realtimeMintTimeout,
		Transport: &http.Transport{DialContext: dialer.DialContext},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// fallbackRealtimeClient serves a zero-value router, which only tests build:
// NewBifrostRouter always sets realtimeClient. Built once, because a client
// per call is a connection pool per call.
//
// The policy is captured on first use. A zero-value router has no configured
// policy to differ on, so that is the same policy every time in practice.
var fallbackRealtimeClient = func() func(customerEndpointPolicy) *http.Client {
	var (
		once   sync.Once
		client *http.Client
	)
	return func(policy customerEndpointPolicy) *http.Client {
		once.Do(func() { client = newRealtimeClient(policy) })
		return client
	}
}()

// dispatchRealtimeSession mints one vendor session credential.
func (r *BifrostRouter) dispatchRealtimeSession(
	ctx context.Context,
	req *domain.Request,
	cred domain.Credential,
) (*domain.Response, error) {
	session := req.RealtimeSession
	if session == nil {
		return nil, herr.New(ctx, domain.ErrInternal, herr.M{
			"message": "realtime session dispatch reached the provider router with no session parameters",
		})
	}
	switch session.Vendor {
	case domain.RealtimeVendorOpenAI:
		return r.mintOpenAIClientSecret(ctx, req, cred)
	case domain.RealtimeVendorElevenLabs:
		return r.mintElevenLabsSignedURL(ctx, cred, session)
	default:
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"message": fmt.Sprintf("unsupported realtime session vendor %q", string(session.Vendor)),
			"fault":   "customer",
		})
	}
}

// mintOpenAIClientSecret posts the caller's session declaration to OpenAI's
// client_secrets endpoint and returns the ephemeral secret verbatim.
//
// The body is the caller's, forwarded as they wrote it apart from two edits:
// the resolved model was written back into session.model by the model
// resolver, and expires_after.seconds is clamped to the window OpenAI
// accepts. Everything else, including the voice, the tools, the turn
// detection and the audio formats, is theirs and reaches OpenAI untouched.
func (r *BifrostRouter) mintOpenAIClientSecret(
	ctx context.Context,
	req *domain.Request,
	cred domain.Credential,
) (*domain.Response, error) {
	body := clampOpenAIExpiry(req.Body)
	endpoint := realtimeEndpoint(cred, openAIRealtimeDefaultBaseURL, openAIClientSecretsPath)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"reason": err.Error()})
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+cred.APIKey)

	resp, err := r.doRealtimeMint(ctx, httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return resp, nil
	}
	// OpenAI mints a credential, not a conversation: no conversation id
	// exists until the socket opens, and it opens without us. This vendor's
	// session is closed by the usage report the caller posts back, keyed by
	// the LangWatch session id it is handed here.
	resp.Body = withLangWatchSessionEcho(resp.Body, req.RealtimeSession.SessionID)
	return resp, nil
}

// mintElevenLabsSignedURL asks ElevenLabs for a signed URL bound to one
// agent, and asks for the conversation id with it.
//
// include_conversation_id is always sent. Without it the vendor's post-call
// report is matched by guessing among the sessions open at the time, and two
// candidates in the same window is a miss rather than a coin flip. With it
// the exact id is known before the socket exists, so the match is a lookup.
//
// The id comes back inside the signed URL's own query string as
// conversation_id, not as a field of the JSON answer, which still holds only
// signed_url. Measured against the live API on 2026-08-16: with the flag the
// URL carries agent_id, conversation_signature and conversation_id; without
// it, only the first two.
func (r *BifrostRouter) mintElevenLabsSignedURL(
	ctx context.Context,
	cred domain.Credential,
	session *domain.RealtimeSessionRequest,
) (*domain.Response, error) {
	if session.AgentID == "" {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"message": "agent_id is required: an ElevenLabs signed URL is bound to one agent",
			"fault":   "customer",
		})
	}
	query := url.Values{}
	query.Set("agent_id", session.AgentID)
	query.Set("include_conversation_id", "true")
	endpoint := realtimeEndpoint(cred, elevenLabsRealtimeDefaultBaseURL, elevenLabsSignedURLPath) +
		"?" + query.Encode()

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"reason": err.Error()})
	}
	httpReq.Header.Set("xi-api-key", cred.APIKey)

	resp, err := r.doRealtimeMint(ctx, httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode >= 400 {
		return resp, nil
	}
	resp.RealtimeConversationID = elevenLabsConversationID(resp.Body)
	resp.Body = withLangWatchSessionEcho(resp.Body, session.SessionID)
	return resp, nil
}

// elevenLabsConversationID reads the conversation id out of a signed-URL
// answer. It sits in the URL's own query string rather than in the JSON
// body, so the body is read for the URL and the URL for the id. A top-level
// field is read first in case the vendor promotes it later.
func elevenLabsConversationID(body []byte) string {
	if id := gjson.GetBytes(body, "conversation_id").String(); id != "" {
		return id
	}
	signed := gjson.GetBytes(body, "signed_url").String()
	if signed == "" {
		return ""
	}
	parsed, err := url.Parse(signed)
	if err != nil {
		return ""
	}
	return parsed.Query().Get("conversation_id")
}

// doRealtimeMint performs the vendor call and shapes the answer. A vendor
// error is returned as a success-shaped Response carrying the upstream
// status and native body, the same contract the raw-forward lanes use, so
// the caller sees the vendor's own words.
func (r *BifrostRouter) doRealtimeMint(
	ctx context.Context,
	httpReq *http.Request,
) (*domain.Response, error) {
	client := r.realtimeClient
	if client == nil {
		client = fallbackRealtimeClient(r.endpointPolicy)
	}
	// The host can come from a customer-configured base URL, which is why
	// two checks bracket this call rather than one. Dispatch vets that URL
	// through the endpoint policy before reaching here, and this client's own
	// dialer re-checks every resolved address against the same policy
	// immediately before connecting, so a name that answers with a public
	// address and then a private one cannot slip through either.
	httpResp, err := client.Do(httpReq) //nolint:gosec // vetted by the endpoint policy at dispatch and again at dial time
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{
			"reason": "realtime session mint failed: " + err.Error(),
			"fault":  "provider",
		})
	}
	defer func() { _ = httpResp.Body.Close() }()

	// One byte past the cap, so a truncated answer is distinguishable from
	// one that exactly fills it. Forwarding a truncated body with the
	// vendor's 200 would hand the caller invalid JSON under a success
	// status, and the conversation-id read would silently find nothing.
	raw, err := io.ReadAll(io.LimitReader(httpResp.Body, realtimeMintMaxResponseBytes+1))
	if err != nil {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{
			"reason": "realtime session mint response could not be read: " + err.Error(),
			"fault":  "provider",
		})
	}
	if len(raw) > realtimeMintMaxResponseBytes {
		return nil, herr.New(ctx, domain.ErrProviderError, herr.M{
			"reason": fmt.Sprintf(
				"realtime session mint response exceeded %d bytes, which is a wrong endpoint rather than a session",
				realtimeMintMaxResponseBytes,
			),
			"fault": "provider",
		})
	}
	return &domain.Response{
		Body:       raw,
		StatusCode: httpResp.StatusCode,
		Headers:    forwardableUpstreamHeaders(headerMap(httpResp.Header)),
	}, nil
}

// realtimeEndpoint resolves the vendor host for this credential. A customer
// on a residency endpoint stores it as the provider's base URL, and minting
// against the default host would sign a session in the wrong region.
func realtimeEndpoint(cred domain.Credential, defaultBaseURL, path string) string {
	base := defaultBaseURL
	if configured := strings.TrimSpace(cred.Extra["base_url"]); configured != "" {
		base = configured
	}
	return strings.TrimSuffix(base, "/") + path
}

// clampOpenAIExpiry holds expires_after.seconds inside OpenAI's own bounds.
// A body that names no expiry is returned untouched, so OpenAI's default
// applies rather than one the gateway invented.
func clampOpenAIExpiry(body []byte) []byte {
	seconds := gjson.GetBytes(body, "expires_after.seconds")
	if !seconds.Exists() {
		return body
	}
	clamped := seconds.Int()
	switch {
	case clamped < openAIExpiresAfterMinSeconds:
		clamped = openAIExpiresAfterMinSeconds
	case clamped > openAIExpiresAfterMaxSeconds:
		clamped = openAIExpiresAfterMaxSeconds
	}
	if clamped == seconds.Int() {
		return body
	}
	out, err := sjson.SetBytes(body, "expires_after.seconds", clamped)
	if err != nil {
		return body
	}
	return out
}

// withLangWatchSessionEcho adds the LangWatch session id to the mint answer
// under its own key. The vendor's fields are untouched, so an SDK that reads
// signed_url keeps working, and a caller that wants the spend record's id
// can read it from the body instead of the response header.
func withLangWatchSessionEcho(body []byte, sessionID string) []byte {
	if sessionID == "" || !gjson.ParseBytes(body).IsObject() {
		return body
	}
	out, err := sjson.SetBytes(body, "langwatch.session_id", sessionID)
	if err != nil {
		return body
	}
	return out
}

// headerMap flattens an http.Header to the single-value map the response
// carries.
func headerMap(h http.Header) map[string]string {
	if len(h) == 0 {
		return nil
	}
	out := make(map[string]string, len(h))
	for k, vals := range h {
		if len(vals) > 0 {
			out[k] = vals[0]
		}
	}
	return out
}
