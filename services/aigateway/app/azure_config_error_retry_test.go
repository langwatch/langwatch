package app

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/retry"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Defect B, the retry half. classifyProviderError is the only place the retry
// engine learns whether a dispatch failure is worth another credential, so a
// provider misconfiguration has to land as non-retryable HERE or every later
// guarantee (chain not walked, breaker untouched, one upstream verdict per
// request) is out of reach.
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature

// AC17, first Then: a permanent configuration error is not retried.
//
// provider_misconfigured reaches classifyProviderError with no matching case
// and falls to the default arm, which is exactly the intent — a fault no
// credential in the chain can satisfy must stop the walk. The assertion is on
// the reason rather than the arm so a future explicit case for the code cannot
// silently move it onto a retryable one.
//
// The companion codes are asserted alongside it because the value of
// non_retryable here is entirely relative: provider_error and
// provider_timeout, the two codes this classification used to be confused
// with, ARE retryable, and pinning them in the same table is what makes the
// distinction a contract instead of a coincidence.
//
// The composed behavior — chain not walked, no breaker failure — is asserted
// end to end in adapters/httpapi/azure_config_error_status_test.go.
//
// @scenario "A permanent configuration error is not retried"
func TestClassifyProviderError_MisconfiguredIsNotRetryable(t *testing.T) {
	ctx := context.Background()

	cases := []struct {
		code herr.Code
		want retry.Reason
	}{
		{code: domain.ErrProviderMisconfigured, want: retry.ReasonNonRetryable},
		{code: domain.ErrProviderError, want: retry.ReasonRetryable5xx},
		{code: domain.ErrProviderTimeout, want: retry.ReasonTimeout},
	}

	for _, tc := range cases {
		t.Run(string(tc.code), func(t *testing.T) {
			assert.Equal(t, tc.want, classifyProviderError(herr.New(ctx, tc.code, nil)),
				"%q decides whether the gateway burns the rest of the credential chain on this failure", tc.code)
		})
	}
}
