package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaymetrics"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func observedWriteError(t *testing.T, ctx context.Context, err error) *observer.ObservedLogs {
	t.Helper()
	_, logs := observedWriteErrorResponse(t, ctx, err)
	return logs
}

// observedWriteErrorResponse is observedWriteError's sibling for callers that
// also need to assert on the response writeError actually produced, not just
// what it logged.
func observedWriteErrorResponse(t *testing.T, ctx context.Context, err error) (*httptest.ResponseRecorder, *observer.ObservedLogs) {
	t.Helper()
	core, logs := observer.New(zapcore.DebugLevel)
	w := httptest.NewRecorder()
	writeError(zap.New(core), w, ctx, err)
	return w, logs
}

func requireSingleFailureLog(t *testing.T, logs *observer.ObservedLogs) observer.LoggedEntry {
	t.Helper()
	entries := logs.FilterMessage("gateway_request_failed").All()
	require.Len(t, entries, 1)
	return entries[0]
}

// @scenario "A provider error response is logged with provider fault"
func TestWriteErrorLogsUpstreamServerErrorAsProviderFault(t *testing.T) {
	logs := observedWriteError(t, context.Background(), &domain.UpstreamError{
		StatusCode: 504,
		Message:    "request timed out (default is 30 seconds)",
	})
	entry := requireSingleFailureLog(t, logs)
	assert.Equal(t, zapcore.WarnLevel, entry.Level)
	fields := entry.ContextMap()
	assert.Equal(t, "provider", fields["fault"])
	assert.Equal(t, "upstream_error", fields["code"])
	assert.Equal(t, int64(504), fields["status"])
	assert.Contains(t, fields["message"], "timed out")
}

// @scenario "A customer-caused provider rejection is logged with customer fault"
func TestWriteErrorLogsUpstreamRejectionAsCustomerFault(t *testing.T) {
	logs := observedWriteError(t, context.Background(), &domain.UpstreamError{
		StatusCode: 402,
		Message:    "credit balance too low",
	})
	entry := requireSingleFailureLog(t, logs)
	assert.Equal(t, zapcore.InfoLevel, entry.Level)
	assert.Equal(t, "customer", entry.ContextMap()["fault"])
}

// @scenario "A forwarded provider rejection names the provider's own reason"
func TestWriteErrorLogsTheProviderReasonFromTheForwardedBody(t *testing.T) {
	// The line that named nothing: the codex backend answered 400 with the
	// parameter it refused, the client got that body verbatim, and the log said
	// only "codex backend HTTP 400". Every codex turn in production failed for
	// a week's worth of debugging over a sentence we already held.
	logs := observedWriteError(t, context.Background(), &domain.UpstreamError{
		StatusCode: 400,
		Message:    "codex backend HTTP 400",
		Body:       []byte(`{"detail":"Unsupported parameter: prompt_cache_retention"}`),
	})
	fields := requireSingleFailureLog(t, logs).ContextMap()
	assert.Equal(t, "Unsupported parameter: prompt_cache_retention", fields["upstream_reason"])
	assert.Equal(t, int64(400), fields["status"])
}

// @scenario "A forwarded provider rejection names the provider's own reason"
func TestUpstreamReasonReadsEveryShapeProvidersUse(t *testing.T) {
	cases := []struct {
		name string
		body string
		want string
	}{
		{"openai and anthropic", `{"error":{"type":"invalid_request_error","message":"credit balance too low"}}`, "credit balance too low"},
		{"the codex backend", `{"detail":"Unsupported parameter: prompt_cache_retention"}`, "Unsupported parameter: prompt_cache_retention"},
		{"a bare message", `{"message":"model not found"}`, "model not found"},
		{"a plain error string", `{"error":"invalid virtual key"}`, "invalid virtual key"},
		{"a body with nothing in it", "", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, upstreamReason([]byte(tc.body)))
		})
	}
}

// @scenario "A forwarded provider rejection names the provider's own reason"
func TestUpstreamReasonNeverQuotesABodyItCannotRead(t *testing.T) {
	// An edge page or a plain-text rejection can reflect the request that
	// caused it. Quoting one would copy a prompt, a key or personal data onto
	// an operator's log line, so an unreadable body is described by its size.
	//
	// The stand-in key is assembled rather than written out: a test about not
	// leaking a credential should not commit something shaped like one.
	credential := "sk-" + "live-" + strings.Repeat("0", 24)
	reflected := "Bad request: input=my patient's diagnosis is ... key=" + credential
	reason := upstreamReason([]byte(reflected))
	assert.NotContains(t, reason, "patient")
	assert.NotContains(t, reason, credential)
	assert.Equal(t, fmt.Sprintf("unrecognized upstream body, %d bytes", len(reflected)), reason)

	edge := "<html>\n<body>error 1010</body>\n</html>"
	assert.Equal(t, fmt.Sprintf("unrecognized upstream body, %d bytes", len(edge)),
		upstreamReason([]byte(edge)),
		"the operator still learns a body came back, and how big")
}

