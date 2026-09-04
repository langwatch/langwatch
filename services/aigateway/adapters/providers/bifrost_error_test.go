package providers

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func bfPtr[T any](v T) *T { return &v }

// The messages behind all 23 production provider_timeout events in the 7 days
// before this change, taken verbatim from the gateway's own logs. Each was
// answered 504, attributed to the provider, retried across the credential
// chain, and counted as a circuit-breaker failure. None is a timeout, and each
// repeats identically on retry.
// @scenario "An engine failure that never reached a provider is terminal, not a timeout"
func TestClassifyBifrostError_ProductionFailuresAreNotTimeouts(t *testing.T) {
	cases := []struct {
		name string
		berr *bfschemas.BifrostError
		want herr.Code
	}{
		{
			name: "a key that declares no such model",
			berr: &bfschemas.BifrostError{
				Error: &bfschemas.ErrorField{Message: "no keys found that support model: gemini-3.1-pro-preview"},
				ExtraFields: bfschemas.BifrostErrorExtraFields{
					Provider:       bfschemas.Vertex,
					ModelRequested: "gemini-3.1-pro-preview",
				},
			},
			want: domain.ErrProviderConfigInvalid,
		},
		{
			name: "a provider slot with no deployment map",
			berr: &bfschemas.BifrostError{
				IsBifrostError: false,
				Error:          &bfschemas.ErrorField{Message: "deployments not set"},
				ExtraFields:    bfschemas.BifrostErrorExtraFields{Provider: bfschemas.Azure},
			},
			want: domain.ErrProviderConfigInvalid,
		},
		{
			name: "an operation the provider does not implement",
			berr: &bfschemas.BifrostError{
				Error: &bfschemas.ErrorField{
					Message: "chat_completion is not supported by elevenlabs provider",
					Code:    bfPtr("unsupported_operation"),
				},
			},
			want: domain.ErrProviderConfigInvalid,
		},
		{
			name: "aws credentials the signer cannot retrieve",
			berr: &bfschemas.BifrostError{
				IsBifrostError: true,
				Error: &bfschemas.ErrorField{
					Message: "failed to retrieve aws credentials",
					Error:   errors.New("operation error STS: AssumeRole, https response error StatusCode: 403"),
				},
				ExtraFields: bfschemas.BifrostErrorExtraFields{Provider: bfschemas.Bedrock},
			},
			want: domain.ErrProviderCredentialInvalid,
		},
		{
			// The report that started this: gemini-2.5-flash on vertex_ai,
			// surfaced to the customer as provider_timeout with status 0.
			name: "a vertex service account that yields no token source",
			berr: &bfschemas.BifrostError{
				IsBifrostError: true,
				Error: &bfschemas.ErrorField{
					Message: "error creating auth token source",
					Error:   errors.New("invalid google auth credentials: missing 'type'"),
				},
				ExtraFields: bfschemas.BifrostErrorExtraFields{Provider: bfschemas.Vertex},
			},
			want: domain.ErrProviderCredentialInvalid,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := classifyBifrostError(context.Background(), tc.berr)

			assert.Truef(t, herr.IsCode(err, tc.want), "want %s, got %v", tc.want, err)
			assert.Falsef(t, herr.IsCode(err, domain.ErrProviderTimeout),
				"nothing here timed out, yet it was classified as one: %v", err)
		})
	}
}

