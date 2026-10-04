package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// mockRealtimeRegistry stands in for the control plane's record of open
// voice sessions.
type mockRealtimeRegistry struct {
	reserveErr   error
	correlateErr error
	reserved     []domain.RealtimeReservation
	correlated   []domain.RealtimeCorrelation
	released     []domain.RealtimeRelease
	reportedUse  []domain.RealtimeUsageReport
	reportErr    error
	// receipts answers the reports in order; past its end a report reads as
	// recorded at no cost.
	receipts []domain.RealtimeUsageReceipt
	// events is the order the registry was called in, so a test can place
	// the booking against the vendor call.
	events []string
}

func (m *mockRealtimeRegistry) Reserve(_ context.Context, r domain.RealtimeReservation) error {
	if m.reserveErr != nil {
		return m.reserveErr
	}
	m.reserved = append(m.reserved, r)
	m.events = append(m.events, "reserve")
	return nil
}

func (m *mockRealtimeRegistry) Correlate(_ context.Context, c domain.RealtimeCorrelation) error {
	if m.correlateErr != nil {
		return m.correlateErr
	}
	m.correlated = append(m.correlated, c)
	return nil
}

func (m *mockRealtimeRegistry) Release(_ context.Context, r domain.RealtimeRelease) error {
	m.released = append(m.released, r)
	return nil
}

func (m *mockRealtimeRegistry) ReportUsage(_ context.Context, r domain.RealtimeUsageReport) (domain.RealtimeUsageReceipt, error) {
	if m.reportErr != nil {
		return domain.RealtimeUsageReceipt{}, m.reportErr
	}
	m.reportedUse = append(m.reportedUse, r)
	m.events = append(m.events, "report")
	if len(m.receipts) >= len(m.reportedUse) {
		return m.receipts[len(m.reportedUse)-1], nil
	}
	return domain.RealtimeUsageReceipt{Status: domain.RealtimeReportRecorded}, nil
}

// elevenLabsBundle is a key that can serve the signed-URL route.
func elevenLabsBundle(creds ...domain.Credential) *domain.Bundle {
	if len(creds) == 0 {
		creds = []domain.Credential{
			{ID: "eleven_1", ProviderID: domain.ProviderElevenLabs, APIKey: "xi-1"},
		}
	}
	return &domain.Bundle{
		VirtualKeyID:   "vk-test",
		ProjectID:      "proj-test",
		OrganizationID: "org-test",
		Credentials:    creds,
		Config: domain.BundleConfig{
			Fallback: domain.FallbackConfig{MaxAttempts: len(creds)},
		},
	}
}

// signedURLMint is the dispatch the ElevenLabs route builds.
func signedURLMint() RealtimeMintDispatch {
	return RealtimeMintDispatch{
		Body:  []byte(`{"model":"elevenlabs/convai","agent_id":"agent_1"}`),
		Model: domain.ElevenLabsConvAIModel,
		Session: domain.RealtimeSessionRequest{
			Vendor:  domain.RealtimeVendorElevenLabs,
			AgentID: "agent_1",
		},
		Surface: domain.ElevenLabsConvAISurface(),
	}
}

// realtimeMint is a request on one of the session-mint routes.
func realtimeMint(surface domain.Surface, vendor domain.RealtimeVendor) *domain.Request {
	return &domain.Request{
		Type:            domain.RequestTypeRealtimeSession,
		Model:           domain.ElevenLabsConvAIModel,
		Surface:         surface,
		RealtimeSession: &domain.RealtimeSessionRequest{Vendor: vendor},
	}
}

// @scenario "The signed-URL route is served only by an ElevenLabs credential"
func TestSignedURLRouteRefusesAKeyWithNoElevenLabsCredential(t *testing.T) {
	t.Parallel()

	// A signed URL is bound to one agent inside one workspace. Falling back
	// to another vendor would sign for an agent that does not exist there.
	creds := []domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
		{ID: "gemini_1", ProviderID: domain.ProviderGemini},
	}
	req := realtimeMint(domain.ElevenLabsConvAISurface(), domain.RealtimeVendorElevenLabs)

	got, err := surfaceCredentials(context.Background(), creds, req)
	if !herr.IsCode(err, domain.ErrProviderNotBound) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrProviderNotBound)
	}
	if got != nil {
		t.Errorf("a refused trim must hand back no credentials, got %v", got)
	}
}

