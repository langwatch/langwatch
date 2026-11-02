package matrixseed

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"
)

// allCredentials is a job holding every provider's credentials and an AWS session.
var allCredentials = map[string]string{
	"OPENAI_API_KEY":              "sk-openai",
	"ANTHROPIC_API_KEY":           "sk-ant",
	"GEMINI_API_KEY":              "gemini-key",
	"AZURE_OPENAI_API_KEY":        "azure-key",
	"AZURE_OPENAI_ENDPOINT":       "https://example.openai.azure.com/",
	"AWS_ACCESS_KEY_ID":           "ASIASESSION",
	"AWS_SECRET_ACCESS_KEY":       "session-secret",
	"AWS_SESSION_TOKEN":           "session-token",
	"AWS_DEFAULT_REGION":          "eu-central-1",
	"VERTEX_SERVICE_ACCOUNT_JSON": `{"type":"service_account"}`,
	"VERTEX_PROJECT":              "langwatch",
	"VERTEX_LOCATION":             "us-central1",
	"VOYAGE_API_KEY":              "voyage-key",
	"ELEVENLABS_API_KEY":          "el-key",
}

func run(t *testing.T, stubURL string, env map[string]string) Result {
	t.Helper()
	result, err := Run(context.Background(), Options{BaseURL: stubURL, InstanceAdminKey: instanceKey, Env: envOf(env)})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	return result
}

/** @scenario "The seed provisions one organization and one project through the public API" */
func TestRunProvisionsOneOrganizationAndProject(t *testing.T) {
	stub, server := newStub(t, nil)
	result := run(t, server.URL, nil)

	orgs := stub.calls(http.MethodPost, "/api/v1/organizations")
	if len(orgs) != 1 || orgs[0].Bearer != instanceKey {
		t.Fatalf("want one organization provisioned with the instance key, got %+v", orgs)
	}
	projects := stub.calls(http.MethodPost, "/api/v1/projects")
	if len(projects) != 1 || projects[0].Bearer != adminKey || projects[0].Body["teamId"] != "team_1" {
		t.Fatalf("want one project in the org's team with the admin key, got %+v", projects)
	}
	if got := exported(result)["LW_PROJECT_API_KEY"]; got != serviceKey {
		t.Fatalf("LW_PROJECT_API_KEY = %q, want the project's service key", got)
	}
	if orgs[0].IdempotencyKey == "" || projects[0].IdempotencyKey == "" {
		t.Fatal("every create must carry an Idempotency-Key")
	}
}

/** @scenario "Each provider with credentials gets one model provider and one virtual key" */
func TestRunSeedsOneModelProviderAndVirtualKeyPerProvider(t *testing.T) {
	stub, server := newStub(t, nil)
	result := run(t, server.URL, allCredentials)

	if err := result.Err(); err != nil || len(result.Skipped) != 0 {
		t.Fatalf("want every provider seeded, got err=%v skipped=%+v", err, result.Skipped)
	}
	puts := stub.calls(http.MethodPut, "/api/v1/model-providers/")
	if len(puts) != len(Providers) {
		t.Fatalf("want %d model providers stored, got %d", len(Providers), len(puts))
	}
	for _, put := range puts {
		if put.Bearer != serviceKey || put.Body["enabled"] != true {
			t.Fatalf("%s: want an enabled row written with the project key, got %+v", put.Path, put)
		}
	}
	wantKeys := map[string]map[string]any{
		"openai":     {"OPENAI_API_KEY": "sk-openai"},
		"azure":      {"AZURE_OPENAI_API_KEY": "azure-key", "AZURE_OPENAI_ENDPOINT": "https://example.openai.azure.com/"},
		"vertex_ai":  {"GOOGLE_APPLICATION_CREDENTIALS": `{"type":"service_account"}`, "VERTEXAI_PROJECT": "langwatch", "VERTEXAI_LOCATION": "us-central1"},
		"elevenlabs": {"ELEVENLABS_API_KEY": "el-key"},
	}
	for _, put := range puts {
		provider := strings.TrimPrefix(put.Path, "/api/v1/model-providers/")
		if want, ok := wantKeys[provider]; ok && !reflect.DeepEqual(put.Body["customKeys"], want) {
			t.Errorf("%s customKeys = %v, want %v", provider, put.Body["customKeys"], want)
		}
	}

	vks := stub.calls(http.MethodPost, "/api/gateway/v1/virtual-keys")
	if len(vks) != len(Providers) {
		t.Fatalf("want %d virtual keys, got %d", len(Providers), len(vks))
	}
	for i, vk := range vks {
		want := []any{"mp_" + Providers[i].Name}
		config, _ := vk.Body["config"].(map[string]any)
		if !reflect.DeepEqual(config["providersAllowed"], want) || vk.Bearer != serviceKey {
			t.Errorf("virtual key %d: want providersAllowed %v with the project key, got %+v", i, want, vk)
		}
	}
	got := exported(result)
	for _, p := range Providers {
		if got[p.Export] != "lw_vk_matrix-"+p.Name {
			t.Errorf("%s = %q, want the %s key's secret", p.Export, got[p.Export], p.Name)
		}
	}
}

