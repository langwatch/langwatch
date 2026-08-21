package app

import (
	"context"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// pick runs credential selection the way routableChain does, for a model the
// resolver has already read.
func pick(t *testing.T, cfg domain.BundleConfig, resolved *domain.ResolvedModel) ([]domain.Credential, error) {
	t.Helper()
	return eligibleCredentials(context.Background(), credentialChoice{creds: cfg.Credentials, resolved: resolved, cfg: cfg})
}

func bare(model string) *domain.ResolvedModel {
	return &domain.ResolvedModel{ModelID: model, Source: domain.ModelSourceImplicit}
}

// errMessage reads the customer-facing message off a handled error, the same
// field the HTTP boundary writes into the response body.
func errMessage(err error) string {
	return herr.Body(err).Message
}

func ids(creds []domain.Credential) []string {
	out := make([]string, len(creds))
	for i, c := range creds {
		out[i] = c.ID
	}
	return out
}

func mustPick(t *testing.T, cfg domain.BundleConfig, resolved *domain.ResolvedModel, want ...string) {
	t.Helper()
	got, err := pick(t, cfg, resolved)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	gotIDs := ids(got)
	if len(gotIDs) != len(want) {
		t.Fatalf("got %v, want %v", gotIDs, want)
	}
	for i := range want {
		if gotIDs[i] != want[i] {
			t.Fatalf("got %v, want %v", gotIDs, want)
		}
	}
}

// @scenario "A catalog model name reaches the provider that serves it"
func TestBareCatalogModelReachesItsProvider(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic, Models: []string{"claude-sonnet-5"}},
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI, Models: []string{"gpt-5-mini"}},
	}}

	mustPick(t, cfg, bare("gpt-5-mini"), "openai_1")
}

// @scenario "A catalog match beats the model-name guess table"
func TestCatalogBeatsTheGuessTable(t *testing.T) {
	t.Parallel()

	// "gpt-4o-clone" reads as OpenAI to the guess table, but the only provider
	// that says it serves the model is the custom one, and it is right.
	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic, Models: []string{"claude-sonnet-5"}},
		{ID: "custom_1", ProviderID: domain.ProviderCustom, Models: []string{"gpt-4o-clone"}},
	}}

	mustPick(t, cfg, bare("gpt-4o-clone"), "custom_1")
}

// @scenario "A declared model whose name contains a slash routes without a prefix"
func TestDeclaredSlashModelReachesItsProvider(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI, Models: []string{"gpt-5-mini"}},
		{ID: "custom_1", ProviderID: domain.ProviderCustom, Models: []string{"stealth/ox-alpha"}},
	}}

	mustPick(t, cfg, bare("stealth/ox-alpha"), "custom_1")
}

// @scenario "A deployment name containing a slash is matched whole"
func TestDeploymentMapKeyIsACatalogEntry(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI, Models: []string{"gpt-5-mini"}},
		{
			ID:            "azure_1",
			ProviderID:    domain.ProviderAzure,
			DeploymentMap: map[string]string{"team/gpt-5-prod": "gpt5prod"},
		},
	}}

	mustPick(t, cfg, bare("team/gpt-5-prod"), "azure_1")
}

// @scenario "Several providers declaring the same model keep the chain order"
// @scenario "The first matching instance in chain order serves the request"
func TestSeveralDeclaringProvidersKeepChainOrder(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "custom_a", ProviderID: domain.ProviderCustom, Models: []string{"shared-model"}},
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI, Models: []string{"gpt-5-mini"}},
		{ID: "custom_b", ProviderID: domain.ProviderCustom, Models: []string{"shared-model"}},
	}}

	mustPick(t, cfg, bare("shared-model"), "custom_a", "custom_b")
}

// @scenario "A model no catalog declares still uses the guess table"
func TestGuessTableStillCatchesANewModel(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic, Models: []string{"claude-sonnet-5"}},
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI, Models: []string{"gpt-5-mini"}},
	}}

	mustPick(t, cfg, bare("gpt-brand-new"), "openai_1")
}

// @scenario "A single-credential key forwards an undeclared model"
func TestSingleCredentialKeyForwardsAnUndeclaredModel(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "custom_1", ProviderID: domain.ProviderCustom},
	}}

	mustPick(t, cfg, bare("some-private-build"), "custom_1")
}