// @scenario "The client-secret route is served only by an OpenAI credential"
func TestClientSecretRouteRefusesAKeyWithNoOpenAICredential(t *testing.T) {
	t.Parallel()

	creds := []domain.Credential{{ID: "eleven_1", ProviderID: domain.ProviderElevenLabs}}
	req := realtimeMint(domain.OpenAIRealtimeSurface(), domain.RealtimeVendorOpenAI)

	if _, err := surfaceCredentials(context.Background(), creds, req); !herr.IsCode(err, domain.ErrProviderNotBound) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrProviderNotBound)
	}
}

func TestSignedURLRouteKeepsOnlyTheElevenLabsCredential(t *testing.T) {
	t.Parallel()

	creds := []domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
		{ID: "eleven_1", ProviderID: domain.ProviderElevenLabs},
		{ID: "eleven_2", ProviderID: domain.ProviderElevenLabs},
	}
	req := realtimeMint(domain.ElevenLabsConvAISurface(), domain.RealtimeVendorElevenLabs)

	got, err := surfaceCredentials(context.Background(), creds, req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	gotIDs := make([]string, len(got))
	for i, c := range got {
		gotIDs[i] = c.ID
	}
	if !equalSlices(gotIDs, []string{"eleven_1", "eleven_2"}) {
		t.Errorf("got %v, want the two ElevenLabs credentials in chain order", gotIDs)
	}
}

// @scenario "A mint never falls back to a second credential"
func TestAMintNeverFallsBackToASecondCredential(t *testing.T) {
	t.Parallel()

	// Two ElevenLabs credentials, and the first one fails. A completion
	// would walk to the second; a mint must not. A signed URL is bound to
	// one agent inside one workspace, so the second key would sign for an
	// agent that does not exist there, and the caller would get a
	// working-looking URL that fails at the socket.
	var dialed []string
	registry := &mockRealtimeRegistry{}
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			dialed = append(dialed, cred.ID)
			return &domain.Response{StatusCode: 500, Body: []byte(`{"detail":"upstream down"}`)}, nil
		},
	}
	application := New(
		WithProviders(provider),
		WithRealtimeSessions(registry),
		WithLogger(zap.NewNop()),
	)
	bundle := elevenLabsBundle(
		domain.Credential{ID: "eleven_1", ProviderID: domain.ProviderElevenLabs},
		domain.Credential{ID: "eleven_2", ProviderID: domain.ProviderElevenLabs},
	)

	_, err := application.HandleRealtimeSession(context.Background(), bundle, signedURLMint())
	require.Error(t, err)
	assert.Equal(t, []string{"eleven_1"}, dialed, "only the first credential may be dialed")
}

// @scenario "The mint fails closed when the session cannot be recorded"
func TestTheMintFailsClosedWhenTheSessionCannotBeRecorded(t *testing.T) {
	t.Parallel()

	// Deliberately against the budget fail-open rule: an unrecorded session
	// is voice no ledger will ever see and a cap the next mint cannot count
	// against.
	var dialed bool
	provider := &mockProvider{
		dispatchFn: func(context.Context, *domain.Request, domain.Credential) (*domain.Response, error) {
			dialed = true
			return &domain.Response{StatusCode: 200}, nil
		},
	}
	registry := &mockRealtimeRegistry{
		reserveErr: herr.New(context.Background(), domain.ErrRealtimeRegistryUnavailable, nil),
	}
	application := New(
		WithProviders(provider),
		WithRealtimeSessions(registry),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleRealtimeSession(context.Background(), elevenLabsBundle(), signedURLMint())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrRealtimeRegistryUnavailable))
	assert.False(t, dialed, "no vendor credential may be minted for a session nobody recorded")
}

