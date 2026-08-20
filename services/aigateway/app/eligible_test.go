package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestEligibleCredentials(t *testing.T) {
	t.Parallel()

	mkCreds := func() []domain.Credential {
		return []domain.Credential{
			{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic},
			{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
			{ID: "gemini_1", ProviderID: domain.ProviderGemini},
			{ID: "anthropic_2", ProviderID: domain.ProviderAnthropic},
		}
	}

	tests := []struct {
		name     string
		resolved *domain.ResolvedModel
		wantIDs  []string
		wantErr  herr.Code
	}{
		{
			name:     "explicit anthropic provider keeps both anthropic creds in order",
			resolved: &domain.ResolvedModel{ProviderID: domain.ProviderAnthropic, ModelID: "claude-3-5-sonnet"},
			wantIDs:  []string{"anthropic_1", "anthropic_2"},
		},
		{
			name:     "explicit openai provider keeps the single openai cred",
			resolved: &domain.ResolvedModel{ProviderID: domain.ProviderOpenAI, ModelID: "gpt-4o-mini"},
			wantIDs:  []string{"openai_1"},
		},
		{
			name:     "implicit claude- model name infers anthropic",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "claude-3-5-sonnet-20241022"},
			wantIDs:  []string{"anthropic_1", "anthropic_2"},
		},
		{
			name:     "implicit gpt- model name infers openai",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "gpt-4o"},
			wantIDs:  []string{"openai_1"},
		},
		{
			name:     "implicit o1- model name infers openai",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "o1-mini"},
			wantIDs:  []string{"openai_1"},
		},
		{
			name:     "implicit o3- model name infers openai",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "o3-mini"},
			wantIDs:  []string{"openai_1"},
		},
		{
			name:     "implicit o4- model name infers openai",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "o4-mini"},
			wantIDs:  []string{"openai_1"},
		},
		{
			name:     "implicit gemini- model name infers gemini",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "gemini-2.5-pro"},
			wantIDs:  []string{"gemini_1"},
		},
		{
			name:     "unknown model leaves chain untouched",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "llama-3-70b"},
			wantIDs:  []string{"anthropic_1", "openai_1", "gemini_1", "anthropic_2"},
		},
		{
			name:     "explicit provider not reachable from scope hard-fails as not bound",
			resolved: &domain.ResolvedModel{ProviderID: domain.ProviderBedrock, ModelID: "bedrock-only"},
			wantErr:  domain.ErrProviderNotBound,
		},
		{
			name:     "nil resolved leaves chain untouched",
			resolved: nil,
			wantIDs:  []string{"anthropic_1", "openai_1", "gemini_1", "anthropic_2"},
		},
		{
			name:     "case-insensitive on model name",
			resolved: &domain.ResolvedModel{ProviderID: "", ModelID: "Claude-3-Opus"},
			wantIDs:  []string{"anthropic_1", "anthropic_2"},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := eligibleCredentials(context.Background(), mkCreds(), tc.resolved)
			if tc.wantErr != "" {
				if !herr.IsCode(err, tc.wantErr) {
					t.Fatalf("got err %v, want code %s", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			gotIDs := make([]string, len(got))
			for i, c := range got {
				gotIDs[i] = c.ID
			}
			if !equalSlices(gotIDs, tc.wantIDs) {
				t.Errorf("got %v want %v", gotIDs, tc.wantIDs)
			}
		})
	}
}

