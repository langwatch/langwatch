package controlplane

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"
)

// ErrWebhookTooLarge is a delivery past the relay cap. It is answered 413
// rather than relayed, because a truncated body fails its own HMAC and would
// look like a forgery instead of an oversized report.
var ErrWebhookTooLarge = errors.New("the post-call delivery exceeds the relay size limit")

// Vendor webhook relay (ADR-097).
//
// The ElevenLabs post-call webhook is the URL a customer pastes into their own
// ElevenLabs dashboard, so it is customer-visible and it has to be reachable
// from the vendor's network. It is served on the gateway, which is public by
// design, rather than on the control plane, which is the admin surface and is
// often behind a VPN or an access proxy on a self-hosted install. Every
// customer-facing voice URL then sits on one host: both mints, the usage
// report, and this.
//
// The gateway does not verify the delivery and does not read it. The
// per-tenant secret lives in the control plane's database and the tenant comes
// from the path, so verification stays there and this is a byte-exact relay.

const (
	elevenLabsWebhookPath = "/api/elevenlabs/webhook/"

	// webhookRelayTimeout bounds the hop to the control plane. Longer than a
	// registry call, because nobody is waiting on it: the vendor's delivery
	// is asynchronous to the call it describes, and the work behind it is a
	// database read, an HMAC and a spend confirmation.
	webhookRelayTimeout = 10 * time.Second

	// webhookMaxRelayBytes caps a delivery. A post-call transcription for a
	// long conversation carries the whole transcript, which the control
	// plane does not read but does receive, so this is generous next to the
	// other bounds here.
	webhookMaxRelayBytes = 4 << 20

	// webhookMaxRelayResponseBytes caps the answer. It is an acknowledgement
	// or a small error object.
	webhookMaxRelayResponseBytes = 8 << 10
)

// WebhookRelay is one vendor delivery on its way to the control plane.
type WebhookRelay struct {
	// ModelProviderID names the tenant, and is the only part of the request
	// the gateway looks at. It is escaped into the path and never parsed.
	ModelProviderID string
	// Signature is the vendor's ElevenLabs-Signature header, passed through
	// exactly as received.
	Signature string
	// ContentType is the vendor's own, forwarded so the control plane's
	// body reader behaves identically to a direct delivery.
	ContentType string
	// Body is the raw request bytes. The HMAC covers exactly these, so
	// nothing in this path may re-encode them.
	Body io.Reader
}

// WebhookRelayResult is what the control plane answered.
type WebhookRelayResult struct {
	StatusCode int
	Body       []byte
}

// ForwardElevenLabsWebhook relays one post-call delivery to the control plane
// and hands back its answer unchanged.
//
// Byte-exact is the whole contract. The vendor signs the timestamp, a dot and
// the raw request bytes, so a JSON round trip here would reorder keys and
// every delivery would fail its own signature check. The body is carried
// through as opaque bytes and never parsed.
//
// The status is relayed unchanged too, which keeps two behaviors the control
// plane owns: 404 for a provider id with no webhook configured, so the ids
// cannot be probed, and 200 as a real acknowledgement rather than one this hop
// invented.
func (c *Client) ForwardElevenLabsWebhook(
	ctx context.Context,
	relay WebhookRelay,
) (WebhookRelayResult, error) {
	ctx, cancel := context.WithTimeout(ctx, webhookRelayTimeout)
	defer cancel()

	endpoint, err := url.JoinPath(
		c.baseURL, elevenLabsWebhookPath, url.PathEscape(relay.ModelProviderID))
	if err != nil {
		return WebhookRelayResult{}, err
	}
	// Read the delivery before sending it, rather than streaming the reader
	// straight through. Two reasons, both about the signature.
	//
	// A streamed body of unknown length goes out chunked with no
	// Content-Length, which is not the shape the vendor sent and not every
	// receiver in a customer's path handles it the same way. Reading first
	// makes the relayed request look exactly like a direct delivery.
	//
	// More importantly, io.LimitReader truncates in silence. A body cut at
	// the cap mid-stream would arrive well-formed at the HTTP level and fail
	// its own HMAC, which reads as a forged delivery rather than as an
	// oversized one. One byte past the cap tells the two apart.
	raw, err := io.ReadAll(io.LimitReader(relay.Body, webhookMaxRelayBytes+1))
	if err != nil {
		return WebhookRelayResult{}, err
	}
	if len(raw) > webhookMaxRelayBytes {
		return WebhookRelayResult{}, ErrWebhookTooLarge
	}
	req, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return WebhookRelayResult{}, err
	}
	// Only what the control plane needs to behave as though the vendor had
	// reached it directly. Nothing is added: no gateway signature, because
	// this hop vouches for nothing, and the delivery's own HMAC is what
	// authenticates it.
	if relay.ContentType != "" {
		req.Header.Set("Content-Type", relay.ContentType)
	}
	if relay.Signature != "" {
		req.Header.Set("ElevenLabs-Signature", relay.Signature)
	}
	c.setCommonHeaders(req)

	resp, err := c.client.Do(req)
	if err != nil {
		return WebhookRelayResult{}, err
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, webhookMaxRelayResponseBytes))
	return WebhookRelayResult{StatusCode: resp.StatusCode, Body: body}, nil
}
