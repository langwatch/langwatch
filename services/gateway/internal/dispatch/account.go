package dispatch

import (
	"context"
	"encoding/json"
	"fmt"

	bfschemas "github.com/maximhq/bifrost/core/schemas"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
)

// vkAccount is the bifrost schemas.Account implementation. It supplies
// per-request provider credentials by reading the authenticated bundle off
// the request context (stuffed there by auth.Middleware and then threaded
// through the dispatcher).
//
// This is how we stay multi-tenant with a single bifrost.Init call: the
// Account rewrites its answer based on whichever VK is in flight.
type vkAccount struct{}

func newAccount() bfschemas.Account { return &vkAccount{} }

type bundleCtxKey struct{}
type credPinCtxKey struct{}

// withBundle attaches the resolved auth.Bundle to a context for the
// account to read later. Always use BundleFromDispatchContext to retrieve.
func withBundle(ctx context.Context, b *auth.Bundle) context.Context {
	return context.WithValue(ctx, bundleCtxKey{}, b)
}

// withCredentialPin narrows bifrost's key lookup to a single provider
// credential ID — used by the fallback engine so each attempt targets
// exactly one credential from VK.Config.fallback.chain. Empty string
// clears the pin (full-set lookup).
func withCredentialPin(ctx context.Context, credentialID string) context.Context {
	return context.WithValue(ctx, credPinCtxKey{}, credentialID)
}

func credentialPinFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(credPinCtxKey{}).(string); ok {
		return v
	}
	return ""
}

func bundleFromContext(ctx context.Context) *auth.Bundle {
	if v, ok := ctx.Value(bundleCtxKey{}).(*auth.Bundle); ok {
		return v
	}
	return nil
}

// GetConfiguredProviders returns the full static provider list. We let
// bifrost think every standard provider is configured; actual auth
// happens per-request via GetKeysForProvider based on the VK in ctx.
func (a *vkAccount) GetConfiguredProviders() ([]bfschemas.ModelProvider, error) {
	return bfschemas.StandardProviders, nil
}

// GetKeysForProvider hands bifrost the set of API keys to use for this
// request. We look at the VK bundle stuck on ctx, find all provider
// credentials of the given type, and convert them into bifrost Key
// structs. If the VK lists zero matching creds, we return an empty
// slice — bifrost surfaces that as a no-key error which we translate to
// model_not_allowed upstream.
func (a *vkAccount) GetKeysForProvider(ctx context.Context, providerKey bfschemas.ModelProvider) ([]bfschemas.Key, error) {
	b := bundleFromContext(ctx)
	if b == nil || b.Config == nil {
		return nil, fmt.Errorf("no VK bundle on context (provider=%s)", providerKey)
	}
	wantType := string(providerKey)
	pin := credentialPinFromContext(ctx)
	var keys []bfschemas.Key
	for _, pc := range b.Config.ProviderCreds {
		if pin != "" && pc.ID != pin {
			continue
		}
		if pc.Type != wantType && aliasProvider(pc.Type) != providerKey {
			continue
		}
		k, err := pcToBifrostKey(pc, providerKey)
		if err != nil {
			return nil, fmt.Errorf("convert provider cred %s: %w", pc.ID, err)
		}
		keys = append(keys, k)
	}
	return keys, nil
}

// GetConfigForProvider returns provider-specific network/auth settings.
// Returning nil signals bifrost to use defaults for the provider — that
// covers the 80% case (OpenAI, Anthropic, Gemini with standard base
// URLs). Per-VK base URL overrides live on the ProviderCred.BaseURL
// field and get threaded through in pcToBifrostKey.
func (a *vkAccount) GetConfigForProvider(providerKey bfschemas.ModelProvider) (*bfschemas.ProviderConfig, error) {
	return nil, nil
}