// A provider that never declared what it serves is not ruled out by a model it
// does not list. Without this, a Bedrock or Groq key, which ships no catalog,
// would refuse every bare model id it has always served.
func TestProvidersThatDeclaredNothingStayCandidates(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic, Models: []string{"claude-sonnet-5"}},
		{ID: "bedrock_1", ProviderID: domain.ProviderBedrock},
	}}

	mustPick(t, cfg, bare("anthropic.claude-sonnet-4-5-v1:0"), "bedrock_1")
}

// @scenario "An unplaceable model on a multi-credential key is refused"
func TestUnplaceableModelOnAMultiCredentialKeyIsRefused(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic, Models: []string{"claude-sonnet-5"}},
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI, Models: []string{"gpt-5-mini"}},
	}}

	_, err := pick(t, cfg, bare("private-build"))
	if !herr.IsCode(err, domain.ErrModelNotRecognized) {
		t.Fatalf("got %v, want model_not_recognized", err)
	}
	text := errMessage(err)
	for _, want := range []string{"anthropic", "openai", "private-build"} {
		if !strings.Contains(text, want) {
			t.Errorf("the refusal must name %q: %s", want, text)
		}
	}
	if fault := herr.Body(err).Fault; fault != "customer" {
		t.Errorf("got fault %q, want customer", fault)
	}
}

// @scenario "The refusal lists a bounded number of options"
func TestTheRefusalIsBounded(t *testing.T) {
	t.Parallel()

	var creds []domain.Credential
	for _, family := range []domain.ProviderID{
		domain.ProviderAnthropic, domain.ProviderOpenAI, domain.ProviderGemini,
		domain.ProviderVertex, domain.ProviderAzure, domain.ProviderBedrock,
		domain.ProviderXAI, domain.ProviderGroq, domain.ProviderCerebras,
		domain.ProviderDeepSeek, domain.ProviderVoyage, domain.ProviderCustom,
	} {
		creds = append(creds, domain.Credential{
			ID:         string(family) + "_1",
			ProviderID: family,
			Models:     []string{string(family) + "-only-model"},
		})
	}
	cfg := domain.BundleConfig{Credentials: creds}

	_, err := pick(t, cfg, bare("private-build"))
	if !herr.IsCode(err, domain.ErrModelNotRecognized) {
		t.Fatalf("got %v, want model_not_recognized", err)
	}
	text := errMessage(err)
	if strings.Count(text, `", "`) >= maxReachableOptions {
		t.Errorf("the refusal listed more than %d options: %s", maxReachableOptions, text)
	}
	if !strings.Contains(text, "more") {
		t.Errorf("the refusal must say more options exist: %s", text)
	}
}

// @scenario "A handle prefix reaches its own instance"
// @scenario "A routing handle overrides the chain order"
func TestAHandlePinsOneInstance(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "anthropic_us", ProviderID: domain.ProviderAnthropic},
		{ID: "anthropic_eu", ProviderID: domain.ProviderAnthropic, Handle: "eu"},
	}}

	mustPick(t, cfg, &domain.ResolvedModel{
		ModelID:      "claude-sonnet-5",
		ProviderID:   domain.ProviderAnthropic,
		CredentialID: "anthropic_eu",
		Source:       domain.ModelSourceExplicit,
	}, "anthropic_eu")
}

// @scenario "A handle no provider on the key holds is refused with the reachable options"
func TestAHandleWithNoDispatchableRowIsRefused(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic},
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI, Handle: "main"},
	}}

	_, err := pick(t, cfg, &domain.ResolvedModel{
		ModelID:      "claude-sonnet-5",
		ProviderID:   domain.ProviderAnthropic,
		CredentialID: "anthropic_eu",
		Source:       domain.ModelSourceExplicit,
	})
	if !herr.IsCode(err, domain.ErrProviderNotBound) {
		t.Fatalf("got %v, want model_provider_not_bound", err)
	}
	text := errMessage(err)
	if !strings.Contains(text, "anthropic") {
		t.Errorf("the refusal must name the reachable families: %s", text)
	}
	// A caller who named a handle that reaches nothing cannot pick an
	// available instance unless the refusal names the handles that do.
	if !strings.Contains(text, `"main"`) {
		t.Errorf("the refusal must name the reachable routing handles: %s", text)
	}
}