// @scenario "A forwarded provider rejection names the provider's own reason"
func TestUpstreamReasonIsBoundedAndNotRepeated(t *testing.T) {
	t.Run("when the body is longer than the cap", func(t *testing.T) {
		long := strings.Repeat("x", upstreamReasonLimit*4)
		reason := upstreamReason([]byte(`{"detail":"` + long + `"}`))
		assert.Len(t, reason, upstreamReasonLimit,
			"a provider answering at length must not take the log line over")
		assert.True(t, strings.HasSuffix(reason, "..."), "a cut reason says it was cut")
	})

	t.Run("when the cut lands inside a multi-byte character", func(t *testing.T) {
		long := strings.Repeat("é", upstreamReasonLimit*4)
		reason := upstreamReason([]byte(`{"detail":"` + long + `"}`))
		assert.LessOrEqual(t, len(reason), upstreamReasonLimit,
			"the cap counts bytes, so a half-written character cannot push past it")
		assert.True(t, utf8.ValidString(reason), "a cut reason stays valid UTF-8")
	})

	t.Run("when our message already states the reason", func(t *testing.T) {
		body := []byte(`{"error":{"message":"credit balance too low"}}`)
		assert.Empty(t, unstatedReason("credit balance too low", body))
		assert.Equal(t, "credit balance too low", unstatedReason("provider HTTP 402", body))
	})
}

// @scenario "A gateway-classified error is logged by its error code"
func TestWriteErrorLogsHerrCodesWithTheirFault(t *testing.T) {
	cases := []struct {
		code  herr.Code
		fault string
		level zapcore.Level
	}{
		{domain.ErrBudgetExceeded, "customer", zapcore.InfoLevel},
		{domain.ErrProviderTimeout, "provider", zapcore.WarnLevel},
		{domain.ErrInternal, "platform", zapcore.ErrorLevel},
		// A settings mistake is the customer's to fix, and reading it as a
		// provider fault put it on the warn line operators watch for provider
		// outages while sending the customer to a provider status page.
		{domain.ErrProviderCredentialInvalid, "customer", zapcore.InfoLevel},
		{domain.ErrProviderConfigInvalid, "customer", zapcore.InfoLevel},
		{domain.ErrProviderCredentialRejected, "customer", zapcore.InfoLevel},
		// The host never answered — that one really is the provider's.
		{domain.ErrProviderConnectionFailed, "provider", zapcore.WarnLevel},
		// Nobody's fault. Attributed to the customer because that is where the
		// action was (they left), and kept at info so a client on a flaky
		// network never reaches the line operators watch.
		{domain.ErrRequestAbandoned, "customer", zapcore.InfoLevel},
	}
	for _, tc := range cases {
		logs := observedWriteError(t, context.Background(),
			herr.New(context.Background(), tc.code, herr.M{"message": "boom"}))
		entry := requireSingleFailureLog(t, logs)
		assert.Equal(t, tc.level, entry.Level, "code %s", tc.code)
		fields := entry.ContextMap()
		assert.Equal(t, tc.fault, fields["fault"], "code %s", tc.code)
		assert.Equal(t, tc.code.String(), fields["code"])
	}
}

// @scenario "A forwarded provider rejection names the provider's own reason"
//
// The customer-facing message states what to do; the cause states why, and
// only one of the two can be both actionable and safe to show a customer.
// Bifrost splits a failure into a category ("error creating auth token
// source") and a wrapped cause, the gateway carried only the category, and the
// category is one string for six credential problems with different
// fixes — which is what made a production Vertex failure undiagnosable from
// the logs.
func TestWriteErrorLogsTheUnderlyingCauseOfAHandledError(t *testing.T) {
	err := herr.New(context.Background(), domain.ErrProviderCredentialInvalid,
		herr.M{"message": "The credentials configured for this model provider were not accepted."},
		errors.New("error creating auth token source: invalid google auth credentials: missing 'type'"))

	entry := requireSingleFailureLog(t, observedWriteError(t, context.Background(), err))

	assert.Equal(t, "invalid google auth credentials: missing 'type'",
		strings.TrimPrefix(entry.ContextMap()["upstream_reason"].(string),
			"error creating auth token source: "),
		"the operator reads which of the credential failures this was")
}

