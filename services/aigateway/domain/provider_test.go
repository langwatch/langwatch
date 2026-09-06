package domain

import "testing"

// WithDeploymentSelfMap takes and returns Credential by value, so callers may
// reasonably assume it does not touch what they passed in. DeploymentMap is a
// reference type, though, so writing straight through it would mutate the
// caller's map. Both current callers happen to reassign the result, which hides
// the aliasing — but this helper is exported from shared domain precisely so
// every dispatch path can reuse it, and the next caller that inspects its own
// credential after the call would silently observe a foreign deployment entry.
func TestWithDeploymentSelfMap_DoesNotMutateCallersMap(t *testing.T) {
	caller := map[string]string{"gpt-5-mini": "gpt-5-mini"}
	cred := Credential{
		ProviderID:    ProviderAzure,
		DeploymentMap: caller,
	}

	_ = WithDeploymentSelfMap(cred, "gpt-4.1")

	if _, leaked := caller["gpt-4.1"]; leaked {
		t.Fatalf("WithDeploymentSelfMap wrote into the caller's map: got %v, want the map it was handed to be untouched", caller)
	}
	if len(caller) != 1 {
		t.Fatalf("caller's map changed size: got %v, want exactly its original 1 entry", caller)
	}
}

func TestWithDeploymentSelfMap_ReturnsTheSelfMappedEntry(t *testing.T) {
	cred := WithDeploymentSelfMap(Credential{ProviderID: ProviderAzure}, "gpt-4.1")

	if got := cred.DeploymentMap["gpt-4.1"]; got != "gpt-4.1" {
		t.Fatalf("deployment self-map: got %q, want %q", got, "gpt-4.1")
	}
}

func TestWithDeploymentSelfMap_PreservesExistingEntriesWhenAdding(t *testing.T) {
	cred := WithDeploymentSelfMap(Credential{
		ProviderID:    ProviderAzure,
		DeploymentMap: map[string]string{"gpt-5-mini": "prod-mini"},
	}, "gpt-4.1")

	if got := cred.DeploymentMap["gpt-5-mini"]; got != "prod-mini" {
		t.Fatalf("pre-existing mapping lost: got %q, want %q", got, "prod-mini")
	}
	if got := cred.DeploymentMap["gpt-4.1"]; got != "gpt-4.1" {
		t.Fatalf("new mapping missing: got %q, want %q", got, "gpt-4.1")
	}
}

func TestWithDeploymentSelfMap_HonorsExplicitDeploymentOverBareModel(t *testing.T) {
	cred := WithDeploymentSelfMap(Credential{
		ProviderID: ProviderAzure,
		Extra:      map[string]string{"deployment": "my-custom-deploy"},
	}, "gpt-4.1")

	if got := cred.DeploymentMap["gpt-4.1"]; got != "my-custom-deploy" {
		t.Fatalf("explicit deployment ignored: got %q, want %q", got, "my-custom-deploy")
	}
}

// The request side and the credential side each used to carry their own
// spelling table, and they drifted: "vertex_ai" normalized on one side
// only, so a caller with a working Vertex credential resolved to a
// provider that matched none of their credentials. Both now share
// NormalizeProviderID; this pins the spellings that must survive.
func TestNormalizeProviderID(t *testing.T) {
	cases := map[string]ProviderID{
		"azure":         ProviderAzure,
		"azure_openai":  ProviderAzure,
		"bedrock":       ProviderBedrock,
		"aws_bedrock":   ProviderBedrock,
		"vertex":        ProviderVertex,
		"vertex_ai":     ProviderVertex,
		"google_vertex": ProviderVertex,
		"gemini":        ProviderGemini,
		"google_gemini": ProviderGemini,
		"anthropic":     ProviderAnthropic,
		"openai":        ProviderOpenAI,
		"openai_codex":  ProviderOpenAICodex,
		// Unknown providers pass through so a control plane that knows a
		// provider this build does not can still route on its own ID.
		"some_new_provider": ProviderID("some_new_provider"),
		"":                  ProviderID(""),
	}
	for raw, want := range cases {
		if got := NormalizeProviderID(raw); got != want {
			t.Errorf("NormalizeProviderID(%q) = %q, want %q", raw, got, want)
		}
	}
}