// @scenario "A family prefix with no credential names the reachable families"
// @scenario "The refusal states the caller can fix it"
func TestAnAbsentFamilyNamesWhatTheKeyReaches(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{Credentials: []domain.Credential{
		{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic},
		{ID: "openai_1", ProviderID: domain.ProviderOpenAI, Handle: "main"},
	}}

	_, err := pick(t, cfg, &domain.ResolvedModel{
		ModelID:    "claude-3-haiku",
		ProviderID: domain.ProviderBedrock,
		Source:     domain.ModelSourceExplicit,
	})
	if !herr.IsCode(err, domain.ErrProviderNotBound) {
		t.Fatalf("got %v, want model_provider_not_bound", err)
	}
	text := errMessage(err)
	for _, want := range []string{"anthropic", "openai", "main"} {
		if !strings.Contains(text, want) {
			t.Errorf("the refusal must name %q: %s", want, text)
		}
	}
	if fault := herr.Body(err).Fault; fault != "customer" {
		t.Errorf("got fault %q, want customer", fault)
	}
}

// @scenario "A handle of a provider the routing policy dropped names the policy"
func TestExcludedHandleNamesTheRoutingPolicy(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{
		Credentials: []domain.Credential{
			{ID: "anthropic_us", ProviderID: domain.ProviderAnthropic},
		},
		RoutingExcludedProviders: []domain.ExcludedModelProvider{
			{ID: "anthropic_eu", ProviderID: domain.ProviderAnthropic, Handle: "eu"},
		},
		RoutingPolicyName: "eu-only",
	}
	resolved := &domain.ResolvedModel{
		ModelID:      "claude-sonnet-5",
		ProviderID:   domain.ProviderAnthropic,
		CredentialID: "anthropic_eu",
		Source:       domain.ModelSourceExplicit,
	}

	err := reasonForBlockedProvider(context.Background(), resolved, cfg)
	if err == nil {
		t.Fatal("a dropped row's handle must be explained")
	}
	text := errMessage(err)
	if !strings.Contains(text, "routing policy") || !strings.Contains(text, "eu-only") {
		t.Errorf("the refusal must name the routing policy: %s", text)
	}
}

// @scenario "A handle of a provider outside the key's provider access names the access list"
func TestExcludedHandleNamesTheProviderAccess(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{
		Credentials: []domain.Credential{
			{ID: "anthropic_us", ProviderID: domain.ProviderAnthropic},
		},
		AccessExcludedProviders: []domain.ExcludedModelProvider{
			{ID: "anthropic_eu", ProviderID: domain.ProviderAnthropic, Handle: "eu"},
		},
	}
	resolved := &domain.ResolvedModel{
		ModelID:      "claude-sonnet-5",
		ProviderID:   domain.ProviderAnthropic,
		CredentialID: "anthropic_eu",
		Source:       domain.ModelSourceExplicit,
	}

	err := reasonForBlockedProvider(context.Background(), resolved, cfg)
	if err == nil {
		t.Fatal("a dropped row's handle must be explained")
	}
	text := errMessage(err)
	if !strings.Contains(text, "provider access") {
		t.Errorf("the refusal must name the provider access list: %s", text)
	}
}

// A key holding a surviving row of the same family must not answer for the
// dropped row the caller actually named.
func TestADroppedRowDoesNotBorrowASurvivingRowsAnswer(t *testing.T) {
	t.Parallel()

	cfg := domain.BundleConfig{
		Credentials: []domain.Credential{
			{ID: "anthropic_us", ProviderID: domain.ProviderAnthropic},
		},
		RoutingExcludedProviders: []domain.ExcludedModelProvider{
			{ID: "anthropic_eu", ProviderID: domain.ProviderAnthropic, Handle: "eu"},
		},
	}

	// The surviving row is dispatchable, so a FAMILY-prefixed request must not
	// be told the policy dropped anthropic.
	family := &domain.ResolvedModel{
		ModelID: "claude-sonnet-5", ProviderID: domain.ProviderAnthropic, Source: domain.ModelSourceExplicit,
	}
	if got, err := pick(t, cfg, family); err != nil || len(got) != 1 || got[0].ID != "anthropic_us" {
		t.Fatalf("the family prefix must reach the surviving row: %v %v", ids(got), err)
	}
}