// A cause the customer-facing message already states is not printed twice.
func TestWriteErrorDoesNotRepeatACauseTheMessageAlreadyStates(t *testing.T) {
	err := herr.New(context.Background(), domain.ErrProviderConfigInvalid,
		herr.M{"message": "deployments not set for this provider"},
		errors.New("deployments not set"))

	entry := requireSingleFailureLog(t, observedWriteError(t, context.Background(), err))

	assert.Nil(t, entry.ContextMap()["upstream_reason"])
}

// @scenario "An unexpected error is logged with platform fault"
func TestWriteErrorLogsUnhandledAsPlatformFault(t *testing.T) {
	logs := observedWriteError(t, context.Background(), errors.New("nil pointer somewhere"))
	entry := requireSingleFailureLog(t, logs)
	assert.Equal(t, zapcore.ErrorLevel, entry.Level)
	assert.Equal(t, "platform", entry.ContextMap()["fault"])
}

// meteredContext seeds a recorder the way gatewaymetrics.Middleware does for
// a live request, plus the bundle identity an authenticated call carries.
func meteredContext(rec *gatewaymetrics.Recorder, virtualKeyID string) context.Context {
	ctx := context.WithValue(context.Background(), bundleCtxKey{}, &domain.Bundle{
		ProjectID:      "project_x",
		OrganizationID: "org_y",
		VirtualKeyID:   virtualKeyID,
	})
	return gatewaymetrics.ContextWithRecorder(ctx, rec)
}

// clientRejects reads one client-rejection series back off a real scrape of
// the recorder, which is the only view an operator's alert ever gets. Counters
// are whole numbers, so the value is returned as an int: it keeps the
// assertions exact instead of approximate, and "this counter did not move" is
// a comparison against zero that an epsilon check cannot express.
func clientRejects(t *testing.T, rec *gatewaymetrics.Recorder, code, vkID string) int {
	t.Helper()
	w := httptest.NewRecorder()
	rec.Handler().ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	require.Equal(t, http.StatusOK, w.Code)

	prefix := fmt.Sprintf("gateway_client_rejects_total{code=%q,vk_id=%q} ", code, vkID)
	for _, line := range strings.Split(w.Body.String(), "\n") {
		if value, ok := strings.CutPrefix(line, prefix); ok {
			parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
			require.NoError(t, err)
			return int(parsed)
		}
	}
	return 0
}

// clientRejectSeries is how many distinct series the counter has minted, which
// is the cardinality claim the label set makes.
func clientRejectSeries(t *testing.T, rec *gatewaymetrics.Recorder) int {
	t.Helper()
	count, err := testutil.GatherAndCount(rec.Registry(), "gateway_client_rejects_total")
	require.NoError(t, err)
	return count
}

// @scenario "A customer-fault rejection is counted against the key that sent it"
func TestWriteErrorCountsCustomerRejectionsPerVirtualKey(t *testing.T) {
	rec := gatewaymetrics.New()
	ctx := meteredContext(rec, "vk_flooder")

	cases := []struct {
		name string
		err  error
		code string
	}{
		{"a request with no model", herr.New(context.Background(), domain.ErrMissingModel, herr.M{"message": "choose a model"}), "missing_model"},
		{"a model the key may not use", herr.New(context.Background(), domain.ErrModelNotAllowed, herr.M{"message": "nope"}), "model_not_allowed"},
		{"a payload past the ceiling", herr.New(context.Background(), domain.ErrPayloadTooLarge, herr.M{"message": "too big"}), "payload_too_large"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			before := clientRejects(t, rec, tc.code, "vk_flooder")
			observedWriteError(t, ctx, tc.err)
			assert.Equal(t, before+1, clientRejects(t, rec, tc.code, "vk_flooder"))
		})
	}

	// The flood this metric exists for is one key repeating one code, which
	// has to accumulate on a single series rather than mint one per request.
	for range 5 {
		observedWriteError(t, ctx, herr.New(context.Background(), domain.ErrMissingModel, herr.M{"message": "choose a model"}))
	}
	assert.Equal(t, 6, clientRejects(t, rec, "missing_model", "vk_flooder"))
	assert.Equal(t, 3, clientRejectSeries(t, rec), "one series per code, not per request")
}