// Only Bifrost's own timeout signals may produce provider_timeout, because the
// code is what tells a client to retry and the dispatcher to spend the chain.
// @scenario "A genuine timeout is still called a timeout"
func TestClassifyBifrostError_TimeoutSignals(t *testing.T) {
	t.Run("when bifrost stamps the request-timed-out type", func(t *testing.T) {
		berr := &bfschemas.BifrostError{
			IsBifrostError: true,
			StatusCode:     bfPtr(504),
			Error: &bfschemas.ErrorField{
				Type:    bfPtr(bfschemas.RequestTimedOut),
				Message: "Request timed out by context: context deadline exceeded",
			},
		}

		assert.True(t, herr.IsCode(classifyBifrostError(context.Background(), berr), domain.ErrProviderTimeout))
	})

	t.Run("when the timeout arrives only as prose", func(t *testing.T) {
		berr := &bfschemas.BifrostError{
			IsBifrostError: true,
			Error:          &bfschemas.ErrorField{Message: bfschemas.ErrProviderRequestTimedOut},
		}

		assert.True(t, herr.IsCode(classifyBifrostError(context.Background(), berr), domain.ErrProviderTimeout))
	})

	t.Run("when the caller hung up", func(t *testing.T) {
		berr := &bfschemas.BifrostError{
			IsBifrostError: true,
			StatusCode:     bfPtr(499),
			Error: &bfschemas.ErrorField{
				Type: bfPtr(bfschemas.RequestCancelled),
				//nolint:misspell // Bifrost's own wording, reproduced as it arrives.
				Message: "Request cancelled by context: context canceled",
			},
		}

		err := classifyBifrostError(context.Background(), berr)

		assert.True(t, herr.IsCode(err, domain.ErrRequestAbandoned))
		assert.False(t, herr.IsCode(err, domain.ErrProviderTimeout),
			"a caller leaving is not the provider being slow")
	})
}

// Bifrost's documented error taxonomy (authentication_error, rate_limit_error,
// invalid_request_error, network_error, ...) is the strongest signal available
// and is read before anything is inferred from the status.
// @scenario "An engine failure that never reached a provider is terminal, not a timeout"
func TestClassifyBifrostError_BifrostTaxonomy(t *testing.T) {
	cases := map[string]herr.Code{
		"authentication_error":  domain.ErrProviderCredentialRejected,
		"authorization_error":   domain.ErrProviderCredentialRejected,
		"rate_limit_error":      domain.ErrRateLimited,
		"invalid_request_error": domain.ErrBadRequest,
		"network_error":         domain.ErrProviderConnectionFailed,
	}

	for errType, want := range cases {
		t.Run("when bifrost reports "+errType, func(t *testing.T) {
			berr := &bfschemas.BifrostError{
				Error: &bfschemas.ErrorField{Type: bfPtr(errType), Message: "provider said no"},
			}

			assert.Truef(t, herr.IsCode(classifyBifrostError(context.Background(), berr), want),
				"want %s for %s", want, errType)
		})
	}
}

// A failure the gateway caused is ours, and saying so is what keeps it off the
// customer-fault line an operator ignores.
func TestClassifyBifrostError_RequestBuildFailuresArePlatformFaults(t *testing.T) {
	berr := &bfschemas.BifrostError{
		IsBifrostError: true,
		Error:          &bfschemas.ErrorField{Message: bfschemas.ErrProviderRequestMarshal},
	}

	assert.True(t, herr.IsCode(classifyBifrostError(context.Background(), berr), domain.ErrInternal))
}

// The whole point of the change: Bifrost's message is a category and the
// wrapped error underneath is the reason. "error creating auth token source"
// is the same sentence for a credential that is not JSON, one missing a "type"
// field, and an environment with no default credentials at all — three
// different fixes behind one string.
// @scenario "The engine's wrapped cause survives classification"
func TestClassifyBifrostError_CarriesTheWrappedCause(t *testing.T) {
	cause := errors.New("invalid google auth credentials: missing 'type'")
	berr := &bfschemas.BifrostError{
		IsBifrostError: true,
		Error: &bfschemas.ErrorField{
			Message: "error creating auth token source",
			Error:   cause,
		},
		ExtraFields: bfschemas.BifrostErrorExtraFields{Provider: bfschemas.Vertex},
	}

	err := classifyBifrostError(context.Background(), berr)

	var e herr.E
	require.ErrorAs(t, err, &e)
	require.Len(t, e.Reasons, 1, "the cause must survive as a reason")
	require.ErrorIs(t, e.Reasons[0], cause)
	assert.Contains(t, e.Reasons[0].Error(), "error creating auth token source",
		"the category and its cause read as one sentence")
	assert.Contains(t, e.Reasons[0].Error(), "missing 'type'",
		"the detail that tells this apart from the other five token-source failures")
}