// A surface trim can drop the handled row while another row of the same family
// survives it. Naming the family then contradicts the same message's list of
// prefixes the key accepts, so the refusal names the handle the caller wrote.
//
// @scenario "A handle the request cannot reach is refused by its own name"
func TestATrimmedHandleNamesTheHandleNotTheFamily(t *testing.T) {
	t.Parallel()

	whole := []domain.Credential{
		{ID: "anthropic_1", ProviderID: domain.ProviderAnthropic},
		{ID: "anthropic_eu", ProviderID: domain.ProviderAnthropic, Handle: "eu"},
	}
	cfg := domain.BundleConfig{Credentials: whole}

	// The surface kept the unhandled Anthropic row and dropped the handled one.
	_, err := eligibleCredentials(context.Background(), credentialChoice{
		creds:     whole[:1],
		reachable: whole,
		cfg:       cfg,
		resolved: &domain.ResolvedModel{
			ModelID:      "claude-sonnet-5",
			ProviderID:   domain.ProviderAnthropic,
			CredentialID: "anthropic_eu",
			Source:       domain.ModelSourceExplicit,
		},
	})
	if !herr.IsCode(err, domain.ErrProviderNotBound) {
		t.Fatalf("got %v, want model_provider_not_bound", err)
	}
	text := errMessage(err)
	if !strings.Contains(text, `"eu"`) {
		t.Errorf("the refusal must name the handle: %s", text)
	}
	if strings.Contains(text, `The "anthropic" provider is not reachable`) {
		t.Errorf("the refusal must not deny a family it goes on to offer: %s", text)
	}
	if !strings.Contains(text, `"anthropic"`) {
		t.Errorf("the family is still reachable and must stay on offer: %s", text)
	}
}

// The steps after the guess table, in order. A provider that listed its models
// has already answered for a model it does not list; a provider that listed
// nothing has not, so silence keeps it a candidate. One door is not a choice
// between vendors, so a lone credential takes the model whatever it declared.
// Only a key holding several declaring providers is left with nothing to pick.
//
// @scenario "A bare model the guess cannot place falls back before it is refused"
func TestTheFallbackStepsAfterTheGuessTable(t *testing.T) {
	t.Parallel()

	t.Run("a provider that declared nothing stays a candidate", func(t *testing.T) {
		cfg := domain.BundleConfig{Credentials: []domain.Credential{
			{ID: "xai_1", ProviderID: domain.ProviderID("xai"), Models: []string{"grok-old"}},
			{ID: "custom_1", ProviderID: domain.ProviderCustom},
		}}
		creds, err := pick(t, cfg, bare("some-private-build"))
		if err != nil {
			t.Fatalf("got %v, want the silent provider", err)
		}
		if got := ids(creds); len(got) != 1 || got[0] != "custom_1" {
			t.Errorf("got %v, want only the provider that declared nothing", got)
		}
	})

	t.Run("a lone credential takes the model whatever it declared", func(t *testing.T) {
		cfg := domain.BundleConfig{Credentials: []domain.Credential{
			{ID: "xai_1", ProviderID: domain.ProviderID("xai"), Models: []string{"grok-old"}},
		}}
		creds, err := pick(t, cfg, bare("grok-brand-new"))
		if err != nil {
			t.Fatalf("got %v, want the only door", err)
		}
		if got := ids(creds); len(got) != 1 || got[0] != "xai_1" {
			t.Errorf("got %v, want the lone credential", got)
		}
	})

	t.Run("several declaring providers leave nothing to pick", func(t *testing.T) {
		cfg := domain.BundleConfig{Credentials: []domain.Credential{
			{ID: "xai_1", ProviderID: domain.ProviderID("xai"), Models: []string{"grok-old"}},
			{ID: "deepseek_1", ProviderID: domain.ProviderID("deepseek"), Models: []string{"deepseek-chat-old"}},
		}}
		_, err := pick(t, cfg, bare("some-private-build"))
		if !herr.IsCode(err, domain.ErrModelNotRecognized) {
			t.Fatalf("got %v, want model_not_recognized", err)
		}
	})
}