// @scenario "A customer-caused failure the gateway authors keeps its customer fault"
func TestWriteErrorKeepsCustomerFaultWhenTheGatewayAuthorsTheRejection(t *testing.T) {
	// codex_session_expired stopped being a forwarded provider 401 and became
	// a handled error the gateway writes itself. faultForUpstreamStatus had
	// been reading "customer" off that response's status; with no response to
	// read, the code has to carry the attribution. Left out of faultForCode it
	// does not merely go unattributed — it lands on the platform-fault error
	// line operators page on, for a customer signing in again.
	rec := gatewaymetrics.New()
	logs := observedWriteError(t, meteredContext(rec, "vk_signed_out"),
		herr.New(context.Background(), domain.ErrCodexSessionExpired,
			herr.M{"message": "Your OpenAI session expired."}))

	entry := requireSingleFailureLog(t, logs)
	assert.Equal(t, "customer", entry.ContextMap()["fault"])
	assert.Equal(t, zapcore.InfoLevel, entry.Level,
		"a customer signing in again is not a platform incident")
	assert.Equal(t, 1, clientRejects(t, rec, "codex_session_expired", "vk_signed_out"),
		"a key wedged in a re-authenticate loop is exactly what this counter is for")
}

// @scenario "A customer-caused failure the gateway authors keeps its customer fault"
func TestFaultForCodeAttributesEveryCodeTheGatewayAuthors(t *testing.T) {
	// The default arm answers "platform", so a code the gateway authors and
	// nobody classified is indistinguishable from our own bug. Rather than
	// re-list the switch, this walks the codes whose fault is not ours and
	// asserts none of them fall through — the check that would have caught
	// codex_session_expired.
	notOurFault := []herr.Code{
		domain.ErrInvalidAPIKey, domain.ErrBudgetExceeded, domain.ErrRateLimited,
		domain.ErrGuardrailBlocked, domain.ErrPolicyViolation, domain.ErrModelNotAllowed,
		domain.ErrPayloadTooLarge, domain.ErrBadRequest, domain.ErrMissingModel,
		domain.ErrNotFound, domain.ErrKeyRevoked, domain.ErrKeyDisabled,
		domain.ErrNoProviderConfigured, domain.ErrEndUserRequired,
		domain.ErrCodexSessionExpired,
		domain.ErrProviderError, domain.ErrProviderTimeout,
		domain.ErrProviderCredentialInvalid, domain.ErrProviderCredentialRejected,
		domain.ErrProviderConfigInvalid, domain.ErrProviderConnectionFailed,
		domain.ErrRequestAbandoned,
		domain.ErrChainExhausted, domain.ErrCircuitOpen,
	}
	for _, code := range notOurFault {
		t.Run(string(code), func(t *testing.T) {
			assert.NotEqual(t, FaultPlatform, faultForCode(code),
				"a failure the caller or the provider caused must not log as our incident")
		})
	}

	assert.Equal(t, FaultPlatform, faultForCode(domain.ErrInternal),
		"and our own bug must still be ours")
}

// @scenario "A provider or platform failure is not counted as a client rejection"
func TestWriteErrorDoesNotCountProviderOrPlatformFaults(t *testing.T) {
	cases := []struct {
		name string
		err  error
		code string
	}{
		{"an upstream server error", &domain.UpstreamError{StatusCode: 503, Message: "overloaded"}, "upstream_error"},
		// A provider 4xx is a customer fault by faultForUpstreamStatus, and
		// must still stay off this counter. Counting it would put every
		// OpenAI 429 and Anthropic 402 on a metric named "client rejects", so
		// a provider having a bad hour would read as clients looping on
		// malformed bodies and the per-key alert would be muted with the real
		// signal inside it.
		{"a provider rejecting the caller", &domain.UpstreamError{StatusCode: 429, Message: "rate limited"}, "upstream_error"},
		{"a provider refusing the caller's credit", &domain.UpstreamError{StatusCode: 402, Message: "credit balance too low"}, "upstream_error"},
		{"a gateway timeout on the provider", herr.New(context.Background(), domain.ErrProviderTimeout, herr.M{"message": "slow"}), "provider_timeout"},
		{"our own bug", errors.New("nil pointer somewhere"), "unhandled"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := gatewaymetrics.New()
			observedWriteError(t, meteredContext(rec, "vk_z"), tc.err)
			assert.Equal(t, 0, clientRejects(t, rec, tc.code, "vk_z"))
			assert.Equal(t, 0, clientRejectSeries(t, rec))
		})
	}
}