// @scenario "A failed mint releases its booking"
func TestAFailedMintReleasesItsBooking(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{}
	provider := &mockProvider{
		dispatchFn: func(context.Context, *domain.Request, domain.Credential) (*domain.Response, error) {
			return nil, errors.New("the vendor refused the mint")
		},
	}
	application := New(
		WithProviders(provider),
		WithRealtimeSessions(registry),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleRealtimeSession(context.Background(), elevenLabsBundle(), signedURLMint())
	require.Error(t, err)

	require.Len(t, registry.reserved, 1, "the booking is taken before the vendor is called")
	require.Len(t, registry.released, 1,
		"a booking whose mint failed must stop counting against the key's cap")
	assert.Equal(t, "FAILED", registry.released[0].Status)
	assert.Equal(t, registry.reserved[0].SessionID, registry.released[0].SessionID)
}

func TestASuccessfulMintRecordsTheVendorsConversationID(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{}
	provider := &mockProvider{
		dispatchFn: func(context.Context, *domain.Request, domain.Credential) (*domain.Response, error) {
			return &domain.Response{
				StatusCode:             200,
				Body:                   []byte(`{"signed_url":"wss://x"}`),
				RealtimeConversationID: "conv_7",
			}, nil
		},
	}
	application := New(
		WithProviders(provider),
		WithRealtimeSessions(registry),
		WithLogger(zap.NewNop()),
	)

	result, err := application.HandleRealtimeSession(context.Background(), elevenLabsBundle(), signedURLMint())
	require.NoError(t, err)

	require.Len(t, registry.correlated, 1)
	assert.Equal(t, "conv_7", registry.correlated[0].VendorConversationID)
	assert.Equal(t, registry.reserved[0].SessionID, result.Meta.RealtimeSessionID,
		"the caller is handed the same id the session was booked under")
	assert.Empty(t, registry.released, "a session that opened is not released")
}

// @scenario "A session with no report is left for the settlement sweeper"
func TestASessionWithNoReportIsLeftForTheSettlementSweeper(t *testing.T) {
	t.Parallel()

	// Nothing about a successful mint closes the spend record. It stays
	// admitted until the vendor reports the call, or until the settlement
	// grace expires and it settles as cost unknown, flagged for
	// reconciliation.
	registry := &mockRealtimeRegistry{}
	application := New(
		WithProviders(&mockProvider{
			dispatchFn: func(context.Context, *domain.Request, domain.Credential) (*domain.Response, error) {
				return &domain.Response{StatusCode: 200, Body: []byte(`{"signed_url":"wss://x"}`)}, nil
			},
		}),
		WithRealtimeSessions(registry),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleRealtimeSession(context.Background(), elevenLabsBundle(), signedURLMint())
	require.NoError(t, err)
	assert.Empty(t, registry.reportedUse,
		"the mint reports no usage of its own; only the vendor's report can")
}

// @scenario "A mint whose conversation id cannot be recorded is refused"
func TestAMintWhoseCorrelationFailsIsRefusedAndReleased(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{
		correlateErr: errors.New("the control plane could not record the id"),
	}
	provider := &mockProvider{
		dispatchFn: func(context.Context, *domain.Request, domain.Credential) (*domain.Response, error) {
			return &domain.Response{
				StatusCode:             200,
				Body:                   []byte(`{"signed_url":"wss://x"}`),
				RealtimeConversationID: "conv_9",
			}, nil
		},
	}
	application := New(
		WithProviders(provider),
		WithRealtimeSessions(registry),
		WithLogger(zap.NewNop()),
	)

	// The vendor minted a working credential. Handing it out anyway would
	// leave a booking with no conversation id, and the reconciler reads back
	// only sessions that have one, so a real call would bill as cost-unknown
	// with no way to correct it.
	_, err := application.HandleRealtimeSession(
		context.Background(), elevenLabsBundle(), signedURLMint())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrRealtimeRegistryUnavailable),
		"an unrecordable session is a registry failure, not a vendor one")

	require.Len(t, registry.released, 1,
		"the refusal must not also cost the key a cap slot")
	assert.Equal(t, "FAILED", registry.released[0].Status)
	assert.Equal(t, "correlation_failed", registry.released[0].Reason)
}

// @scenario "A usage report names the key that opened the session"
func TestAUsageReportCarriesItsVirtualKey(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{}
	application := New(WithRealtimeSessions(registry), WithLogger(zap.NewNop()))

	_, err := application.ReportRealtimeUsage(
		context.Background(),
		elevenLabsBundle(),
		RealtimeUsagePost{
			SessionID: "req_1",
			Body:      []byte(`{"input_tokens":10,"output_tokens":5}`),
		},
	)
	require.NoError(t, err)

	// Several keys can share a trace project, so the project alone does not
	// say whose session this is. Without the key on the wire, the registry
	// cannot tell one key closing its own session from another key closing
	// it for them.
	require.Len(t, registry.reportedUse, 1)
	assert.Equal(t, "vk-test", registry.reportedUse[0].VirtualKeyID)
	assert.Equal(t, "proj-test", registry.reportedUse[0].ProjectID)
}

