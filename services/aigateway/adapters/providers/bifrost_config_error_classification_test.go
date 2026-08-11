package providers

import (
	"context"
	"errors"
	"net/http"
	"testing"

	bfproviderutils "github.com/maximhq/bifrost/core/providers/utils"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// classifyBifrostError is the only translation point for a Bifrost error that
// carries no HTTP status, because no HTTP call was ever made. Its switch used
// to treat status 0 as a gateway timeout, which mislabelled every
// configuration rejection the vendor raises before dialing — a permanent,
// operator-fixable fault that then read to the client as a transient upstream
// timeout.
//
// Rows mirror the vendor's own error constructions — its constructors where
// there is one, its hand-built literal where there is not — so the shapes stay
// honest against the pinned core@v1.4.22.
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature

// codeOf reads the domain code off a herr error.
func codeOf(t *testing.T, err error) herr.Code {
	t.Helper()
	var e herr.E
	require.ErrorAs(t, err, &e, "expected a herr.E, got %T: %v", err, err)
	return e.Code
}

// AC16 / AC18b: no status-less Bifrost error is a timeout, and each one lands
// on a NAMED code rather than merely "something other than a timeout". None of
// these shapes involves a network round trip, so labeling any of them
// provider_timeout is wrong on its face — and before the fix the status-0
// branch did exactly that for every one of them.
//
// Each row states the exact code it must land on, because the codes are not
// interchangeable: provider_error is retryable and would walk the whole
// credential chain re-raising a fault no retry can clear, which is the failure
// this change exists to stop. A negative-only assertion cannot tell the two
// apart. The discriminator is statuslessBifrostCode's shape test (nil
// Error.Error AND nil Error.Code), so the row's construction decides its code.
//
// The code -> HTTP status half of AC16/AC18b is client-facing and lives in
// adapters/httpapi/azure_config_error_status_test.go.
//
// @scenario "A configuration error carrying no status code is not classified as a timeout"
// @scenario "The remaining status-less error shapes are classified deliberately"
func TestClassifyBifrostError_StatuslessShapesAreNotTimeouts(t *testing.T) {
	cases := []struct {
		name string
		berr *bfschemas.BifrostError
		want herr.Code
	}{
		{
			// AC16: the exact error the Azure provider raises when the
			// deployment map never arrived (azure.go validateKeyConfig).
			// Rejected before anything was attempted, so it is permanent and
			// operator-fixable: misconfigured, never the retryable code.
			name: "azure configuration error: deployments not set",
			berr: bfproviderutils.NewConfigurationError("deployments not set", bfschemas.Azure),
			want: domain.ErrProviderMisconfigured,
		},
		{
			// Same constructor, different cause — the fix must key on the
			// error's shape, not on one message.
			name: "azure configuration error: endpoint not set",
			berr: bfproviderutils.NewConfigurationError("endpoint not set", bfschemas.Azure),
			want: domain.ErrProviderMisconfigured,
		},
		{
			// AC18b: the request type is not served by this provider. Carries
			// the vendor's own Error.Code, so it stays on the retryable code:
			// the next credential in the chain may serve the type.
			name: "unsupported operation",
			berr: bfproviderutils.NewUnsupportedOperationError(bfschemas.EmbeddingRequest, bfschemas.Anthropic),
			want: domain.ErrProviderError,
		},
		{
			// AC18b: an attempt that failed short of a response, carrying the
			// Go error it failed on. Retryable for the same reason.
			name: "bifrost operation error",
			berr: bfproviderutils.NewBifrostOperationError("error marshaling request", errors.New("boom"), bfschemas.Azure),
			want: domain.ErrProviderError,
		},
		{
			// The shape test is not a configuration detector, and these two
			// rows are here so that is a stated contract rather than an
			// accident nobody looked at.
			//
			// NewBifrostOperationError is called with a nil error at ~40 sites
			// in core@v1.4.22 (providers/utils/utils.go:1058 among them), which
			// produces exactly the shape the row above does not have: no Go
			// error, no code. It lands on misconfigured, and that is the right
			// call for the wrong-sounding reason — the request is rejected
			// permanently either way, so refusing to walk the chain is correct
			// even though the code names the provider row rather than the
			// request.
			name: "operation error raised without a Go error",
			berr: bfproviderutils.NewBifrostOperationError("request body is not provided", nil, bfschemas.Azure),
			want: domain.ErrProviderMisconfigured,
		},
		{
			// The same shape reached from the client's side: core's own
			// request-validation guards (bifrost.go:669) build the literal by
			// hand before any provider is consulted. Pinned for the same
			// reason — permanent, so non-retryable, and no shape test can tell
			// it apart from a bad provider row.
			name: "vendor request validation rejection",
			berr: &bfschemas.BifrostError{
				IsBifrostError: false,
				Error:          &bfschemas.ErrorField{Message: "chats not provided for chat completion request"},
			},
			want: domain.ErrProviderMisconfigured,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Nil(t, tc.berr.StatusCode, "fixture precondition: this shape carries no HTTP status")

			got := codeOf(t, classifyBifrostError(context.Background(), tc.berr))

			assert.NotEqual(t, domain.ErrProviderTimeout, got,
				"no HTTP call was made, so this cannot be a timeout; got %q", got)
			assert.Equal(t, tc.want, got,
				"this shape must land on its own named code, not merely on a non-timeout one")
		})
	}
}