// The one cause that must NOT be relayed. Bifrost wraps sonic's error here, and
// sonic's SyntaxError renders a window of the SOURCE it was parsing — which on
// this path is the pasted service-account document. A stray newline inside the
// PEM puts private-key bytes wherever the cause is written, and handledCause
// writes it to a log line.
func TestClassifyBifrostError_NeverQuotesACauseThatEmbedsItsInput(t *testing.T) {
	// Deliberately not shaped like real key material: a high-entropy base64
	// literal here is indistinguishable from a leak to the repo's secret
	// scanner, and the test only needs a marker that must not survive.
	privateKeyFragment := "private-key-bytes-that-must-not-be-relayed"
	berr := &bfschemas.BifrostError{
		IsBifrostError: true,
		Error: &bfschemas.ErrorField{
			Message: "error creating auth token source",
			Error: fmt.Errorf(
				"failed to parse auth credentials JSON: %q",
				`Syntax error at index 412: invalid char..."private_key": "-----BEGIN PRIVATE KEY-----\n`+
					privateKeyFragment+`"...`),
		},
		ExtraFields: bfschemas.BifrostErrorExtraFields{Provider: bfschemas.Vertex},
	}

	var e herr.E
	require.ErrorAs(t, classifyBifrostError(context.Background(), berr), &e)
	require.Len(t, e.Reasons, 1)
	reason := e.Reasons[0].Error()

	assert.NotContains(t, reason, privateKeyFragment,
		"credential material must not reach the reason, which is logged verbatim")
	assert.NotContains(t, reason, "BEGIN PRIVATE KEY")
	assert.Contains(t, reason, "failed to parse auth credentials JSON",
		"the operator still learns which failure it was")
	assert.Contains(t, reason, "bytes, not quoted",
		"and that a payload was withheld rather than absent")
}

// A provider body Bifrost could not read is the other unquotable cause: its
// HTML and unmarshal branches build the cause as errors.New(string(body)), and
// an edge page commonly reflects the request that produced it. upstreamReason,
// in the same package, already refuses to quote these when they arrive as a
// forwarded body; the cause must not be a second door into the same policy.
func TestClassifyBifrostError_NeverQuotesAnUnreadableProviderBody(t *testing.T) {
	reflected := `<html><body>Blocked: prompt=my patient's diagnosis is ...</body></html>`
	berr := &bfschemas.BifrostError{
		IsBifrostError: true,
		Error: &bfschemas.ErrorField{
			Message: bfResponseHTMLMessage,
			Error:   errors.New(reflected),
		},
	}

	var e herr.E
	require.ErrorAs(t, classifyBifrostError(context.Background(), berr), &e)
	require.Len(t, e.Reasons, 1)
	reason := e.Reasons[0].Error()

	assert.NotContains(t, reason, "patient")
	assert.NotContains(t, reason, "<html>")
	assert.Contains(t, reason, "bytes, not quoted")
}

// meta is the client contract. Bifrost's internal sentence can name a
// credential field, a parse offset or a host, so it rides as a reason and
// never as meta.
// @scenario "The engine's wrapped cause survives classification"
func TestClassifyBifrostError_CauseNeverLeaksIntoMeta(t *testing.T) {
	berr := &bfschemas.BifrostError{
		IsBifrostError: true,
		Error: &bfschemas.ErrorField{
			Message: "error creating auth token source",
			Error:   errors.New("failed to find default credentials in environment: metadata: GCE metadata \"instance/service-accounts/default/token\" not defined"),
		},
	}

	err := classifyBifrostError(context.Background(), berr)

	var e herr.E
	require.ErrorAs(t, err, &e)
	for key, value := range e.Meta {
		text, ok := value.(string)
		if !ok {
			continue
		}
		assert.NotContainsf(t, text, "metadata:", "meta[%s] leaked the internal cause", key)
	}
	assert.Contains(t, e.Meta["message"], "model provider settings",
		"the customer is told what to do, not what broke internally")
}

// @scenario "The engine's wrapped cause survives classification"
func TestClassifyBifrostError_StampsProviderAndModel(t *testing.T) {
	berr := &bfschemas.BifrostError{
		Error: &bfschemas.ErrorField{Message: "no keys found that support model: gpt-5.6-sol"},
		ExtraFields: bfschemas.BifrostErrorExtraFields{
			Provider:       bfschemas.OpenAI,
			ModelRequested: "gpt-5.6-sol",
		},
	}

	var e herr.E
	require.ErrorAs(t, classifyBifrostError(context.Background(), berr), &e)
	assert.Equal(t, "openai", e.Meta["provider"])
	assert.Equal(t, "gpt-5.6-sol", e.Meta["model"])
	assert.Contains(t, e.Meta["message"], "gpt-5.6-sol",
		"the customer is told which model their provider does not serve")
}