// tokenMint is the dispatch the single-use token route builds.
func tokenMint(tokenType domain.ElevenLabsTokenType) RealtimeMintDispatch {
	return RealtimeMintDispatch{
		Body:  []byte(`{"model":"` + tokenType.DefaultModel() + `"}`),
		Model: tokenType.DefaultModel(),
		Session: domain.RealtimeSessionRequest{
			Vendor:    domain.RealtimeVendorElevenLabs,
			TokenType: tokenType,
		},
		Surface: domain.ElevenLabsSingleUseTokenSurface(),
	}
}

// mintingApp answers every mint with the given vendor response.
func mintingApp(registry *mockRealtimeRegistry, resp *domain.Response) *App {
	return New(
		WithProviders(&mockProvider{
			dispatchFn: func(context.Context, *domain.Request, domain.Credential) (*domain.Response, error) {
				registry.events = append(registry.events, "vendor")
				return resp, nil
			},
		}),
		WithRealtimeSessions(registry),
		WithLogger(zap.NewNop()),
	)
}

// @scenario "A single-use token session is booked before the vendor is called"
func TestATokenMintBooksItsSessionBeforeTheVendorCall(t *testing.T) {
	t.Parallel()

	kinds := map[domain.ElevenLabsTokenType]domain.RealtimeSessionKind{
		domain.ElevenLabsTokenTTSWebsocket:   domain.RealtimeKindTTSSocket,
		domain.ElevenLabsTokenTTDWebsocket:   domain.RealtimeKindTTSSocket,
		domain.ElevenLabsTokenRealtimeScribe: domain.RealtimeKindSTTSocket,
		domain.ElevenLabsTokenBatchScribe:    domain.RealtimeKindSTTBatch,
	}
	for tokenType, kind := range kinds {
		t.Run(string(tokenType), func(t *testing.T) {
			t.Parallel()
			registry := &mockRealtimeRegistry{}
			application := mintingApp(registry, &domain.Response{StatusCode: 200, Body: []byte(`{"token":"sutkn_x"}`)})

			before := time.Now()
			_, err := application.HandleRealtimeSession(context.Background(), elevenLabsBundle(), tokenMint(tokenType))
			require.NoError(t, err)

			assert.Equal(t, []string{"reserve", "vendor"}, registry.events,
				"the booking is what makes the per-key cap real, so it comes first")
			require.Len(t, registry.reserved, 1)
			booked := registry.reserved[0]
			assert.Equal(t, kind, booked.Kind)
			assert.Equal(t, domain.RealtimeMeteringClient, booked.Metering)
			assert.Equal(t, tokenType.DefaultModel(), booked.Model)
			assert.WithinDuration(t, before.Add(15*time.Minute), booked.CredentialExpiresAt, time.Minute,
				"the token opens a socket for the fifteen minutes the vendor documents")
			assert.Empty(t, registry.correlated, "a token mint answers no conversation id to record")
		})
	}
}

// @scenario "A token mint the vendor rejects releases its booking"
func TestATokenMintTheVendorRejectsReleasesItsBooking(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{}
	application := mintingApp(registry, &domain.Response{StatusCode: 401, Body: []byte(`{"detail":"bad key"}`)})

	_, err := application.HandleRealtimeSession(
		context.Background(), elevenLabsBundle(), tokenMint(domain.ElevenLabsTokenTTSWebsocket))
	require.Error(t, err)

	require.Len(t, registry.released, 1)
	assert.Equal(t, "FAILED", registry.released[0].Status)
	assert.Equal(t, registry.reserved[0].SessionID, registry.released[0].SessionID)
}