func TestEligibleCredentialsEmptyChain(t *testing.T) {
	got, err := eligibleCredentials(context.Background(), nil, &domain.ResolvedModel{ModelID: "gpt-4o"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("expected nil slice, got %v", got)
	}
}

func TestEligibleCredentialsPreservesPriority(t *testing.T) {
	// When multiple creds match, order MUST be preserved so existing
	// fallback semantics (try first cred, then next) keep working.
	creds := []domain.Credential{
		{ID: "primary_anthropic", ProviderID: domain.ProviderAnthropic},
		{ID: "openai_first", ProviderID: domain.ProviderOpenAI},
		{ID: "secondary_anthropic", ProviderID: domain.ProviderAnthropic},
	}
	got, err := eligibleCredentials(context.Background(), creds, &domain.ResolvedModel{ProviderID: domain.ProviderAnthropic})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d creds, want 2", len(got))
	}
	if got[0].ID != "primary_anthropic" || got[1].ID != "secondary_anthropic" {
		t.Errorf("priority not preserved: got %s, %s", got[0].ID, got[1].ID)
	}
}

func equalSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestEligibleCredentialsImplicitNoMatchKeepsSafetyNet(t *testing.T) {
	// A bare model name (no provider prefix) whose inferred provider has
	// no credential must NOT hard-fail: without a prefix on the model
	// string, each attempt dispatches with the credential's own provider
	// and surfaces that provider's real error.
	creds := []domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
	}
	got, err := eligibleCredentials(context.Background(), creds, &domain.ResolvedModel{ProviderID: "", ModelID: "gemini-2.5-pro"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].ID != "openai_1" {
		t.Errorf("safety net not applied: got %v", got)
	}
}

func TestEligibleCredentialsEmptyChainDefersToNoProviderConfigured(t *testing.T) {
	// A VK with zero credentials is a different customer problem than a
	// VK missing one provider: the org has configured nothing at all, so
	// "bind a bedrock slot" is the wrong advice. This helper stays silent
	// and lets candidateChain raise no_provider_configured, which names
	// the actual next step. Both are 400s, so the status contract holds.
	got, err := eligibleCredentials(context.Background(), nil, &domain.ResolvedModel{
		ProviderID: domain.ProviderBedrock, ModelID: "anthropic.claude-3-5-sonnet",
	})
	if err != nil {
		t.Fatalf("empty chain must not hard-fail here: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty chain to pass through, got %v", got)
	}
}

// geminiPassthrough is a request on the Gemini /v1beta route, the shape
// gemini-cli and the @google/genai SDK send.
func geminiPassthrough() *domain.Request {
	return &domain.Request{
		Type:    domain.RequestTypePassthrough,
		Model:   "gemini-2.5-flash",
		Surface: domain.GeminiSurface(),
	}
}

// @scenario "Either Google credential serves the provider-native route"
func TestSurfaceCredentialsKeepsEveryProviderThatSpeaksTheRoute(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		creds   []domain.Credential
		wantIDs []string
	}{
		{
			name: "gemini credential serves it",
			creds: []domain.Credential{
				{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
				{ID: "gemini_1", ProviderID: domain.ProviderGemini},
			},
			wantIDs: []string{"gemini_1"},
		},
		{
			// Bifrost's Vertex passthrough rewrites an inbound Google path
			// into the project-and-location form, so a Vertex credential
			// reaches Google for this route too. Pinning the route to Gemini
			// alone would refuse a key that can serve the request.
			name: "vertex credential serves it with no gemini credential present",
			creds: []domain.Credential{
				{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
				{ID: "vertex_1", ProviderID: domain.ProviderVertex},
			},
			wantIDs: []string{"vertex_1"},
		},
		{
			name: "both Google credentials stay, in chain order",
			creds: []domain.Credential{
				{ID: "vertex_1", ProviderID: domain.ProviderVertex},
				{ID: "elevenlabs_1", ProviderID: domain.ProviderElevenLabs},
				{ID: "gemini_1", ProviderID: domain.ProviderGemini},
			},
			wantIDs: []string{"vertex_1", "gemini_1"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := surfaceCredentials(context.Background(), tc.creds, geminiPassthrough())
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			gotIDs := make([]string, len(got))
			for i, c := range got {
				gotIDs[i] = c.ID
			}
			if !equalSlices(gotIDs, tc.wantIDs) {
				t.Errorf("got %v want %v", gotIDs, tc.wantIDs)
			}
		})
	}
}

func TestSurfaceCredentialsRefusesAKeyThatCannotSpeakTheRoute(t *testing.T) {
	t.Parallel()

	// The reported defect: this chain used to survive the trim, and the
	// Gemini-shaped body went to whichever credential came first.
	creds := []domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
		{ID: "elevenlabs_1", ProviderID: domain.ProviderElevenLabs},
	}
	got, err := surfaceCredentials(context.Background(), creds, geminiPassthrough())
	if !herr.IsCode(err, domain.ErrProviderNotBound) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrProviderNotBound)
	}
	if got != nil {
		t.Errorf("a refusal must hand back no credentials, got %v", got)
	}
}