// meta is the client contract. Everything in it is rendered by
// features/errors/logic/presentation.ts, so a key nothing reads is a field the
// next reader has to check the browser for before they can delete it. The HTTP
// status was such a key: it is on the response, and nothing renders it here.
func TestClassifyBifrostError_MetaCarriesOnlyWhatTheClientRenders(t *testing.T) {
	berr := &bfschemas.BifrostError{
		StatusCode: bfPtr(503),
		Error:      &bfschemas.ErrorField{Message: bfNetworkErrorMessage},
		ExtraFields: bfschemas.BifrostErrorExtraFields{
			Provider: bfschemas.OpenAI,
		},
	}

	var e herr.E
	require.ErrorAs(t, classifyBifrostError(context.Background(), berr), &e)
	assert.NotContains(t, e.Meta, "status", "no consumer reads it; the response carries the status")
	for key := range e.Meta {
		assert.Contains(t, []string{"message", "provider", "model"}, key,
			"meta gained %q — name the consumer in presentation.ts or log it instead", key)
	}
}

// ModelRequested is whatever the caller put in the request body, and it is
// rendered into a sentence in the browser and written to a log line. Neither
// has a length of its own to fall back on.
func TestClassifyBifrostError_ClampsTheModelTheCallerSupplied(t *testing.T) {
	long := strings.Repeat("m", 4000)
	berr := &bfschemas.BifrostError{
		Error:       &bfschemas.ErrorField{Message: bfNetworkErrorMessage},
		ExtraFields: bfschemas.BifrostErrorExtraFields{ModelRequested: long},
	}

	var e herr.E
	require.ErrorAs(t, classifyBifrostError(context.Background(), berr), &e)
	model, ok := e.Meta["model"].(string)
	require.True(t, ok)
	assert.LessOrEqual(t, len(model), bfMaxMetaValue+len("..."))
	assert.NotEqual(t, long, model)
}

// The clamp cuts bytes, and the limit lands mid-character for any model id
// that is not ASCII. A cut rune is invalid UTF-8, which the JSON encoder
// answers with U+FFFD and a log pipeline may reject outright — so the value
// the customer sees to identify their own request would be corrupted by the
// truncation meant to bound it.
func TestClassifyBifrostError_ClampedModelStaysValidUTF8(t *testing.T) {
	// The ASCII prefix is what makes this a test. bfMaxMetaValue is 120, which
	// divides by both 3 (CJK) and 4 (emoji), so a string of only those runes
	// happens to land the cut on a boundary and a byte-slicing clamp passes.
	// Each prefix is sized to put byte 120 one byte inside the rune that
	// follows it.
	for name, long := range map[string]string{
		"CJK":   strings.Repeat("x", bfMaxMetaValue-1) + strings.Repeat("模", 200),
		"emoji": strings.Repeat("x", bfMaxMetaValue-2) + strings.Repeat("🚀", 200),
	} {
		t.Run(name, func(t *testing.T) {
			berr := &bfschemas.BifrostError{
				Error:       &bfschemas.ErrorField{Message: bfNetworkErrorMessage},
				ExtraFields: bfschemas.BifrostErrorExtraFields{ModelRequested: long},
			}

			var e herr.E
			require.ErrorAs(t, classifyBifrostError(context.Background(), berr), &e)
			model, ok := e.Meta["model"].(string)
			require.True(t, ok)

			assert.True(t, utf8.ValidString(model),
				"the clamp split a multibyte character: %q", model)
			assert.LessOrEqual(t, len(model), bfMaxMetaValue+len("..."),
				"backing up to a rune boundary must not exceed the byte limit")
			assert.NotEqual(t, long, model)
		})
	}
}