// @scenario "The single-use token route is served only by an ElevenLabs credential"
func TestTheTokenRouteRefusesAKeyWithNoElevenLabsCredential(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{}
	application := mintingApp(registry, &domain.Response{StatusCode: 200, Body: []byte(`{"token":"sutkn_x"}`)})
	bundle := elevenLabsBundle(domain.Credential{ID: "openai_1", ProviderID: domain.ProviderOpenAI})

	_, err := application.HandleRealtimeSession(
		context.Background(), bundle, tokenMint(domain.ElevenLabsTokenRealtimeScribe))
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrProviderNotBound))
	assert.Empty(t, registry.events, "nothing is booked and no vendor is called")
}

// @scenario "An OpenAI mint books what metering needs"
func TestAnOpenAIMintBooksItsKindAndTranscriptionModel(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{}
	expiresAt := time.Unix(1786873895, 0)
	application := mintingApp(registry, &domain.Response{
		StatusCode:                  200,
		Body:                        []byte(`{"value":"ek_x","expires_at":1786873895}`),
		RealtimeCredentialExpiresAt: expiresAt,
	})
	bundle := elevenLabsBundle(domain.Credential{ID: "openai_1", ProviderID: domain.ProviderOpenAI})

	_, err := application.HandleRealtimeSession(context.Background(), bundle, RealtimeMintDispatch{
		Body: []byte(`{"session":{"type":"realtime","model":"gpt-realtime-2.1",` +
			`"audio":{"input":{"transcription":{"model":"gpt-transcribe"}}}}}`),
		Model:   "gpt-realtime-2.1",
		Session: domain.RealtimeSessionRequest{Vendor: domain.RealtimeVendorOpenAI},
		Surface: domain.OpenAIRealtimeSurface(),
	})
	require.NoError(t, err)

	require.Len(t, registry.reserved, 1)
	booked := registry.reserved[0]
	assert.Equal(t, domain.RealtimeKindRealtime, booked.Kind)
	assert.Equal(t, domain.RealtimeMeteringClient, booked.Metering)
	assert.Equal(t, "openai/gpt-transcribe", booked.TranscriptionModel)
	assert.True(t, booked.CredentialExpiresAt.IsZero(), "the vendor states the expiry only in its answer")

	require.Len(t, registry.correlated, 1, "the expiry is recorded once the vendor has answered")
	assert.Equal(t, expiresAt, registry.correlated[0].CredentialExpiresAt)
	assert.Empty(t, registry.correlated[0].VendorConversationID)
}

func TestAHostedAgentMintIsBookedAsVendorReported(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{}
	application := mintingApp(registry, &domain.Response{StatusCode: 200, Body: []byte(`{"signed_url":"wss://x"}`)})

	_, err := application.HandleRealtimeSession(context.Background(), elevenLabsBundle(), signedURLMint())
	require.NoError(t, err)

	assert.Equal(t, domain.RealtimeKindConvAI, registry.reserved[0].Kind)
	assert.Empty(t, registry.reserved[0].Metering, "the vendor's post-call report prices a hosted agent")
}

func TestAnExpiryThatCannotBeRecordedDoesNotRefuseTheMint(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{correlateErr: errors.New("the control plane is away")}
	application := mintingApp(registry, &domain.Response{
		StatusCode:                  200,
		Body:                        []byte(`{"value":"ek_x"}`),
		RealtimeCredentialExpiresAt: time.Unix(1786873895, 0),
	})
	bundle := elevenLabsBundle(domain.Credential{ID: "openai_1", ProviderID: domain.ProviderOpenAI})

	_, err := application.HandleRealtimeSession(context.Background(), bundle, RealtimeMintDispatch{
		Body:    []byte(`{"session":{"type":"realtime","model":"gpt-realtime-2.1"}}`),
		Model:   "gpt-realtime-2.1",
		Session: domain.RealtimeSessionRequest{Vendor: domain.RealtimeVendorOpenAI},
		Surface: domain.OpenAIRealtimeSurface(),
	})
	require.NoError(t, err, "the expiry only sizes an estimate, so losing it costs no call")
	assert.Empty(t, registry.released)
}

func postUsage(t *testing.T, registry *mockRealtimeRegistry, body string) RealtimeUsageAnswer {
	t.Helper()
	application := New(WithRealtimeSessions(registry), WithLogger(zap.NewNop()))
	answer, err := application.ReportRealtimeUsage(context.Background(), elevenLabsBundle(),
		RealtimeUsagePost{SessionID: "req_1", Body: []byte(body)})
	require.NoError(t, err)
	return answer
}