// @scenario "A translated route leaves the provider choice to the model"
func TestSurfaceCredentialsLeavesTranslatedRoutesAlone(t *testing.T) {
	t.Parallel()

	// Everything under /v1 is rewritten per provider before it leaves, so
	// any provider can serve it and the resolved model makes the choice.
	creds := []domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
		{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic},
	}
	got, err := surfaceCredentials(context.Background(), creds,
		&domain.Request{Type: domain.RequestTypeChat, Model: "gpt-4o"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Errorf("a translated route must not trim the chain, got %v", got)
	}
}

func TestSurfaceCredentialsEmptyChainDefersToNoProviderConfigured(t *testing.T) {
	t.Parallel()

	// A key with nothing configured is a different customer problem than a
	// key missing one provider, and "bind a Google slot" is the wrong advice
	// for it. Stay silent and let candidateChain raise no_provider_configured.
	got, err := surfaceCredentials(context.Background(), nil, geminiPassthrough())
	if err != nil {
		t.Fatalf("empty chain must not hard-fail here: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected the empty chain to pass through, got %v", got)
	}
}

// @scenario "A bare model name whose guessed vendor is absent still uses the key"
func TestEligibleCredentialsBareNameKeepsAnotherVendorsGateway(t *testing.T) {
	t.Parallel()

	// What the fallthrough is for. "gpt-4o" reads as OpenAI, but Azure,
	// Bedrock and Vertex all serve models under another vendor's bare name,
	// and a key holding only one of them must keep working. Removing the
	// fallthrough would refuse every Azure-only key that names a bare
	// OpenAI model, which is the common way to configure one.
	creds := []domain.Credential{{ID: "azure_1", ProviderID: domain.ProviderAzure}}
	got, err := eligibleCredentials(context.Background(), creds,
		&domain.ResolvedModel{ProviderID: "", ModelID: "gpt-4o", Source: domain.ModelSourceImplicit})
	if err != nil {
		t.Fatalf("a bare model name must not hard-fail: %v", err)
	}
	if len(got) != 1 || got[0].ID != "azure_1" {
		t.Errorf("the Azure credential must still serve a bare OpenAI model name, got %v", got)
	}
}

func TestProviderNames(t *testing.T) {
	t.Parallel()

	cases := []struct {
		in   []domain.ProviderID
		want string
	}{
		{in: []domain.ProviderID{domain.ProviderGemini}, want: `"gemini"`},
		{in: []domain.ProviderID{domain.ProviderGemini, domain.ProviderVertex}, want: `"gemini" or "vertex"`},
		{
			in:   []domain.ProviderID{domain.ProviderGemini, domain.ProviderVertex, domain.ProviderAzure},
			want: `"gemini", "vertex" or "azure"`,
		},
	}
	for _, tc := range cases {
		if got := providerNames(tc.in); got != tc.want {
			t.Errorf("providerNames(%v) = %s, want %s", tc.in, got, tc.want)
		}
	}
}

func herrMessage(t *testing.T, err error) string {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	var e herr.E
	if !errors.As(err, &e) {
		t.Fatalf("error is not a herr.E: %v", err)
	}
	msg, _ := e.Meta["message"].(string)
	return msg
}