// The fallback copy must not relay Bifrost's own sentence. Its stream-read
// failure renders the Go net error verbatim, which names a cluster-internal
// address; the response-side messages describe a body the gateway could not
// read. Neither is the customer's to see, and both are already on the log line
// via faults.go#handledCause.
func TestClassifyBifrostError_UnrecognizedFailuresDoNotRelayEngineProse(t *testing.T) {
	berr := &bfschemas.BifrostError{
		Error: &bfschemas.ErrorField{
			Message: "Error reading stream: read tcp 10.42.0.7:52344->10.42.9.1:443: connection reset by peer",
		},
	}

	var e herr.E
	require.ErrorAs(t, classifyBifrostError(context.Background(), berr), &e)
	assert.Equal(t, domain.ErrProviderError, e.Code)
	message, _ := e.Meta["message"].(string)
	assert.NotContains(t, message, "10.42.", "an internal address must not reach the customer")
	assert.NotContains(t, message, "read tcp")
	assert.NotEmpty(t, message)
}

// Only a provider's own response may be forwarded as one. Bifrost states that
// with a status paired with no synthesized type: a 504/request_timed_out or a
// 499/RequestCancelled is Bifrost talking about a request no provider ever
// answered, and IsBifrostError does not answer the question either —
// bedrock.go:300 sets it on a real provider response whose body would not
// unmarshal.
// @scenario "An engine-produced error is never forwarded as a provider answer"
func TestErrFromBifrost_OnlyProviderAnswersBecomeUpstreamErrors(t *testing.T) {
	t.Run("when the provider answered", func(t *testing.T) {
		berr := &bfschemas.BifrostError{
			IsBifrostError: false,
			StatusCode:     bfPtr(429),
			Error:          &bfschemas.ErrorField{Message: "rate limit", Type: bfPtr("insufficient_quota")},
			ExtraFields:    bfschemas.BifrostErrorExtraFields{Provider: bfschemas.OpenAI},
		}

		var ue *domain.UpstreamError
		require.ErrorAs(t, errFromBifrost(context.Background(), berr, nil), &ue)
		assert.Equal(t, 429, ue.StatusCode)
		assert.Equal(t, "insufficient_quota", ue.ErrorType)
		assert.Equal(t, "openai", ue.Provider)
	})

	// Bedrock sets IsBifrostError TRUE on a real provider response whose error
	// body it could not unmarshal, and still carries the provider's status and
	// raw body. Reading that flag as "no provider answered" would collapse every
	// unparseable Bedrock 4xx into a generic 502 — the forwarding guarantee
	// broken for the provider whose error bodies parse least reliably.
	t.Run("when the provider answered but bifrost could not parse the body", func(t *testing.T) {
		berr := &bfschemas.BifrostError{
			IsBifrostError: true,
			StatusCode:     bfPtr(403),
			Error: &bfschemas.ErrorField{
				Message: bfschemas.ErrProviderResponseUnmarshal,
				Error:   errors.New("unexpected end of JSON input"),
			},
			ExtraFields: bfschemas.BifrostErrorExtraFields{
				Provider:    bfschemas.Bedrock,
				RawResponse: `{"__type":"AccessDeniedException"}`,
			},
		}

		var ue *domain.UpstreamError
		require.ErrorAs(t, errFromBifrost(context.Background(), berr, nil), &ue,
			"a real provider status must still be forwarded verbatim")
		assert.Equal(t, 403, ue.StatusCode)
		assert.Equal(t, "bedrock", ue.Provider)
	})

	t.Run("when bifrost synthesized the status itself", func(t *testing.T) {
		berr := &bfschemas.BifrostError{
			IsBifrostError: true,
			StatusCode:     bfPtr(504),
			Error:          &bfschemas.ErrorField{Type: bfPtr(bfschemas.RequestTimedOut), Message: "timed out"},
		}

		err := errFromBifrost(context.Background(), berr, nil)

		var ue *domain.UpstreamError
		assert.NotErrorAs(t, err, &ue, "no provider answered, so nothing may be forwarded as an answer")
		assert.True(t, herr.IsCode(err, domain.ErrProviderTimeout))
	})

	t.Run("when the caller hung up and bifrost synthesized a 499", func(t *testing.T) {
		berr := &bfschemas.BifrostError{
			IsBifrostError: true,
			StatusCode:     bfPtr(499),
			Error: &bfschemas.ErrorField{
				Type:    bfPtr(bfschemas.RequestCancelled),
				Message: "request canceled by context",
			},
		}

		err := errFromBifrost(context.Background(), berr, nil)

		var ue *domain.UpstreamError
		assert.NotErrorAs(t, err, &ue, "no provider answered 499; bifrost did")
		assert.True(t, herr.IsCode(err, domain.ErrRequestAbandoned))
	})
}

