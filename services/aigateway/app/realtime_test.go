package app

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

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
