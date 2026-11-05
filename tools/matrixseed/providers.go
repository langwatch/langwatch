// Package matrixseed seeds the fresh control plane a gateway-matrix run boots:
// one organization, one project, a model provider per provider the job holds
// credentials for, and one virtual key per model provider. It talks only to the
// public REST routes, starting from the instance administrator key.
//
// Spec: specs/ci/gateway-matrix-seed.feature
package matrixseed

import (
	"slices"
	"strings"
)

// Getenv reads one variable; os.Getenv in the command, a map in tests.
type Getenv func(key string) string

// Provider is one model provider the matrix has cells for.
type Provider struct {
	// Name is the model-provider registry key, the {provider} of the PUT route.
	Name string
	// Export is the variable the matrix cells read the virtual key from.
	Export string
	// keys builds the provider's customKeys from the job environment, or names
	// the variables it is missing.
	keys func(env Getenv) (map[string]string, []string)
}

// Planned is a provider the seed will store, with the keys it stores.
type Planned struct {
	Provider   Provider
	CustomKeys map[string]string
}

// Skipped is a provider the job holds no credentials for.
type Skipped struct {
	Provider Provider
	Missing  []string
}

// Providers lists every provider in the order the seed stores them. Each
// entry's keys follow the cell file header that reads its virtual key.
var Providers = []Provider{
	{Name: "openai", Export: "TEST_VK_OPENAI", keys: single("OPENAI_API_KEY")},
	{Name: "anthropic", Export: "TEST_VK_ANTHROPIC", keys: single("ANTHROPIC_API_KEY")},
	{Name: "gemini", Export: "TEST_VK_GEMINI", keys: single("GEMINI_API_KEY")},
	{Name: "azure", Export: "TEST_VK_AZURE", keys: azureKeys},
	{Name: "bedrock", Export: "TEST_VK_BEDROCK", keys: bedrockKeys},
	{Name: "vertex_ai", Export: "TEST_VK_VERTEX", keys: vertexKeys},
	{Name: "voyage", Export: "TEST_VK_VOYAGE", keys: single("VOYAGE_API_KEY")},
	{Name: "elevenlabs", Export: "TEST_VK_ELEVENLABS", keys: single("ELEVENLABS_API_KEY")},
}

// Plan splits Providers into those the environment holds credentials for and
// those it does not.
func Plan(env Getenv) ([]Planned, []Skipped) {
	var planned []Planned
	var skipped []Skipped
	for _, p := range Providers {
		keys, missing := p.keys(env)
		if len(missing) > 0 {
			skipped = append(skipped, Skipped{Provider: p, Missing: missing})
			continue
		}
		planned = append(planned, Planned{Provider: p, CustomKeys: keys})
	}
	return planned, skipped
}

// single is a provider whose whole credential is one API key, stored under the
// variable's own name.
func single(name string) func(Getenv) (map[string]string, []string) {
	return func(env Getenv) (map[string]string, []string) {
		return gather(env, map[string]string{name: name}, nil)
	}
}

func azureKeys(env Getenv) (map[string]string, []string) {
	return gather(env,
		map[string]string{"AZURE_OPENAI_API_KEY": "AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT": "AZURE_OPENAI_ENDPOINT"},
		map[string]string{"AZURE_OPENAI_API_VERSION": "AZURE_OPENAI_API_VERSION"})
}

// bedrockKeys stores the region and nothing else: with no access key on the
// model provider the gateway signs with the AWS default credential chain, which
// is the session the job's credentials step exported. The session is required
// only as evidence that the chain will find one; it is never stored.
func bedrockKeys(env Getenv) (map[string]string, []string) {
	var missing []string
	if env("AWS_ACCESS_KEY_ID") == "" && env("AWS_WEB_IDENTITY_TOKEN_FILE") == "" {
		missing = append(missing, "AWS_ACCESS_KEY_ID (an AWS session from the credentials step)")
	}
	region := firstSet(env, "AWS_REGION", "AWS_DEFAULT_REGION")
	if region == "" {
		missing = append(missing, "AWS_REGION or AWS_DEFAULT_REGION")
	}
	if len(missing) > 0 {
		return nil, missing
	}
	return map[string]string{"AWS_REGION_NAME": region}, nil
}

// vertexKeys needs a service-account JSON: the registry refuses a Vertex model
// provider without one, and Bifrost exchanges it for tokens itself.
func vertexKeys(env Getenv) (map[string]string, []string) {
	return gather(env, map[string]string{
		"GOOGLE_APPLICATION_CREDENTIALS": "VERTEX_SERVICE_ACCOUNT_JSON",
		"VERTEXAI_PROJECT":               "VERTEX_PROJECT",
		"VERTEXAI_LOCATION":              "VERTEX_LOCATION",
	}, nil)
}

// gather reads required and optional customKeys (key -> variable) from env.
func gather(env Getenv, required, optional map[string]string) (map[string]string, []string) {
	keys := map[string]string{}
	var missing []string
	for key, variable := range required {
		if v := strings.TrimSpace(env(variable)); v != "" {
			keys[key] = v
		} else {
			missing = append(missing, variable)
		}
	}
	if len(missing) > 0 {
		slices.Sort(missing)
		return nil, missing
	}
	for key, variable := range optional {
		if v := strings.TrimSpace(env(variable)); v != "" {
			keys[key] = v
		}
	}
	return keys, nil
}

func firstSet(env Getenv, names ...string) string {
	for _, n := range names {
		if v := strings.TrimSpace(env(n)); v != "" {
			return v
		}
	}
	return ""
}
