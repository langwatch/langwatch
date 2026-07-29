package providers

import (
	"context"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// errFromBifrost is the single translation point from Bifrost's provider
// error type into the gateway's error taxonomy. This table pins, per
// provider, that the documented error responses keep their identity: the
// upstream HTTP status verbatim, and the provider's own error type/code
// (which the minimal envelope surfaces when the native body was not
// captured, i.e. on translated non-raw-forward lanes).
//
// Rows construct the BifrostError exactly as each provider adapter's parser
// does from the documented wire shapes.
//
// Spec: specs/ai-gateway/error-transparency.feature
func TestErrFromBifrost_ProviderTaxonomy(t *testing.T) {
	str := func(s string) *string { return &s }
	num := func(n int) *int { return &n }

	cases := []struct {
		name       string
		berr       *bfschemas.BifrostError
		wantStatus int
		wantType   string
		wantCode   string
	}{
		{
			// {"error":{"message":"You exceeded your current quota...","type":"insufficient_quota","code":"insufficient_quota"}}
			name: "openai 429 insufficient_quota",
			berr: &bfschemas.BifrostError{
				StatusCode: num(429),
				Error: &bfschemas.ErrorField{
					Type:    str("insufficient_quota"),
					Code:    str("insufficient_quota"),
					Message: "You exceeded your current quota, please check your plan and billing details.",
				},
			},
			wantStatus: 429,
			wantType:   "insufficient_quota",
			wantCode:   "insufficient_quota",
		},
		{
			// {"error":{"message":"Rate limit reached...","type":"requests","code":"rate_limit_exceeded"}}
			name: "openai 429 rate_limit_exceeded",
			berr: &bfschemas.BifrostError{
				StatusCode: num(429),
				Error: &bfschemas.ErrorField{
					Type:    str("requests"),
					Code:    str("rate_limit_exceeded"),
					Message: "Rate limit reached for gpt-5-mini",
				},
			},
			wantStatus: 429,
			wantType:   "requests",
			wantCode:   "rate_limit_exceeded",
		},
		{
			// {"error":{"message":"Incorrect API key provided...","type":"invalid_request_error","code":"invalid_api_key"}}
			name: "openai 401 invalid_api_key",
			berr: &bfschemas.BifrostError{
				StatusCode: num(401),
				Error: &bfschemas.ErrorField{
					Type:    str("invalid_request_error"),
					Code:    str("invalid_api_key"),
					Message: "Incorrect API key provided",
				},
			},
			wantStatus: 401,
			wantType:   "invalid_request_error",
			wantCode:   "invalid_api_key",
		},
		{
			// {"error":{"message":"The model `nope` does not exist...","type":"invalid_request_error","code":"model_not_found"}}
			name: "openai 404 model_not_found",
			berr: &bfschemas.BifrostError{
				StatusCode: num(404),
				Error: &bfschemas.ErrorField{
					Type:    str("invalid_request_error"),
					Code:    str("model_not_found"),
					Message: "The model `nope` does not exist or you do not have access to it.",
				},
			},
			wantStatus: 404,
			wantType:   "invalid_request_error",
			wantCode:   "model_not_found",
		},
		{
			// {"type":"error","error":{"type":"rate_limit_error","message":"..."}}
			name: "anthropic 429 rate_limit_error",
			berr: &bfschemas.BifrostError{
				StatusCode: num(429),
				Error: &bfschemas.ErrorField{
					Type:    str("rate_limit_error"),
					Message: "Number of request tokens has exceeded your per-minute rate limit",
				},
			},
			wantStatus: 429,
			wantType:   "rate_limit_error",
		},
		{
			// {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}
			name: "anthropic 529 overloaded_error",
			berr: &bfschemas.BifrostError{
				StatusCode: num(529),
				Error: &bfschemas.ErrorField{
					Type:    str("overloaded_error"),
					Message: "Overloaded",
				},
			},
			wantStatus: 529,
			wantType:   "overloaded_error",
		},
		{
			// {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}
			name: "anthropic 401 authentication_error",
			berr: &bfschemas.BifrostError{
				StatusCode: num(401),
				Error: &bfschemas.ErrorField{
					Type:    str("authentication_error"),
					Message: "invalid x-api-key",
				},
			},
			wantStatus: 401,
			wantType:   "authentication_error",
		},
		{
			// AWS JSON: {"message":"Too many requests..."} + x-amzn-ErrorType: ThrottlingException
			name: "bedrock 429 ThrottlingException",
			berr: &bfschemas.BifrostError{
				StatusCode: num(429),
				Error: &bfschemas.ErrorField{
					Type:    str("ThrottlingException"),
					Message: "Too many requests, please wait before trying again.",
				},
			},
			wantStatus: 429,
			wantType:   "ThrottlingException",
		},
		{
			name: "bedrock 400 ValidationException",
			berr: &bfschemas.BifrostError{
				StatusCode: num(400),
				Error: &bfschemas.ErrorField{
					Type:    str("ValidationException"),
					Message: "The provided model identifier is invalid.",
				},
			},
			wantStatus: 400,
			wantType:   "ValidationException",
		},
		{
			name: "bedrock 403 AccessDeniedException",
			berr: &bfschemas.BifrostError{
				StatusCode: num(403),
				Error: &bfschemas.ErrorField{
					Type:    str("AccessDeniedException"),
					Message: "You don't have access to the model with the specified model ID.",
				},
			},
			wantStatus: 403,
			wantType:   "AccessDeniedException",
		},
		{
			// A genuine provider outage keeps its 5xx class.
			name: "openai 500 server_error",
			berr: &bfschemas.BifrostError{
				StatusCode: num(500),
				Error: &bfschemas.ErrorField{
					Type:    str("server_error"),
					Message: "The server had an error while processing your request.",
				},
			},
			wantStatus: 500,
			wantType:   "server_error",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := errFromBifrost(context.Background(), tc.berr, map[string]string{"Retry-After": "13"})

			var ue *domain.UpstreamError
			require.ErrorAs(t, err, &ue, "a provider HTTP verdict must translate to UpstreamError, got %T", err)
			assert.Equal(t, tc.wantStatus, ue.StatusCode, "the provider's status class must be preserved")
			assert.Equal(t, tc.wantType, ue.ErrorType)
			assert.Equal(t, tc.wantCode, ue.ErrorCode)
			assert.Equal(t, tc.berr.Error.Message, ue.Message)
			assert.Equal(t, "13", ue.Headers["Retry-After"], "retry-signaling headers must ride along")
		})
	}
}

// A transport-level failure (no HTTP response at all) is the one case that
// legitimately maps to the gateway's own taxonomy rather than an upstream
// forward. Status zero must not fabricate an upstream status.
func TestErrFromBifrost_NoStatusFallsBackToClassification(t *testing.T) {
	err := errFromBifrost(context.Background(), &bfschemas.BifrostError{
		Error: &bfschemas.ErrorField{Message: "dial tcp: connection refused"},
	}, nil)

	var ue *domain.UpstreamError
	assert.NotErrorAs(t, err, &ue, "no upstream response means no UpstreamError to forward")
	require.Error(t, err)
}