// Bifrost documents AllowFallbacks as nil-means-true; false is the engine
// saying no other credential will do better. Ignoring it spent the whole chain
// re-proving one terminal failure.
// @scenario "The engine's own refusal to fall over is honored"
func TestErrFromBifrost_HonorsBifrostFallbackRefusal(t *testing.T) {
	base := func(allow *bool) *bfschemas.BifrostError {
		return &bfschemas.BifrostError{
			IsBifrostError: false,
			StatusCode:     bfPtr(400),
			AllowFallbacks: allow,
			Error:          &bfschemas.ErrorField{Message: "terminal"},
		}
	}

	assert.False(t, domain.IsNoFallback(errFromBifrost(context.Background(), base(nil), nil)),
		"nil means fallbacks are allowed")
	assert.False(t, domain.IsNoFallback(errFromBifrost(context.Background(), base(bfPtr(true)), nil)))

	refused := errFromBifrost(context.Background(), base(bfPtr(false)), nil)
	assert.True(t, domain.IsNoFallback(refused))

	var ue *domain.UpstreamError
	require.ErrorAs(t, refused, &ue, "the client still sees the same forwarded error")
	assert.Equal(t, 400, ue.StatusCode)
}

// The message rules match on prose because Bifrost states these failures as
// prose. Two things can silently break that: a dependency bump rewording one
// of Bifrost's constants, or a rule being dropped from bfMessageRules. Either
// drops the match back to the generic provider_error.
//
// So this drives bfCodeForMessage — the function the classifier actually calls
// — with the constant off the Bifrost in go.mod, and asserts the code it
// produces. Matching needles against a second hand-written list instead would
// pass happily after a rule was deleted, because the list is not the rules.
func TestBifrostMessageConstantsStillMatchThePinnedBifrost(t *testing.T) {
	pinned := map[string]struct {
		upstream string
		code     herr.Code
	}{
		"network error":       {bfschemas.ErrProviderNetworkError, domain.ErrProviderConnectionFailed},
		"do request":          {bfschemas.ErrProviderDoRequest, domain.ErrProviderConnectionFailed},
		"request canceled":    {bfschemas.ErrRequestCancelled, domain.ErrRequestAbandoned},
		"request marshal":     {bfschemas.ErrProviderRequestMarshal, domain.ErrInternal},
		"body conversion":     {bfschemas.ErrRequestBodyConversion, domain.ErrInternal},
		"create request":      {bfschemas.ErrProviderCreateRequest, domain.ErrInternal},
		"response decode":     {bfschemas.ErrProviderResponseDecode, domain.ErrProviderError},
		"response unmarshal":  {bfschemas.ErrProviderResponseUnmarshal, domain.ErrProviderError},
		"response empty":      {bfschemas.ErrProviderResponseEmpty, domain.ErrProviderError},
		"response html":       {bfschemas.ErrProviderResponseHTML, domain.ErrProviderError},
		"response decompress": {bfschemas.ErrProviderResponseDecompress, domain.ErrProviderError},
	}

	for name, tc := range pinned {
		t.Run("when bifrost's "+name+" message is read", func(t *testing.T) {
			code, ok := bfCodeForMessage(tc.upstream)
			require.Truef(t, ok,
				"no rule in bfMessageRules matches %q any more — bifrost reworded it, or the rule was deleted. Either way it now falls through to provider_error", tc.upstream)
			assert.Equal(t, tc.code, code)
		})
	}
}

// Every rule needle must classify the message it was written for. A needle
// that matches nothing is a rule that silently does nothing.
func TestBifrostMessageRules_EveryNeedleClassifies(t *testing.T) {
	for _, rule := range bfMessageRules {
		t.Run("when the message contains "+rule.needle, func(t *testing.T) {
			code, ok := bfCodeForMessage("upstream said: " + rule.needle + " (detail)")
			require.True(t, ok)
			assert.Equal(t, rule.code, code)
		})
	}
}

func TestBfCodeForMessage_UnknownProseStaysGeneric(t *testing.T) {
	_, ok := bfCodeForMessage("something nobody has seen before")

	assert.False(t, ok, "an unrecognized message must not be forced into a specific code")
}
