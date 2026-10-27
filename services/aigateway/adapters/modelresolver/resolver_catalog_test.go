package modelresolver

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// configWith builds a bundle config from a credential chain.
func configWith(creds ...domain.Credential) domain.BundleConfig {
	return domain.BundleConfig{Credentials: creds}
}

func resolve(t *testing.T, cfg domain.BundleConfig, model string) *domain.ResolvedModel {
	t.Helper()
	resolved, err := New().Resolve(
		context.Background(),
		&domain.Request{Model: model, Type: domain.RequestTypeChat},
		cfg,
	)
	if err != nil {
		t.Fatalf("resolve %q: unexpected error: %v", model, err)
	}
	return resolved
}

// @scenario "A declared model whose name contains a slash routes without a prefix"
func TestSlashInDeclaredModelIsNotAPrefix(t *testing.T) {
	t.Parallel()

	cfg := configWith(domain.Credential{
		ID:         "custom_1",
		ProviderID: domain.ProviderCustom,
		Models:     []string{"stealth/ox-alpha"},
	})

	resolved := resolve(t, cfg, "stealth/ox-alpha")
	if resolved.ModelID != "stealth/ox-alpha" {
		t.Errorf("model id was split: got %q", resolved.ModelID)
	}
	if resolved.ProviderID != "" {
		t.Errorf("a model id must not name a provider: got %q", resolved.ProviderID)
	}
	if resolved.Source != domain.ModelSourceImplicit {
		t.Errorf("got source %q, want implicit", resolved.Source)
	}
}

// @scenario "A known family prefix keeps its meaning"
func TestKnownFamilyPrefixStillSplits(t *testing.T) {
	t.Parallel()

	cfg := configWith(
		domain.Credential{ID: "openai_1", ProviderID: domain.ProviderOpenAI},
		domain.Credential{ID: "custom_1", ProviderID: domain.ProviderCustom},
	)

	resolved := resolve(t, cfg, "openai/gpt-5-mini")
	if resolved.ProviderID != domain.ProviderOpenAI {
		t.Errorf("got provider %q, want openai", resolved.ProviderID)
	}
	if resolved.ModelID != "gpt-5-mini" {
		t.Errorf("got model %q, want gpt-5-mini", resolved.ModelID)
	}
}

// @scenario "A custom prefix keeps every segment after it"
// @scenario "A custom-prefixed model keeps every segment after the prefix"
func TestCustomPrefixKeepsMultiSegmentRemainder(t *testing.T) {
	t.Parallel()

	cfg := configWith(domain.Credential{ID: "custom_1", ProviderID: domain.ProviderCustom})

	resolved := resolve(t, cfg, "custom/stealth/ox-alpha")
	if resolved.ProviderID != domain.ProviderCustom {
		t.Errorf("got provider %q, want custom", resolved.ProviderID)
	}
	if resolved.ModelID != "stealth/ox-alpha" {
		t.Errorf("got model %q, want stealth/ox-alpha", resolved.ModelID)
	}
}

// Every alternative spelling the gateway accepts for a family has to keep
// splitting, since SDKs emit them and a key's credentials are stored under
// them.
func TestFamilyAliasSpellingsStillSplit(t *testing.T) {
	t.Parallel()

	cfg := configWith(domain.Credential{ID: "vertex_1", ProviderID: domain.ProviderVertex})

	for _, spelling := range []string{"vertex_ai", "google_vertex", "vertex"} {
		resolved := resolve(t, cfg, spelling+"/gemini-2.5-flash")
		if resolved.ProviderID != domain.ProviderVertex {
			t.Errorf("%q: got provider %q, want vertex", spelling, resolved.ProviderID)
		}
		if resolved.ModelID != "gemini-2.5-flash" {
			t.Errorf("%q: got model %q", spelling, resolved.ModelID)
		}
	}
}