// aliasProvider maps LangWatch-side provider type names to bifrost's
// ModelProvider enum. Most are straight pass-through; a few need
// normalisation (e.g. "azure_openai" → "azure").
func aliasProvider(t string) bfschemas.ModelProvider {
	switch t {
	case "azure_openai":
		return bfschemas.Azure
	case "google_vertex":
		return bfschemas.Vertex
	case "aws_bedrock":
		return bfschemas.Bedrock
	case "google_gemini":
		return bfschemas.Gemini
	}
	return bfschemas.ModelProvider(t)
}

// pcToBifrostKey decodes the opaque JSON ProviderCred.Credentials field
// into a bifrost Key. Shape differs per provider (API key, Azure endpoint
// + client, Vertex service account, Bedrock IAM). We only populate the
// fields bifrost needs.
func pcToBifrostKey(pc auth.ProviderCred, provider bfschemas.ModelProvider) (bfschemas.Key, error) {
	k := bfschemas.Key{
		ID:     pc.ID,
		Name:   pc.ID,
		Weight: 1,
	}
	switch provider {
	case bfschemas.Azure:
		var creds struct {
			APIKey     string `json:"api_key"`
			Endpoint   string `json:"endpoint"`
			APIVersion string `json:"api_version,omitempty"`
		}
		if err := json.Unmarshal(pc.Credentials, &creds); err != nil {
			return k, err
		}
		k.Value = literalEnvVar(creds.APIKey)
		ep := literalEnvVar(creds.Endpoint)
		cfg := &bfschemas.AzureKeyConfig{
			Endpoint:    ep,
			Deployments: pc.DeploymentMap,
		}
		if creds.APIVersion != "" {
			v := literalEnvVar(creds.APIVersion)
			cfg.APIVersion = &v
		}
		k.AzureKeyConfig = cfg
	case bfschemas.Bedrock:
		var creds struct {
			AccessKey    string `json:"access_key"`
			SecretKey    string `json:"secret_key"`
			SessionToken string `json:"session_token,omitempty"`
			Region       string `json:"region,omitempty"`
		}
		if err := json.Unmarshal(pc.Credentials, &creds); err != nil {
			return k, err
		}
		cfg := &bfschemas.BedrockKeyConfig{
			AccessKey: literalEnvVar(creds.AccessKey),
			SecretKey: literalEnvVar(creds.SecretKey),
		}
		if creds.SessionToken != "" {
			v := literalEnvVar(creds.SessionToken)
			cfg.SessionToken = &v
		}
		if creds.Region != "" {
			v := literalEnvVar(creds.Region)
			cfg.Region = &v
		} else if pc.Region != "" {
			v := literalEnvVar(pc.Region)
			cfg.Region = &v
		}
		if len(pc.DeploymentMap) > 0 {
			cfg.Deployments = pc.DeploymentMap
		}
		k.BedrockKeyConfig = cfg
	case bfschemas.Vertex:
		var creds struct {
			ProjectID       string `json:"project_id"`
			ProjectNumber   string `json:"project_number"`
			Region          string `json:"region"`
			AuthCredentials string `json:"auth_credentials"`
		}
		if err := json.Unmarshal(pc.Credentials, &creds); err != nil {
			return k, err
		}
		k.VertexKeyConfig = &bfschemas.VertexKeyConfig{
			ProjectID:       literalEnvVar(creds.ProjectID),
			ProjectNumber:   literalEnvVar(creds.ProjectNumber),
			Region:          literalEnvVar(creds.Region),
			AuthCredentials: literalEnvVar(creds.AuthCredentials),
			Deployments:     pc.DeploymentMap,
		}
	default:
		// OpenAI / Anthropic / Gemini / Mistral / Groq / etc — just API key.
		var creds struct {
			APIKey string `json:"api_key"`
		}
		if err := json.Unmarshal(pc.Credentials, &creds); err != nil {
			return k, err
		}
		k.Value = literalEnvVar(creds.APIKey)
	}
	return k, nil
}

// literalEnvVar wraps a plain string in bifrost's EnvVar shape. Our VK
// creds are already resolved from the control plane, so we set Val
// directly with FromEnv=false (bifrost won't call os.Getenv).
func literalEnvVar(v string) bfschemas.EnvVar {
	return bfschemas.EnvVar{Val: v, FromEnv: false}
}