// translatedChat is a /v1 request (no surface pin) resolved to an explicit
// provider, so routableChain's surface trim is a no-op and the model-aware
// trim decides. Used to drive the reason branches.
func translatedChat(kind domain.ProviderID) *domain.Request {
	return &domain.Request{
		Type:     domain.RequestTypeChat,
		Model:    "claude-3-5-sonnet",
		Resolved: &domain.ResolvedModel{ProviderID: kind, ModelID: "claude-3-5-sonnet"},
	}
}

// A key on a routing policy that omits the resolved provider is blocked with a
// message that names the routing policy, so the caller learns WHY the request
// was blocked rather than seeing an opaque wrong-provider failure.
//
// @scenario "A blocked request names why the resolved provider was not used"
func TestRoutableChain_BlockedByRoutingNamesPolicy(t *testing.T) {
	bundle := &domain.Bundle{
		Credentials: []domain.Credential{{ID: "openai_1", ProviderID: domain.ProviderOpenAI}},
		Config: domain.BundleConfig{
			RoutingExcludedProviders: []domain.ExcludedModelProvider{
				{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic},
			},
			RoutingPolicyName: "Cheap models",
		},
	}
	_, err := routableChain(context.Background(), bundle, translatedChat(domain.ProviderAnthropic))
	if !herr.IsCode(err, domain.ErrModelNotAllowed) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrModelNotAllowed)
	}
	msg := herrMessage(t, err)
	if !strings.Contains(msg, "routing policy") || !strings.Contains(msg, "Cheap models") {
		t.Errorf("message must name the routing policy: %q", msg)
	}
}

func TestRoutableChain_BlockedByProviderAccess(t *testing.T) {
	bundle := &domain.Bundle{
		Credentials: []domain.Credential{{ID: "openai_1", ProviderID: domain.ProviderOpenAI}},
		Config: domain.BundleConfig{
			AccessExcludedProviders: []domain.ExcludedModelProvider{
				{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic},
			},
		},
	}
	_, err := routableChain(context.Background(), bundle, translatedChat(domain.ProviderAnthropic))
	if !herr.IsCode(err, domain.ErrModelNotAllowed) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrModelNotAllowed)
	}
	msg := herrMessage(t, err)
	if !strings.Contains(msg, "provider access") {
		t.Errorf("message must name provider access: %q", msg)
	}
}

func TestRoutableChain_NotReachableFromScope(t *testing.T) {
	bundle := &domain.Bundle{
		Credentials: []domain.Credential{{ID: "openai_1", ProviderID: domain.ProviderOpenAI}},
	}
	_, err := routableChain(context.Background(), bundle, translatedChat(domain.ProviderAnthropic))
	if !herr.IsCode(err, domain.ErrProviderNotBound) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrProviderNotBound)
	}
	msg := herrMessage(t, err)
	if !strings.Contains(msg, "not reachable from this key's scope") {
		t.Errorf("message must name the scope reason: %q", msg)
	}
}

// The surface trim runs BEFORE the model-aware trim: a raw-forward route whose
// key lacks the route's provider refuses on the surface, even when the model
// does not infer a provider (so the model-aware trim would otherwise let the
// chain through and dispatch the route-shaped body to a wrong vendor).
func TestRoutableChain_RawForwardSurfaceRefusesBeforeModelTrim(t *testing.T) {
	bundle := &domain.Bundle{
		Credentials: []domain.Credential{{ID: "openai_1", ProviderID: domain.ProviderOpenAI}},
	}
	req := geminiPassthrough()
	// A model that does not infer a provider: only the surface trim can catch
	// the wrong-vendor dispatch here.
	req.Resolved = &domain.ResolvedModel{ProviderID: "", ModelID: "some-unlisted-model"}

	_, err := routableChain(context.Background(), bundle, req)
	if !herr.IsCode(err, domain.ErrProviderNotBound) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrProviderNotBound)
	}
	msg := herrMessage(t, err)
	if !strings.Contains(msg, "gemini") {
		t.Errorf("the surface refusal must name the route's providers: %q", msg)
	}
}

