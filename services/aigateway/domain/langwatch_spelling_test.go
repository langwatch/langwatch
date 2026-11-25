package domain

import "testing"

// Spec: specs/self-hosting/connected-services/managed-models-provider.feature
//
// The prefix has to name a provider family the gateway knows, or
// "langwatch/gpt-5-mini" reads as a model id containing a slash and matches no
// credential, with nothing in the refusal to say why.

// @scenario "The langwatch prefix is read as a provider, not as part of a model name"
func TestLangWatchPrefixSplitsIntoProviderAndModel(t *testing.T) {
	providerID, model, ok := SplitModelSpelling("langwatch/gpt-5-mini")

	if !ok {
		t.Fatalf("langwatch/gpt-5-mini was not read as a provider-qualified model")
	}
	if providerID != ProviderLangWatch {
		t.Errorf("provider = %q, want %q", providerID, ProviderLangWatch)
	}
	if model != "gpt-5-mini" {
		t.Errorf("model = %q, want gpt-5-mini", model)
	}
}

func TestLangWatchPrefixIsReadThroughABundleConfigToo(t *testing.T) {
	resolved := BundleConfig{}.ReadSpelling("LangWatch/gpt-5-mini")

	if resolved.ProviderID != ProviderLangWatch {
		t.Errorf("provider = %q, want %q", resolved.ProviderID, ProviderLangWatch)
	}
	if resolved.ModelID != "gpt-5-mini" {
		t.Errorf("model = %q, want gpt-5-mini", resolved.ModelID)
	}
	if resolved.Source != ModelSourceExplicit {
		t.Errorf("source = %q, want explicit", resolved.Source)
	}
}