// @scenario "A response.done event is recorded under its response id"
func TestAResponseDoneEventIsReportedUnderItsResponseID(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{}
	postUsage(t, registry, `{"type":"response.done","response":{"id":"resp_1",`+
		`"usage":{"input_tokens":10,"output_tokens":4}}}`)

	require.Len(t, registry.reportedUse, 1)
	report := registry.reportedUse[0]
	assert.Equal(t, "resp_1", report.ReportKey)
	assert.False(t, report.Final, "a keyed report leaves the session open for the next response")
	assert.Equal(t, domain.RealtimeMeteringClient, report.Source)
	assert.Equal(t, "req_1", report.SessionID)
	require.NotNil(t, report.Usage)
	assert.Equal(t, 10, report.Usage.PromptTokens)
}

// @scenario "A batch of events is reported in order"
func TestABatchIsReportedInOrderAndAnswersTheSum(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{receipts: []domain.RealtimeUsageReceipt{
		{Status: domain.RealtimeReportRecorded, CostNanoUSD: 100, SessionCostNanoUSD: 100},
		{Status: domain.RealtimeReportDuplicate, SessionCostNanoUSD: 100},
		{
			Status: domain.RealtimeReportClosed, CostNanoUSD: 50, SessionCostNanoUSD: 150,
			Budget: domain.RealtimeBudgetState{Exceeded: true, Scope: "virtual_key", BudgetID: "bud_1"},
		},
	}}
	answer := postUsage(t, registry, `{"final":true,"duration_ms":42000,"events":[`+
		`{"type":"response.done","response":{"id":"resp_1","usage":{"input_tokens":10,"output_tokens":4}}},`+
		`{"type":"response.done","response":{"id":"resp_1","usage":{"input_tokens":10,"output_tokens":4}}},`+
		`{"type":"conversation.item.input_audio_transcription.completed","item_id":"item_9",`+
		`"usage":{"type":"duration","seconds":4}}]}`)

	require.Len(t, registry.reportedUse, 3)
	assert.Equal(t, "resp_1", registry.reportedUse[0].ReportKey)
	assert.Equal(t, "item_9", registry.reportedUse[2].ReportKey)
	assert.Equal(t, domain.RealtimePricedAsTranscription, registry.reportedUse[2].PricedAs)
	assert.False(t, registry.reportedUse[0].Final)
	assert.True(t, registry.reportedUse[2].Final, "the close rides on the last report")
	assert.Equal(t, int64(42000), registry.reportedUse[2].DurationMS)

	assert.Equal(t, domain.RealtimeReportClosed, answer.Status, "the last report's status")
	assert.Equal(t, int64(150), answer.CostNanoUSD, "the sum of what this post added")
	assert.Equal(t, int64(150), answer.SessionCostNanoUSD)
	assert.True(t, answer.Budget.Exceeded)
	assert.Equal(t, "bud_1", answer.Budget.BudgetID)
}

// @scenario "A usage total with no id closes the session"
func TestAUsageTotalWithNoKeyIsTheLegacyClosingReport(t *testing.T) {
	t.Parallel()

	for name, body := range map[string]string{
		"bare":          `{"input_tokens":10,"output_tokens":5}`,
		"under usage":   `{"usage":{"input_tokens":10,"output_tokens":5}}`,
		"elevenlabs":    `{"usage":{"characters":123}}`,
		"audio seconds": `{"usage":{"audio_seconds":3.2}}`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			registry := &mockRealtimeRegistry{}
			postUsage(t, registry, body)

			require.Len(t, registry.reportedUse, 1)
			report := registry.reportedUse[0]
			assert.Empty(t, report.ReportKey, "no key tells the control plane this is the session total")
			assert.False(t, report.Final, "a total closes the session by itself")
			assert.Equal(t, domain.RealtimeMeteringClient, report.Source)
			require.NotNil(t, report.Usage)
		})
	}
}