// AC20: whatever code the configuration failure lands on, the operator must be
// able to read the cause off the error alone. This is the mechanism half —
// classification must not drop the vendor's message. That the message then
// reaches the client's response body is asserted end to end in
// adapters/httpapi/azure_config_error_status_test.go.
//
// @scenario "The operator can identify the cause from the response alone"
func TestClassifyBifrostError_KeepsTheUnderlyingBifrostMessage(t *testing.T) {
	err := classifyBifrostError(context.Background(),
		bfproviderutils.NewConfigurationError("deployments not set", bfschemas.Azure))

	var e herr.E
	require.ErrorAs(t, err, &e)
	assert.Equal(t, "deployments not set", e.Meta["message"],
		"the operator's only clue to the misconfiguration is this string")
}

// AC18: a genuine timeout must keep its identity. The vendor sets StatusCode
// 504 and Error.Type RequestTimedOut explicitly, which is why status 0 can be
// taken off the timeout branch without losing real timeouts.
//
// @scenario "A genuine provider timeout still classifies as a timeout"
func TestClassifyBifrostError_VendorTimeoutStaysATimeout(t *testing.T) {
	berr := bfproviderutils.NewBifrostTimeoutError("request timed out", errors.New("context deadline exceeded"), bfschemas.Azure)
	require.NotNil(t, berr.StatusCode, "fixture precondition: a real timeout carries an explicit status")
	require.Equal(t, http.StatusGatewayTimeout, *berr.StatusCode)

	got := codeOf(t, classifyBifrostError(context.Background(), berr))

	assert.Equal(t, domain.ErrProviderTimeout, got)
}

// AC19: the status-bearing branches of the switch are the baseline this issue
// does not touch. 408 is deliberately absent from the switch and therefore
// falls through to provider_error; that is current behavior, pinned so a fix
// to the status-0 branch cannot quietly reshuffle the rest. This half is
// status -> domain code; the code -> HTTP status half is one package out, in
// adapters/httpapi/azure_config_error_status_test.go.
//
// @scenario "Errors carrying an explicit status keep their current classification"
func TestClassifyBifrostError_StatusBaseline(t *testing.T) {
	cases := []struct {
		name   string
		status int
		want   herr.Code
	}{
		{name: "504 gateway timeout", status: http.StatusGatewayTimeout, want: domain.ErrProviderTimeout},
		{name: "408 request timeout falls through", status: http.StatusRequestTimeout, want: domain.ErrProviderError},
		{name: "429 too many requests", status: http.StatusTooManyRequests, want: domain.ErrRateLimited},
		{name: "500 internal server error", status: http.StatusInternalServerError, want: domain.ErrProviderError},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			status := tc.status
			berr := &bfschemas.BifrostError{
				StatusCode: &status,
				Error:      &bfschemas.ErrorField{Message: "upstream said so"},
			}

			assert.Equal(t, tc.want, codeOf(t, classifyBifrostError(context.Background(), berr)))
		})
	}
}