// @scenario "A handle prefix reaches its own instance"
func TestHandlePrefixPinsTheInstance(t *testing.T) {
	t.Parallel()

	cfg := configWith(
		domain.Credential{ID: "anthropic_us", ProviderID: domain.ProviderAnthropic},
		domain.Credential{ID: "anthropic_eu", ProviderID: domain.ProviderAnthropic, Handle: "eu"},
	)

	resolved := resolve(t, cfg, "eu/claude-sonnet-5")
	if resolved.CredentialID != "anthropic_eu" {
		t.Errorf("got credential %q, want anthropic_eu", resolved.CredentialID)
	}
	if resolved.ProviderID != domain.ProviderAnthropic {
		t.Errorf("got provider %q, want anthropic", resolved.ProviderID)
	}
	if resolved.ModelID != "claude-sonnet-5" {
		t.Errorf("got model %q, want claude-sonnet-5", resolved.ModelID)
	}
}

// @scenario "A handle is read before the family table"
func TestHandleIsReadBeforeTheFamilyTable(t *testing.T) {
	t.Parallel()

	// The handle is not a family spelling (reserved words stop that at the
	// write), but the ORDER is what makes the guarantee, so it is pinned here.
	cfg := configWith(
		domain.Credential{ID: "gemini_1", ProviderID: domain.ProviderGemini},
		domain.Credential{ID: "gemini_eu", ProviderID: domain.ProviderGemini, Handle: "gemini-eu"},
	)

	resolved := resolve(t, cfg, "gemini-eu/gemini-3.7-flash")
	if resolved.CredentialID != "gemini_eu" {
		t.Errorf("got credential %q, want gemini_eu", resolved.CredentialID)
	}
}

// @scenario "The family prefix still reaches the chain in order"
func TestFamilyPrefixDoesNotPinAnInstance(t *testing.T) {
	t.Parallel()

	cfg := configWith(
		domain.Credential{ID: "anthropic_us", ProviderID: domain.ProviderAnthropic},
		domain.Credential{ID: "anthropic_eu", ProviderID: domain.ProviderAnthropic, Handle: "eu"},
	)

	resolved := resolve(t, cfg, "anthropic/claude-sonnet-5")
	if resolved.CredentialID != "" {
		t.Errorf("a family prefix must not pin an instance: got %q", resolved.CredentialID)
	}
}

// @scenario "A handle of a provider the routing policy dropped names the policy"
func TestHandleOfAnExcludedRowIsRecognized(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{
		Credentials: []domain.Credential{
			{ID: "anthropic_us", ProviderID: domain.ProviderAnthropic},
		},
		RoutingExcludedProviders: []domain.ExcludedModelProvider{
			{ID: "anthropic_eu", ProviderID: domain.ProviderAnthropic, Handle: "eu"},
		},
	}

	resolved := resolve(t, cfg, "eu/claude-sonnet-5")
	if resolved.CredentialID != "anthropic_eu" {
		t.Errorf("the excluded row's handle must resolve to that row: got %q", resolved.CredentialID)
	}
	if resolved.ModelID != "claude-sonnet-5" {
		t.Errorf("got model %q", resolved.ModelID)
	}
}

// @scenario "An alias to a whole model id resolves to that model"
func TestAliasToAWholeModelIDResolvesWhole(t *testing.T) {
	t.Parallel()

	cfg := configWith(domain.Credential{
		ID:         "custom_1",
		ProviderID: domain.ProviderCustom,
		Models:     []string{"stealth/ox-alpha"},
	})
	cfg.ModelAliases = map[string]domain.ModelAlias{
		// The wire decode leaves an unknown first segment whole, so this is
		// the shape the resolver receives.
		"fast": {Model: "stealth/ox-alpha"},
	}

	resolved := resolve(t, cfg, "fast")
	if resolved.ModelID != "stealth/ox-alpha" {
		t.Errorf("got model %q, want stealth/ox-alpha", resolved.ModelID)
	}
	if resolved.ProviderID != "" {
		t.Errorf("no provider called \"stealth\" may be looked for: got %q", resolved.ProviderID)
	}
	if resolved.Source != domain.ModelSourceAlias {
		t.Errorf("got source %q, want alias", resolved.Source)
	}
}

