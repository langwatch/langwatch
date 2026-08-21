package httpapi

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/controlplane"
	"github.com/langwatch/langwatch/services/aigateway/app"
)

// recordingRelay captures what the handler hands the control plane, so a test
// can assert on the bytes rather than only on the status that came back.
type recordingRelay struct {
	gotBody      string
	gotSignature string
	gotProvider  string
	gotType      string
	answer       controlplane.WebhookRelayResult
	err          error
}

func (r *recordingRelay) ForwardElevenLabsWebhook(
	_ context.Context, relay controlplane.WebhookRelay,
) (controlplane.WebhookRelayResult, error) {
	body, _ := io.ReadAll(relay.Body)
	r.gotBody = string(body)
	r.gotSignature = relay.Signature
	r.gotProvider = relay.ModelProviderID
	r.gotType = relay.ContentType
	return r.answer, r.err
}

func webhookRouter(relay WebhookRelay) http.Handler {
	return NewRouter(RouterDeps{
		App:          app.New(app.WithLogger(zap.NewNop())),
		Logger:       zap.NewNop(),
		WebhookRelay: relay,
	})
}

// The body a real delivery carries: key order that no marshaller would
// reproduce, a unicode escape, and insignificant whitespace. The vendor's
// HMAC covers these exact bytes, so any of the three surviving the hop is
// what proves nothing re-encoded it.
const vendorBody = `{"type":"post_call_transcription", "data":{"conversation_id":"conv_1",` +
	`"metadata":{"call_duration_secs":3,"cost":24}},"zz_last":"é"}`

// @scenario The gateway relays a post-call delivery byte for byte
func TestElevenLabsWebhookRelaysTheDeliveryUnchanged(t *testing.T) {
	t.Parallel()

	relay := &recordingRelay{
		answer: controlplane.WebhookRelayResult{
			StatusCode: http.StatusOK,
			Body:       []byte(`{"received":true}`),
		},
	}
	req := httptest.NewRequest(http.MethodPost,
		"/v1/convai/webhook/mp_abc", strings.NewReader(vendorBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("ElevenLabs-Signature", "t=1780000000,v0=deadbeef")
	rec := httptest.NewRecorder()

	webhookRouter(relay).ServeHTTP(rec, req)

	// Byte equality, not a 200. A 200 could come back from a body that was
	// re-encoded and a signature the control plane recomputed, which is
	// exactly the failure this route exists to avoid.
	//
	//nolint:testifylint // JSONEq is the wrong assertion here by design: it
	// would pass on a re-encoded body, which is the one thing under test.
	assert.Equal(t, vendorBody, relay.gotBody)
	assert.Equal(t, "t=1780000000,v0=deadbeef", relay.gotSignature)
	assert.Equal(t, "mp_abc", relay.gotProvider)
	assert.Equal(t, "application/json", relay.gotType)
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"received":true}`, rec.Body.String())
}

// @scenario The gateway relays the control plane's own status
func TestElevenLabsWebhookRelaysTheAnswerStatus(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name   string
		status int
		body   string
	}{
		// 404 is what keeps provider ids unprobeable, and 401 is a real
		// signature failure. Both have to survive the hop as themselves.
		{name: "an unknown provider id", status: http.StatusNotFound, body: `{"error":"Webhook not configured"}`},
		{name: "a tampered body", status: http.StatusUnauthorized, body: `{"error":"Invalid signature"}`},
		{name: "a malformed payload", status: http.StatusBadRequest, body: `{"error":"Invalid payload"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			relay := &recordingRelay{
				answer: controlplane.WebhookRelayResult{
					StatusCode: tc.status,
					Body:       []byte(tc.body),
				},
			}
			req := httptest.NewRequest(http.MethodPost,
				"/v1/convai/webhook/mp_abc", strings.NewReader(vendorBody))
			rec := httptest.NewRecorder()

			webhookRouter(relay).ServeHTTP(rec, req)

			assert.Equal(t, tc.status, rec.Code)
			assert.JSONEq(t, tc.body, rec.Body.String())
		})
	}
}

// @scenario A webhook the gateway cannot relay answers 502
func TestElevenLabsWebhookAnswers502WhenTheControlPlaneIsUnreachable(t *testing.T) {
	t.Parallel()

	relay := &recordingRelay{err: io.ErrUnexpectedEOF}
	req := httptest.NewRequest(http.MethodPost,
		"/v1/convai/webhook/mp_abc", strings.NewReader(vendorBody))
	rec := httptest.NewRecorder()

	webhookRouter(relay).ServeHTTP(rec, req)

	// Deliberately not an acknowledgement. Telling the vendor a report
	// landed when it never left this process removes the only signal that
	// the relay is broken, and the reconciler bills the call either way.
	assert.Equal(t, http.StatusBadGateway, rec.Code)
}

// @scenario A delivery past the relay cap answers 413
func TestElevenLabsWebhookAnswers413OnAnOversizedDelivery(t *testing.T) {
	t.Parallel()

	relay := &recordingRelay{err: controlplane.ErrWebhookTooLarge}
	req := httptest.NewRequest(http.MethodPost,
		"/v1/convai/webhook/mp_abc", strings.NewReader(vendorBody))
	rec := httptest.NewRecorder()

	webhookRouter(relay).ServeHTTP(rec, req)

	// Not 502. An oversized delivery is the caller's shape rather than our
	// outage, and relaying a truncated one would fail its own HMAC and read
	// as a forgery.
	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
}

// @scenario The webhook route carries no virtual key
func TestElevenLabsWebhookNeedsNoVirtualKey(t *testing.T) {
	t.Parallel()

	relay := &recordingRelay{
		answer: controlplane.WebhookRelayResult{StatusCode: http.StatusOK, Body: []byte(`{}`)},
	}
	// No Authorization header at all. Every other route under /v1 answers
	// 401 without one; this caller is ElevenLabs and has no key to send.
	req := httptest.NewRequest(http.MethodPost,
		"/v1/convai/webhook/mp_abc", strings.NewReader(vendorBody))
	rec := httptest.NewRecorder()

	webhookRouter(relay).ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	//nolint:testifylint // byte equality on purpose, as above.
	assert.Equal(t, vendorBody, relay.gotBody)
}