/** @scenario "The Bedrock model provider carries no access key" */
func TestBedrockModelProviderIsKeyless(t *testing.T) {
	stub, server := newStub(t, nil)
	result := run(t, server.URL, map[string]string{
		"AWS_ACCESS_KEY_ID": "ASIASESSION", "AWS_SECRET_ACCESS_KEY": "session-secret",
		"AWS_SESSION_TOKEN": "session-token", "AWS_DEFAULT_REGION": "eu-central-1",
	})

	puts := stub.calls(http.MethodPut, "/api/v1/model-providers/bedrock")
	if len(puts) != 1 {
		t.Fatalf("want one Bedrock model provider, got %d", len(puts))
	}
	want := map[string]any{"AWS_REGION_NAME": "eu-central-1"}
	if !reflect.DeepEqual(puts[0].Body["customKeys"], want) {
		t.Fatalf("Bedrock customKeys = %v, want only the region %v", puts[0].Body["customKeys"], want)
	}
	if exported(result)["TEST_VK_BEDROCK"] == "" {
		t.Fatal("TEST_VK_BEDROCK not exported")
	}
}

func TestBedrockPrefersAWSRegionAndNeedsASession(t *testing.T) {
	keys, missing := bedrockKeys(envOf(map[string]string{"AWS_WEB_IDENTITY_TOKEN_FILE": "/tmp/token", "AWS_REGION": "eu-west-1", "AWS_DEFAULT_REGION": "eu-central-1"}))
	if len(missing) != 0 || keys["AWS_REGION_NAME"] != "eu-west-1" {
		t.Fatalf("want AWS_REGION to win, got keys=%v missing=%v", keys, missing)
	}
	if _, missing := bedrockKeys(envOf(map[string]string{"AWS_DEFAULT_REGION": "eu-central-1"})); len(missing) != 1 {
		t.Fatalf("want a job without an AWS session to skip Bedrock, got missing=%v", missing)
	}
}

/** @scenario "A provider with no credentials is skipped, not failed" */
func TestProviderWithoutCredentialsIsSkipped(t *testing.T) {
	stub, server := newStub(t, nil)
	// Azure holds a key but no endpoint: half a credential is no credential.
	result := run(t, server.URL, map[string]string{"OPENAI_API_KEY": "sk-openai", "AZURE_OPENAI_API_KEY": "azure-key", "VERTEX_PROJECT": "langwatch"})

	if err := result.Err(); err != nil {
		t.Fatalf("a missing credential must not fail the seed: %v", err)
	}
	puts := stub.calls(http.MethodPut, "/api/v1/model-providers/")
	if len(puts) != 1 || puts[0].Path != "/api/v1/model-providers/openai" {
		t.Fatalf("want only OpenAI stored, got %+v", puts)
	}
	got := exported(result)
	if len(got) != 2 || got["TEST_VK_OPENAI"] == "" {
		t.Fatalf("want LW_PROJECT_API_KEY and TEST_VK_OPENAI only, got %v", got)
	}
	skipped := map[string][]string{}
	for _, s := range result.Skipped {
		skipped[s.Provider.Export] = s.Missing
	}
	if !reflect.DeepEqual(skipped["TEST_VK_AZURE"], []string{"AZURE_OPENAI_ENDPOINT"}) {
		t.Errorf("Azure skip names %v, want the endpoint", skipped["TEST_VK_AZURE"])
	}
	if !reflect.DeepEqual(skipped["TEST_VK_VERTEX"], []string{"VERTEX_LOCATION", "VERTEX_SERVICE_ACCOUNT_JSON"}) {
		t.Errorf("Vertex skip names %v", skipped["TEST_VK_VERTEX"])
	}
	if len(result.Skipped) != len(Providers)-1 {
		t.Errorf("want %d providers skipped, got %d", len(Providers)-1, len(result.Skipped))
	}
}

/** @scenario "A control plane refusal for one provider still seeds the others, and fails the step" */
func TestRefusalForOneProviderStillSeedsTheOthers(t *testing.T) {
	_, server := newStub(t, map[string]int{"/api/v1/model-providers/anthropic": http.StatusUnprocessableEntity})
	result := run(t, server.URL, map[string]string{"OPENAI_API_KEY": "sk-openai", "ANTHROPIC_API_KEY": "sk-ant"})

	got := exported(result)
	if got["TEST_VK_OPENAI"] == "" || got["TEST_VK_ANTHROPIC"] != "" {
		t.Fatalf("want OpenAI exported and Anthropic not, got %v", got)
	}
	err := result.Err()
	var refused *RefusedError
	if err == nil || !errors.As(err, &refused) || refused.Status != http.StatusUnprocessableEntity {
		t.Fatalf("want the refusal surfaced, got %v", err)
	}
	if !strings.Contains(err.Error(), "anthropic") || !strings.Contains(err.Error(), "refused by the stub") {
		t.Fatalf("want the error to name the provider and the answer, got %q", err)
	}
}

/** @scenario "A failed bootstrap exports nothing" */
func TestFailedBootstrapExportsNothing(t *testing.T) {
	_, server := newStub(t, map[string]int{"/api/v1/organizations": http.StatusUnauthorized})
	result, err := Run(context.Background(), Options{BaseURL: server.URL, InstanceAdminKey: instanceKey, Env: envOf(allCredentials)})
	if err == nil || !strings.Contains(err.Error(), "POST /api/v1/organizations answered 401") {
		t.Fatalf("want the refused call named, got %v", err)
	}
	if len(result.Exports) != 0 {
		t.Fatalf("want no exports, got %v", result.Exports)
	}
	if _, err := Run(context.Background(), Options{BaseURL: server.URL, Env: envOf(nil)}); err == nil {
		t.Fatal("want a run without an instance key refused")
	}
}