// @scenario "An alias can target a handle"
func TestAliasToAHandleResolvesTheInstance(t *testing.T) {
	t.Parallel()

	cfg := configWith(
		domain.Credential{ID: "anthropic_us", ProviderID: domain.ProviderAnthropic},
		domain.Credential{ID: "anthropic_eu", ProviderID: domain.ProviderAnthropic, Handle: "eu"},
	)
	cfg.ModelAliases = map[string]domain.ModelAlias{
		"fast": {Model: "eu/claude-haiku-4-5"},
	}

	resolved := resolve(t, cfg, "fast")
	if resolved.CredentialID != "anthropic_eu" {
		t.Errorf("got credential %q, want anthropic_eu", resolved.CredentialID)
	}
	if resolved.ModelID != "claude-haiku-4-5" {
		t.Errorf("got model %q, want claude-haiku-4-5", resolved.ModelID)
	}
}

// @scenario "An alias is applied before anything else is read"
func TestAliasWinsOverEveryOtherReading(t *testing.T) {
	t.Parallel()

	cfg := configWith(
		domain.Credential{ID: "openai_1", ProviderID: domain.ProviderOpenAI, Models: []string{"gpt-5-mini"}},
		domain.Credential{ID: "custom_1", ProviderID: domain.ProviderCustom, Models: []string{"gpt-5-mini"}},
	)
	cfg.ModelAliases = map[string]domain.ModelAlias{
		"gpt-5-mini": {ProviderID: domain.ProviderOpenAI, Model: "gpt-5-mini"},
	}

	resolved := resolve(t, cfg, "gpt-5-mini")
	if resolved.ProviderID != domain.ProviderOpenAI {
		t.Errorf("the alias must decide the provider: got %q", resolved.ProviderID)
	}
	if resolved.Source != domain.ModelSourceAlias {
		t.Errorf("got source %q, want alias", resolved.Source)
	}
}

// @scenario "The resolution order is alias, then handle, then family, then catalog, then guess"
func TestResolutionOrderIsFixed(t *testing.T) {
	t.Parallel()

	base := func() domain.BundleConfig {
		return configWith(
			domain.Credential{ID: "openai_1", ProviderID: domain.ProviderOpenAI, Models: []string{"gpt-5-mini"}},
			domain.Credential{ID: "custom_1", ProviderID: domain.ProviderCustom, Handle: "router", Models: []string{"stealth/ox-alpha"}},
		)
	}

	// Alias first.
	aliased := base()
	aliased.ModelAliases = map[string]domain.ModelAlias{"x": {ProviderID: domain.ProviderOpenAI, Model: "gpt-5-mini"}}
	if got := resolve(t, aliased, "x"); got.Source != domain.ModelSourceAlias {
		t.Errorf("alias step: got source %q", got.Source)
	}
	// Handle before family.
	if got := resolve(t, base(), "router/anything"); got.CredentialID != "custom_1" {
		t.Errorf("handle step: got credential %q", got.CredentialID)
	}
	// Family when no handle matches.
	if got := resolve(t, base(), "openai/gpt-5-mini"); got.ProviderID != domain.ProviderOpenAI || got.CredentialID != "" {
		t.Errorf("family step: got provider %q credential %q", got.ProviderID, got.CredentialID)
	}
	// Whole model id when neither matches.
	if got := resolve(t, base(), "stealth/ox-alpha"); got.ModelID != "stealth/ox-alpha" {
		t.Errorf("catalog step: got model %q", got.ModelID)
	}
}

// A models_allowed entry naming a model id that contains a slash must not be
// read as a provider prefix, or the allowlist silently allows nothing.
func TestAllowlistJudgesAWholeModelID(t *testing.T) {
	t.Parallel()

	cfg := configWith(domain.Credential{
		ID:         "custom_1",
		ProviderID: domain.ProviderCustom,
		Models:     []string{"stealth/ox-alpha"},
	})
	cfg.AllowedModels = []string{"stealth/ox-alpha"}

	resolved := resolve(t, cfg, "stealth/ox-alpha")
	if resolved.ModelID != "stealth/ox-alpha" {
		t.Errorf("got model %q", resolved.ModelID)
	}
}