// @scenario "A rate-limited caller is not counted as a client reject"
func TestWriteErrorDoesNotCountRateLimitedRejections(t *testing.T) {
	// domain.ErrRateLimited is a customer fault by faultForCode — unlike the
	// provider/platform cases above, this exclusion is specific to this one
	// code: a key legitimately sustained at its RPM/RPD ceiling would pin
	// gateway_client_rejects_total and mute the per-key alert it exists for.
	// The rejection is already carried by gateway_rate_limit_denied_total.
	rec := gatewaymetrics.New()
	observedWriteError(t, meteredContext(rec, "vk_ceiling"),
		herr.New(context.Background(), domain.ErrRateLimited, herr.M{"message": "rpm exceeded"}))
	assert.Equal(t, 0, clientRejects(t, rec, "rate_limited", "vk_ceiling"))
	assert.Equal(t, 0, clientRejectSeries(t, rec))
}

func TestWriteErrorDoesNotCountAbandonedRequests(t *testing.T) {
	// The second exclusion inside recordClientReject, and the one the fault
	// table cannot express: request_abandoned is a customer fault, so the
	// faultForCode gate lets it through and only the explicit exclusion stops
	// it. A caller disconnecting is not a rejection the gateway issued, and a
	// client on a flaky network would otherwise read on the per-key alert as
	// one looping on malformed bodies.
	rec := gatewaymetrics.New()
	observedWriteError(t, meteredContext(rec, "vk_flaky_client"),
		herr.New(context.Background(), domain.ErrRequestAbandoned, herr.M{"message": "caller left"}))
	assert.Equal(t, 0, clientRejects(t, rec, "request_abandoned", "vk_flaky_client"))
	assert.Equal(t, 0, clientRejectSeries(t, rec))
}

// A control for the two exclusions above: the same call path, on a code that
// IS a rejection the gateway issued, does count. Without it both exclusion
// tests would keep passing if recordClientReject stopped counting anything.
func TestWriteErrorStillCountsRejectionsTheGatewayIssued(t *testing.T) {
	rec := gatewaymetrics.New()
	observedWriteError(t, meteredContext(rec, "vk_bad_body"),
		herr.New(context.Background(), domain.ErrBadRequest, herr.M{"message": "no model"}))
	assert.Equal(t, 1, clientRejects(t, rec, "bad_request", "vk_bad_body"))
}

// @scenario "A rejection on an unmetered path is still written"
func TestWriteErrorWithoutARecorderStillAnswers(t *testing.T) {
	var w *httptest.ResponseRecorder
	assert.NotPanics(t, func() {
		var logs *observer.ObservedLogs
		w, logs = observedWriteErrorResponse(t, context.Background(),
			herr.New(context.Background(), domain.ErrBadRequest, herr.M{"message": "no model"}))
		assert.Equal(t, "customer", requireSingleFailureLog(t, logs).ContextMap()["fault"])
	})
	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), `"code":"bad_request"`)
}

// @scenario "Failure logs identify the calling project"
func TestWriteErrorLogsCarryBundleIdentity(t *testing.T) {
	ctx := context.WithValue(context.Background(), bundleCtxKey{}, &domain.Bundle{
		ProjectID:      "project_x",
		OrganizationID: "org_y",
		VirtualKeyID:   "vk_z",
	})
	logs := observedWriteError(t, ctx, &domain.UpstreamError{StatusCode: 500, Message: "boom"})
	fields := requireSingleFailureLog(t, logs).ContextMap()
	assert.Equal(t, "project_x", fields["project_id"])
	assert.Equal(t, "org_y", fields["organization_id"])
	assert.Equal(t, "vk_z", fields["virtual_key_id"])
}

