package dispatch

import (
	"context"
	"encoding/json"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

func bundleWithCreds(creds []auth.ProviderCred) *auth.Bundle {
	return &auth.Bundle{
		JWTClaims: auth.JWTClaims{VirtualKeyID: "vk_1", ProjectID: "p"},
		Config:    &auth.Config{VirtualKeyID: "vk_1", ProviderCreds: creds},
	}
}

func TestAccountReturnsOpenAIKey(t *testing.T) {
	creds := []byte(`{"api_key":"sk-test-openai"}`)
	b := bundleWithCreds([]auth.ProviderCred{{ID: "pc_1", Type: "openai", Credentials: json.RawMessage(creds)}})
	a := newAccount()
	ctx := withBundle(context.Background(), b)

	keys, err := a.GetKeysForProvider(ctx, bfschemas.OpenAI)
	if err != nil || len(keys) != 1 {
		t.Fatalf("got err=%v keys=%+v", err, keys)
	}
	if keys[0].Value.Val != "sk-test-openai" {
		t.Errorf("api key value: %q", keys[0].Value.Val)
	}
	if keys[0].ID != "pc_1" {
		t.Errorf("key id: %q", keys[0].ID)
	}
}

func TestAccountAliasesAzureOpenAI(t *testing.T) {
	creds := []byte(`{"api_key":"az-test","endpoint":"https://my.openai.azure.com"}`)
	b := bundleWithCreds([]auth.ProviderCred{{
		ID: "pc_a", Type: "azure_openai", Credentials: json.RawMessage(creds),
		DeploymentMap: map[string]string{"gpt-5-mini": "my-gpt5-deploy"},
	}})
	a := newAccount()
	ctx := withBundle(context.Background(), b)

	keys, err := a.GetKeysForProvider(ctx, bfschemas.Azure)
	if err != nil || len(keys) != 1 {
		t.Fatalf("got err=%v keys=%+v", err, keys)
	}
	if keys[0].AzureKeyConfig == nil || keys[0].AzureKeyConfig.Endpoint.Val != "https://my.openai.azure.com" {
		t.Errorf("azure config: %+v", keys[0].AzureKeyConfig)
	}
	if keys[0].AzureKeyConfig.Deployments["gpt-5-mini"] != "my-gpt5-deploy" {
		t.Errorf("deployment map: %+v", keys[0].AzureKeyConfig.Deployments)
	}
}

func TestAccountBedrockMapsRegionFromCredsThenPC(t *testing.T) {
	creds := []byte(`{"access_key":"A","secret_key":"B"}`)
	b := bundleWithCreds([]auth.ProviderCred{{
		ID: "pc_b", Type: "bedrock", Credentials: json.RawMessage(creds), Region: "us-east-1",
	}})
	a := newAccount()
	ctx := withBundle(context.Background(), b)
	keys, err := a.GetKeysForProvider(ctx, bfschemas.Bedrock)
	if err != nil || len(keys) != 1 {
		t.Fatalf("got err=%v keys=%+v", err, keys)
	}
	if keys[0].BedrockKeyConfig.Region == nil || keys[0].BedrockKeyConfig.Region.Val != "us-east-1" {
		t.Errorf("region not picked from pc: %+v", keys[0].BedrockKeyConfig)
	}
}

func TestAccountNoBundleIsError(t *testing.T) {
	a := newAccount()
	if _, err := a.GetKeysForProvider(context.Background(), bfschemas.OpenAI); err == nil {
		t.Fatal("expected error when ctx has no bundle")
	}
}

func TestAccountConfiguredProvidersIsStandardList(t *testing.T) {
	a := newAccount()
	provs, err := a.GetConfiguredProviders()
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if len(provs) < 10 {
		t.Errorf("expected wide provider list, got %d", len(provs))
	}
}

func TestAccountFiltersOtherProviders(t *testing.T) {
	creds := []byte(`{"api_key":"x"}`)
	b := bundleWithCreds([]auth.ProviderCred{
		{ID: "pc_oa", Type: "openai", Credentials: json.RawMessage(creds)},
		{ID: "pc_an", Type: "anthropic", Credentials: json.RawMessage(creds)},
	})
	a := newAccount()
	ctx := withBundle(context.Background(), b)
	keys, err := a.GetKeysForProvider(ctx, bfschemas.Anthropic)
	if err != nil || len(keys) != 1 {
		t.Fatalf("got err=%v keys=%+v", err, keys)
	}
	if keys[0].ID != "pc_an" {
		t.Errorf("wrong key returned: %q", keys[0].ID)
	}
}