func TestAFinalReportWithNoKeyKeepsItsCloseFlag(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{}
	postUsage(t, registry, `{"usage":{"characters":50},"final":true,"duration_ms":9000}`)

	require.Len(t, registry.reportedUse, 1)
	report := registry.reportedUse[0]
	assert.Empty(t, report.ReportKey)
	assert.True(t, report.Final, "the control plane records it as one more amount, then closes")
	assert.Equal(t, int64(9000), report.DurationMS)
	assert.Equal(t, 50, report.Usage.InputChars)
}

// @scenario "An ElevenLabs socket client reports characters and audio seconds"
func TestAnElevenLabsReportCarriesCharactersOrSeconds(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{}
	postUsage(t, registry, `{"id":"chunk-1","usage":{"characters":123}}`)
	postUsage(t, registry, `{"id":"chunk-2","usage":{"audio_seconds":3.2},"final":true}`)

	require.Len(t, registry.reportedUse, 2)
	assert.Equal(t, "chunk-1", registry.reportedUse[0].ReportKey)
	assert.Equal(t, 123, registry.reportedUse[0].Usage.InputChars)
	assert.False(t, registry.reportedUse[0].Final)
	assert.InDelta(t, 3.2, registry.reportedUse[1].Usage.AudioSeconds, 0.0001)
	assert.True(t, registry.reportedUse[1].Final)
}

// @scenario "A transcription event with no usage records nothing"
func TestATranscriptionEventWithNoUsageCallsNoRegistry(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{}
	answer := postUsage(t, registry,
		`{"type":"conversation.item.input_audio_transcription.completed","item_id":"item_1","transcript":"hi"}`)

	assert.Empty(t, registry.reportedUse)
	assert.Equal(t, domain.RealtimeReportNoUsage, answer.Status)
	assert.Equal(t, "req_1", answer.SessionID)
}

// @scenario "A close ends the session with no usage"
func TestACloseIsAFinalReportWithNoUsage(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{receipts: []domain.RealtimeUsageReceipt{
		{Status: domain.RealtimeReportClosed, SessionCostNanoUSD: 900},
	}}
	application := New(WithRealtimeSessions(registry), WithLogger(zap.NewNop()))

	answer, err := application.CloseRealtimeSession(context.Background(), elevenLabsBundle(),
		RealtimeSessionClose{SessionID: "req_1", DurationMS: 42000})
	require.NoError(t, err)

	require.Len(t, registry.reportedUse, 1)
	report := registry.reportedUse[0]
	assert.Nil(t, report.Usage)
	assert.True(t, report.Final)
	assert.Empty(t, report.ReportKey)
	assert.Equal(t, int64(42000), report.DurationMS)
	assert.Equal(t, "vk-test", report.VirtualKeyID)
	assert.Equal(t, domain.RealtimeReportClosed, answer.Status)
	assert.Equal(t, int64(900), answer.SessionCostNanoUSD)
}

// @scenario "A usage body that is not a report is refused"
func TestAnUnreadableUsagePostIsRefusedBeforeTheRegistry(t *testing.T) {
	t.Parallel()

	for name, body := range map[string]string{
		"not json":           `nope`,
		"no usage, no close": `{}`,
		"unknown event":      `{"events":[{"type":"session.created"}]}`,
		"unkeyed in a batch": `{"events":[{"type":"response.done","response":{"usage":{"input_tokens":1,"output_tokens":1}}}]}`,
		"events not a list":  `{"events":{}}`,
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			registry := &mockRealtimeRegistry{}
			application := New(WithRealtimeSessions(registry), WithLogger(zap.NewNop()))

			_, err := application.ReportRealtimeUsage(context.Background(), elevenLabsBundle(),
				RealtimeUsagePost{SessionID: "req_1", Body: []byte(body)})
			require.Error(t, err)
			assert.True(t, herr.IsCode(err, domain.ErrBadRequest))
			assert.Empty(t, registry.reportedUse)
		})
	}
}

func TestARegistryFailureOnAReportIsReturned(t *testing.T) {
	t.Parallel()

	registry := &mockRealtimeRegistry{reportErr: herr.New(context.Background(), domain.ErrNotFound, nil)}
	application := New(WithRealtimeSessions(registry), WithLogger(zap.NewNop()))

	_, err := application.ReportRealtimeUsage(context.Background(), elevenLabsBundle(),
		RealtimeUsagePost{SessionID: "req_1", Body: []byte(`{"input_tokens":1,"output_tokens":1}`)})
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrNotFound))
}