// Attribution has to travel WITH the error. The gateway authors most of its
// failures rather than forwarding a provider response, so there is no upstream
// status for a client, an agent or a support conversation to infer "whose
// problem is this" from — and until writeError stamped it, a gateway-authored
// error reached the client with no fault at all while the log line beside it
// had one.
//
// @scenario "A gateway-classified error is logged by its error code"
func TestWrittenErrorsCarryTheirFaultOnTheWire(t *testing.T) {
	// The status is the whole point of the change — "a 5xx here made agent
	// clients retry a dead credential ten times" — and it was pinned by nothing:
	// setting provider_credential_invalid to 500 left the entire package green.
	// A terminal 4xx for the setup failures is what stops the retry loop, so it
	// is asserted here beside the fault rather than left to the registration.
	cases := []struct {
		code       herr.Code
		fault      string
		wantStatus int
	}{
		{domain.ErrProviderCredentialInvalid, "customer", http.StatusBadRequest},
		{domain.ErrProviderConfigInvalid, "customer", http.StatusBadRequest},
		{domain.ErrProviderCredentialRejected, "customer", http.StatusUnauthorized},
		{domain.ErrProviderTimeout, "provider", http.StatusGatewayTimeout},
		{domain.ErrProviderConnectionFailed, "provider", http.StatusBadGateway},
		// 499: the caller hung up. Not 504, which would blame a provider that
		// was answering fine.
		{domain.ErrRequestAbandoned, "customer", 499},
		{domain.ErrInternal, "platform", http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(tc.code.String(), func(t *testing.T) {
			w, _ := observedWriteErrorResponse(t, context.Background(),
				herr.New(context.Background(), tc.code, herr.M{"message": "boom"}))

			// The envelope nests the whole failure under `error` (herr.WriteHTTP
			// -> ErrorResponse), so reading `code`/`fault` off the top level
			// finds nothing and would pass for an error carrying neither.
			var body struct {
				Error struct {
					Code  string `json:"code"`
					Fault string `json:"fault"`
				} `json:"error"`
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			assert.Equal(t, tc.code.String(), body.Error.Code)
			assert.Equal(t, tc.fault, body.Error.Fault)
			assert.Equalf(t, tc.wantStatus, w.Code,
				"%s reaches the client as this status; a retryable 5xx on a terminal failure is the retry loop this change exists to stop", tc.code)
		})
	}
}

// A construction site that knows better than the code-level default has said
// so deliberately, and must not be overwritten by it.
func TestWrittenErrorsKeepAnExplicitFault(t *testing.T) {
	w, _ := observedWriteErrorResponse(t, context.Background(),
		herr.New(context.Background(), domain.ErrProviderError,
			herr.M{"message": "boom", "fault": "customer"}))

	var body struct {
		Error struct {
			Fault string `json:"fault"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	assert.Equal(t, "customer", body.Error.Fault)
}

// The seam between the two planes, asserted end to end on the bytes rather than
// on either side's idea of them: what writeError puts on the wire is what
// readHandledError.fromCanonicalEnvelope reads, and what the customer then sees
// rendered. Every field below is load-bearing somewhere in that chain —
// `tips` and `docs_url` become the remediation list and the docs link, `fault`
// picks the log level and the headline, and `meta.provider` / `meta.model` are
// what let the copy say "Google Vertex AI" and name the model instead of
// "this provider".
//
// @scenario "A terminal provider failure tells the caller how to fix it"
func TestWrittenErrorsCarryRemediationForTheClientToRender(t *testing.T) {
	w, _ := observedWriteErrorResponse(t, context.Background(),
		herr.New(context.Background(), domain.ErrProviderCredentialInvalid, herr.M{
			"message":  "The credentials configured for this model provider were not accepted.",
			"provider": "vertex",
			"model":    "gemini-2.5-flash",
		}))

	var body struct {
		Error struct {
			Code    string         `json:"code"`
			Message string         `json:"message"`
			Fault   string         `json:"fault"`
			Tips    []string       `json:"tips"`
			DocsURL string         `json:"docs_url"`
			Meta    map[string]any `json:"meta"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))

	assert.Equal(t, "provider_credential_invalid", body.Error.Code)
	assert.Equal(t, "customer", body.Error.Fault)
	assert.Equal(t, "https://docs.langwatch.ai/ai-gateway/providers/vertex", body.Error.DocsURL,
		"a Vertex failure links Vertex's own setup page")
	assert.Contains(t, strings.Join(body.Error.Tips, "\n"), "service-account JSON document",
		"the reader is told what a Vertex credential actually is")
	assert.LessOrEqual(t, len(body.Error.Tips), 4,
		"the client truncates past MAX_TIPS, so anything beyond it is written to be discarded")

	assert.Equal(t, "vertex", body.Error.Meta["provider"])
	assert.Equal(t, "gemini-2.5-flash", body.Error.Meta["model"])
	for _, promoted := range []string{"tips", "docs_url", "fault"} {
		assert.NotContainsf(t, body.Error.Meta, promoted,
			"%s is promoted to a first-class field and must not also sit in meta", promoted)
	}
}
