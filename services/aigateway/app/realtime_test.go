package app

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// mockRealtimeRegistry stands in for the control plane's record of open
// voice sessions.
type mockRealtimeRegistry struct {
	reserveErr  error
	reserved    []domain.RealtimeReservation
	correlated  []domain.RealtimeCorrelation
	released    []domain.RealtimeRelease
	reportedUse []domain.RealtimeUsageReport
}

func (m *mockRealtimeRegistry) Reserve(_ context.Context, r domain.RealtimeReservation) error {
	if m.reserveErr != nil {
		return m.reserveErr
	}
	m.reserved = append(m.reserved, r)
	return nil
}

func (m *mockRealtimeRegistry) Correlate(_ context.Context, c domain.RealtimeCorrelation) error {
	m.correlated = append(m.correlated, c)
	return nil
}

func (m *mockRealtimeRegistry) Release(_ context.Context, r domain.RealtimeRelease) error {
	m.released = append(m.released, r)
	return nil
}

func (m *mockRealtimeRegistry) ReportUsage(_ context.Context, r domain.RealtimeUsageReport) error {
	m.reportedUse = append(m.reportedUse, r)
	return nil
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
