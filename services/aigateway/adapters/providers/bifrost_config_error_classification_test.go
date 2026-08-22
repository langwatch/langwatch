package providers

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	bfproviderutils "github.com/maximhq/bifrost/core/providers/utils"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// classifyBifrostError is the only translation point for a Bifrost error that
// carries no HTTP status, because no HTTP call was ever made. Its switch used
// to treat status 0 as a gateway timeout, which mislabeled every
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

// vendorEmptyResponseError returns the error core@v1.4.22 actually raises for
// an empty upstream body, produced by the vendor's own exported parse path
// rather than assembled here.
//
// Building it through HandleProviderResponse is what keeps the exclusion
// honest: a hand-written literal using ErrProviderResponseEmpty would still
// pass if the vendor stopped raising that constant at the empty-body site,
// because the fixture and the code under test would agree with each other and
// with nothing else.
func vendorEmptyResponseError(t *testing.T) *bfschemas.BifrostError {
	t.Helper()
	var discard struct{}
	_, _, berr := bfproviderutils.HandleProviderResponse([]byte("   "), &discard, nil, false, false)
	require.NotNil(t, berr, "vendor precondition: an empty response body must raise an error")
	require.Equal(t, bfschemas.ErrProviderResponseEmpty, berr.Error.Message,
		"vendor precondition: the empty-body site still raises the exported constant")
	return berr
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
			// NewBifrostOperationError is called with a nil error at 171 sites
			// in core@v1.4.22 (providers/utils/utils.go:1058 among them), which
			// produces exactly the shape the row above does not have: no Go
			// error, no code. It lands on misconfigured, and that is the right
			// call for the wrong-sounding reason — the request is rejected
			// permanently either way, so refusing to walk the chain is correct
			// even though the code names the provider row rather than the
			// request. An AST sweep of the pinned vendor confirms those sites
			// are caller-input validation ("file_id is required", "invalid
			// request: nil"); the transient ones among them sit on the video and
			// batch paths this gateway never calls.
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
		{
			// The transient shape the bare-shape sweep would otherwise call
			// permanent, built by the vendor's own parse path. An empty
			// upstream body is a dropped or truncated response, not a rejected
			// provider row: it must stay retryable so the credential chain is
			// still walked. Non-retryable here is the precise failure this
			// whole change exists to prevent, pointed the other way.
			name: "empty upstream response body (vendor parse path)",
			berr: vendorEmptyResponseError(t),
			want: domain.ErrProviderError,
		},
		{
			// The same fault as raised by the provider adapters rather than the
			// shared parse helper (openai.go:2566/3737, mistral.go:347/457,
			// elevenlabs.go:587): a hand-built literal, no status, no Go error,
			// no code. Pinned separately because it reaches the branch by a
			// different route and must land on the same code.
			name: "empty upstream response body (provider adapter literal)",
			berr: &bfschemas.BifrostError{
				IsBifrostError: true,
				Error:          &bfschemas.ErrorField{Message: bfschemas.ErrProviderResponseEmpty},
			},
			want: domain.ErrProviderError,
		},
		{
			// Core raises this from the provider-queue machinery every
			// dispatch passes through, in the same bare Message-only shape a
			// rejected provider row arrives in. A closing queue is transient —
			// the next credential's provider is not closing — so classifying
			// it permanent stops the fallback chain on a fault the retry would
			// have cleared, which is this file's fix pointed backwards.
			//
			// This row and the next are literal-for-literal and would, alone,
			// only prove the map agrees with itself. Their job is narrow: pin
			// the code each message lands on, and go red if a bfMsg* constant's
			// value is edited. That core still RAISES these strings is carried
			// by the two tests at the bottom of this file, not here.
			name: "provider queue is shutting down",
			berr: &bfschemas.BifrostError{
				IsBifrostError: false,
				Error:          &bfschemas.ErrorField{Message: "provider is shutting down"},
			},
			want: domain.ErrProviderError,
		},
		{
			// Pure backpressure, which is exactly when walking to another
			// credential is worth most.
			name: "request dropped because the provider queue is full",
			berr: &bfschemas.BifrostError{
				IsBifrostError: false,
				Error:          &bfschemas.ErrorField{Message: "request dropped: queue is full"},
			},
			want: domain.ErrProviderError,
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

// openAIChatBackend serves one non-streaming OpenAI chat completion — enough
// for a dispatch against bifrost's native OpenAI provider to succeed.
func openAIChatBackend(t *testing.T) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl-shutdown","object":"chat.completion","created":1,` +
			`"model":"gpt-5.6-luna","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},` +
			`"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// chatOnce runs one chat completion through the same construction Dispatch
// uses — buildChatRequest, then NewBifrostContext over withCredential, then
// ChatCompletionRequest — and hands back Bifrost's raw error unwrapped, so its
// shape can be asserted before classification ever sees it.
func chatOnce(t *testing.T, router *BifrostRouter) *bfschemas.BifrostError {
	t.Helper()
	req := &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: "openai/gpt-5.6-luna",
		Body:  []byte(`{"model":"gpt-5.6-luna","messages":[{"role":"user","content":"ping"}]}`),
	}
	bfReq, dispatchCtx, err := buildChatRequest(context.Background(), req, bfschemas.OpenAI, "gpt-5.6-luna")
	require.NoError(t, err)

	_, berr := router.bf.ChatCompletionRequest(
		bfschemas.NewBifrostContext(withCredential(dispatchCtx, openAICred()), time.Time{}), bfReq)
	return berr
}

// The transient half of statuslessBifrostCode, proven against a real bifrost
// instance instead of a fixture. Nothing exports "provider is shutting down",
// so a hand-written row for it can only agree with the map it is testing;
// driving core into shutdown and reading the value it actually produces is
// what makes the exemption real. A vendor bump that rewords the message,
// attaches a status, or stops raising it fails here.
//
// This is a production path, not a contrivance: BifrostRouter.Close calls
// Shutdown, and dispatch evicts anthropic-compat endpoints through
// RemoveProvider, which signals the same queue closing. Every request landing
// in either window is answered with exactly this value.
//
// @scenario "The remaining status-less error shapes are classified deliberately"
func TestStatuslessBifrostCode_LiveShutdownErrorStaysRetryable(t *testing.T) {
	router := openAIRouter(t, openAIChatBackend(t).URL)

	// Load-bearing, not a smoke check. getProviderQueue lazily CREATES a queue
	// for a provider it does not find, so shutting down before the OpenAI queue
	// exists would hand the next dispatch a fresh, open queue and no error at
	// all. One completed round trip is what puts the queue there.
	require.Nil(t, chatOnce(t, router),
		"harness precondition: a dispatch must reach the backend before shutdown")

	// The production shutdown entry point. Cleanup calls it again, which core
	// tolerates: signalClosing is a sync.Once and the default tracer's Stop is
	// a no-op.
	router.Close()

	berr := chatOnce(t, router)
	require.NotNil(t, berr, "a dispatch onto a closed queue must fail")
	require.NotNil(t, berr.Error, "vendor precondition: the shutdown error carries an Error field")
	require.Equal(t, bfMsgProviderShuttingDown, berr.Error.Message,
		"vendor drift: core no longer answers a closing queue with this literal, so "+
			"bfTransientStatuslessMessages has silently stopped matching it")

	// Shape preconditions, asserted before classification so this cannot pass
	// down some other branch: a status, an attached Go error, or a vendor code
	// would each route the error away from statuslessBifrostCode entirely.
	require.Nil(t, berr.StatusCode, "no HTTP call was made, so there is no status to carry")
	require.NoError(t, berr.Error.Error, "the bare shape carries no Go error")
	require.Nil(t, berr.Error.Code, "the bare shape carries no vendor code")

	assert.Equal(t, domain.ErrProviderError, codeOf(t, classifyBifrostError(context.Background(), berr)),
		"a closing queue is transient; provider_misconfigured is non-retryable and would "+
			"stop the credential fallback chain (app/dispatch.go classifyProviderError)")
}

// pinnedBifrostCoreDir resolves the pinned core module's source directory
// through the toolchain rather than a constructed GOPATH, so a replace
// directive or workspace override resolves the way the build resolved it.
func pinnedBifrostCoreDir(t *testing.T) string {
	t.Helper()
	out, err := exec.CommandContext(t.Context(),
		"go", "list", "-m", "-f", "{{.Dir}}", "github.com/maximhq/bifrost/core").Output()
	require.NoError(t, err, "the pinned bifrost core module must be resolvable to verify it")
	dir := strings.TrimSpace(string(out))
	require.NotEmpty(t, dir, "the pinned bifrost core module has no source directory on disk")
	return dir
}

// Two of the three transient exemptions are matched by text core does not
// export, so nothing in the type system moves the gateway's copy when core
// rewords its own — unlike ErrProviderResponseEmpty, which is a symbol and
// would fail the build. This test is that missing compiler check: it reads the
// pinned module's own source and requires each constant to still appear where
// core constructs the error.
//
// It is the only cover the queue-full lane can have. Core raises it solely
// when dropExcessRequests is true (bifrost.go:4501) and NewBifrostRouter never
// sets DropExcessRequests, so the gateway cannot reach it and no live test can
// produce one. Filling the queue instead is not available either: the OpenAI
// provider takes core's defaults, 1000 workers over a 5000-slot buffer.
func TestBifrostTransientLiterals_AreStillConstructedByPinnedVendor(t *testing.T) {
	src, err := os.ReadFile(filepath.Join(pinnedBifrostCoreDir(t), "bifrost.go"))
	require.NoError(t, err, "core's provider-queue machinery must be readable to verify it")

	// Each fragment is core's CONSTRUCTION of the error, not the bare string:
	// bifrost.go also quotes "provider is shutting down" inside
	// drainQueueWithErrors' doc comment, and a comment must not be able to hold
	// this test green after the code stopped raising it.
	//
	// Built from the constants under test, so editing one fails here too.
	fragments := []struct {
		name     string
		fragment string
	}{
		{
			name:     "shutdown, raised through the vendor's helper",
			fragment: "newBifrostErrorFromMsg(" + strconv.Quote(bfMsgProviderShuttingDown) + ")",
		},
		{
			name:     "shutdown, hand-built by the queue drain",
			fragment: "Message: " + strconv.Quote(bfMsgProviderShuttingDown),
		},
		{
			name:     "queue full, raised through the vendor's helper",
			fragment: "newBifrostErrorFromMsg(" + strconv.Quote(bfMsgRequestDroppedQueueFull) + ")",
		},
	}

	for _, f := range fragments {
		t.Run(f.name, func(t *testing.T) {
			// The fragment is named in the message because testify prints
			// nothing usable when the haystack is a quarter-megabyte of source.
			assert.Contains(t, string(src), f.fragment,
				"vendor drift: core's provider-queue machinery no longer contains %q, so "+
					"bfTransientStatuslessMessages has stopped matching the error it raises "+
					"and the fault is classified permanent again, killing credential fallback",
				f.fragment)
		})
	}
}
