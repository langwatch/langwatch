package providers

import (
	"context"
	"errors"
	"strings"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func bfPtr[T any](v T) *T { return &v }

// The five failures production actually produced, taken verbatim from a week
// of gateway logs. Every one of them was reported to the client as HTTP 504
// "Gateway Timeout", attributed to the provider, retried across the whole
// credential chain and counted as a circuit-breaker failure — and not one of
// them was a timeout or fixable by a retry. This test is the incident.
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
	cause := errors.New("failed to parse auth credentials JSON: Syntax error at index 0")
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
	assert.Contains(t, e.Reasons[0].Error(), "Syntax error at index 0",
		"the detail that tells this apart from the other four token-source failures")
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

// IsBifrostError is Bifrost's own statement of who produced the error. Only a
// provider-produced one is an upstream response, and only an upstream response
// may be forwarded as one — a synthesized 504 or 499 is Bifrost talking about
// a request no provider ever answered.
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
// prose. Prose can be reworded in a dependency bump, which would silently drop
// every match back to the generic provider_error — so pin the constants to the
// Bifrost actually in go.mod and fail loudly if one moves.
func TestBifrostMessageConstantsStillMatchThePinnedBifrost(t *testing.T) {
	pinned := map[string]string{
		"network error":       bfschemas.ErrProviderNetworkError,
		"do request":          bfschemas.ErrProviderDoRequest,
		"request canceled":    bfschemas.ErrRequestCancelled,
		"request marshal":     bfschemas.ErrProviderRequestMarshal,
		"body conversion":     bfschemas.ErrRequestBodyConversion,
		"create request":      bfschemas.ErrProviderCreateRequest,
		"response decode":     bfschemas.ErrProviderResponseDecode,
		"response unmarshal":  bfschemas.ErrProviderResponseUnmarshal,
		"response empty":      bfschemas.ErrProviderResponseEmpty,
		"response html":       bfschemas.ErrProviderResponseHTML,
		"response decompress": bfschemas.ErrProviderResponseDecompress,
	}
	ours := []string{
		bfNetworkErrorMessage, bfDoRequestMessage, bfRequestCancelledMessage,
		bfRequestMarshalMessage, bfRequestBodyConversionMessage, bfCreateRequestMessage,
		bfResponseDecodeMessage, bfResponseUnmarshalMessage, bfResponseEmptyMessage,
		bfResponseHTMLMessage, bfResponseDecompressMessage,
	}

	for name, upstream := range pinned {
		t.Run("when bifrost's "+name+" message is read", func(t *testing.T) {
			matched := false
			for _, needle := range ours {
				if strings.Contains(strings.ToLower(upstream), strings.ToLower(needle)) {
					matched = true
					break
				}
			}
			assert.Truef(t, matched,
				"bifrost reworded %q — no rule in bfMessageRules matches it any more, so it would fall through to provider_error", upstream)
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