// A raw-forward Gemini route whose key has no Google credential because the
// routing policy dropped Gemini names the routing policy, not the generic
// surface not-reachable message. The surface trim empties the chain first, so
// the reason has to reach the caller through the surface-miss branch.
func TestRoutableChain_RawForwardSurfaceBlockedByRouting(t *testing.T) {
	bundle := &domain.Bundle{
		Credentials: []domain.Credential{{ID: "openai_1", ProviderID: domain.ProviderOpenAI}},
		Config: domain.BundleConfig{
			RoutingExcludedProviders: []domain.ExcludedModelProvider{
				{ID: "gemini_1", ProviderID: domain.ProviderGemini},
			},
			RoutingPolicyName: "Cheap models",
		},
	}
	req := geminiPassthrough()
	req.Resolved = &domain.ResolvedModel{ProviderID: domain.ProviderGemini, ModelID: "gemini-2.5-flash"}

	_, err := routableChain(context.Background(), bundle, req)
	if !herr.IsCode(err, domain.ErrModelNotAllowed) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrModelNotAllowed)
	}
	msg := herrMessage(t, err)
	if !strings.Contains(msg, "routing policy") || !strings.Contains(msg, "Cheap models") {
		t.Errorf("message must name the routing policy: %q", msg)
	}
}

// The same raw-forward surface miss, but Gemini sits outside the key's provider
// access rather than being dropped by the routing policy.
func TestRoutableChain_RawForwardSurfaceBlockedByProviderAccess(t *testing.T) {
	bundle := &domain.Bundle{
		Credentials: []domain.Credential{{ID: "openai_1", ProviderID: domain.ProviderOpenAI}},
		Config: domain.BundleConfig{
			AccessExcludedProviders: []domain.ExcludedModelProvider{
				{ID: "gemini_1", ProviderID: domain.ProviderGemini},
			},
		},
	}
	req := geminiPassthrough()
	req.Resolved = &domain.ResolvedModel{ProviderID: domain.ProviderGemini, ModelID: "gemini-2.5-flash"}

	_, err := routableChain(context.Background(), bundle, req)
	if !herr.IsCode(err, domain.ErrModelNotAllowed) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrModelNotAllowed)
	}
	msg := herrMessage(t, err)
	if !strings.Contains(msg, "provider access") {
		t.Errorf("message must name provider access: %q", msg)
	}
}

// A raw-forward surface miss where the route's provider is genuinely not
// reachable from the key's scope keeps the surface's own message: nothing in
// the excluded lists names it, so there is no more specific reason to give.
func TestRoutableChain_RawForwardSurfaceMissWithoutExclusionKeepsSurfaceReason(t *testing.T) {
	bundle := &domain.Bundle{
		Credentials: []domain.Credential{{ID: "openai_1", ProviderID: domain.ProviderOpenAI}},
	}
	req := geminiPassthrough()
	req.Resolved = &domain.ResolvedModel{ProviderID: domain.ProviderGemini, ModelID: "gemini-2.5-flash"}

	_, err := routableChain(context.Background(), bundle, req)
	if !herr.IsCode(err, domain.ErrProviderNotBound) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrProviderNotBound)
	}
	msg := herrMessage(t, err)
	if !strings.Contains(msg, "gemini") {
		t.Errorf("the surface refusal must name the route's providers: %q", msg)
	}
}

// The Phase 1 configuration that surfaced this gap: a key whose allowlist names
// only a scope-reachable provider its routing policy omits. The bundle then
// carries no dispatchable credential at all, so the chain is empty. An explicit
// request for that provider must still be told the routing policy blocked it,
// not the generic no_provider_configured that candidateChain raises from an
// empty chain. No spare credential is seeded: an unrelated one is exactly what
// hid the gap.
func TestRoutableChain_EmptyChainBlockedByRoutingNamesPolicy(t *testing.T) {
	bundle := &domain.Bundle{
		Config: domain.BundleConfig{
			RoutingExcludedProviders: []domain.ExcludedModelProvider{
				{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic},
			},
			RoutingPolicyName: "Cheap models",
		},
	}
	_, err := routableChain(context.Background(), bundle, translatedChat(domain.ProviderAnthropic))
	if !herr.IsCode(err, domain.ErrModelNotAllowed) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrModelNotAllowed)
	}
	if herr.IsCode(err, domain.ErrNoProviderConfigured) {
		t.Fatal("an excluded provider must not read as an unconfigured organization")
	}
	msg := herrMessage(t, err)
	if !strings.Contains(msg, "routing policy") || !strings.Contains(msg, "Cheap models") {
		t.Errorf("message must name the routing policy: %q", msg)
	}
}

// The raw-forward variant of the empty-chain gap: a Gemini passthrough whose key
// dispatches to nothing because Gemini is the only allowlisted provider and the
// routing policy omits it.
func TestRoutableChain_EmptyChainRawForwardBlockedByRoutingNamesPolicy(t *testing.T) {
	bundle := &domain.Bundle{
		Config: domain.BundleConfig{
			RoutingExcludedProviders: []domain.ExcludedModelProvider{
				{ID: "gemini_1", ProviderID: domain.ProviderGemini},
			},
			RoutingPolicyName: "Cheap models",
		},
	}
	req := geminiPassthrough()
	req.Resolved = &domain.ResolvedModel{ProviderID: domain.ProviderGemini, ModelID: "gemini-2.5-flash"}

	_, err := routableChain(context.Background(), bundle, req)
	if !herr.IsCode(err, domain.ErrModelNotAllowed) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrModelNotAllowed)
	}
	if herr.IsCode(err, domain.ErrNoProviderConfigured) {
		t.Fatal("an excluded provider must not read as an unconfigured organization")
	}
	msg := herrMessage(t, err)
	if !strings.Contains(msg, "routing policy") || !strings.Contains(msg, "Cheap models") {
		t.Errorf("message must name the routing policy: %q", msg)
	}
}

// The same empty chain, but the only allowlisted provider is outside provider
// access rather than dropped by the routing policy.
func TestRoutableChain_EmptyChainBlockedByProviderAccess(t *testing.T) {
	bundle := &domain.Bundle{
		Config: domain.BundleConfig{
			AccessExcludedProviders: []domain.ExcludedModelProvider{
				{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic},
			},
		},
	}
	_, err := routableChain(context.Background(), bundle, translatedChat(domain.ProviderAnthropic))
	if !herr.IsCode(err, domain.ErrModelNotAllowed) {
		t.Fatalf("got err %v, want code %s", err, domain.ErrModelNotAllowed)
	}
	msg := herrMessage(t, err)
	if !strings.Contains(msg, "provider access") {
		t.Errorf("message must name provider access: %q", msg)
	}
}

// An empty chain with no exclusion metadata is a genuinely unconfigured bundle:
// routableChain leaves it empty with no error, so candidateChain still raises
// no_provider_configured. The reason branch must not manufacture a block here.
func TestRoutableChain_EmptyChainNoExclusionStaysUnconfigured(t *testing.T) {
	bundle := &domain.Bundle{}
	creds, err := routableChain(
		context.Background(),
		bundle,
		translatedChat(domain.ProviderAnthropic),
	)
	if err != nil {
		t.Fatalf("a bundle with no exclusion metadata must stay unconfigured, got %v", err)
	}
	if len(creds) != 0 {
		t.Errorf("expected an empty chain, got %v", creds)
	}
}
