package domain

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// This defect has shipped three times, each time on a newly added dispatch
// path that forgot to call the self-map helper (#5760 was the second). The
// durable fix is a single chokepoint every Azure / Bedrock / Vertex dispatch
// must pass through, so the next new path inherits it instead of re-deriving
// it — which is a countable property, not a stylistic one.
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature

// AC12: exactly one non-test call site inside services/aigateway.
//
// @scenario "The self-map helper has a single call site in the gateway"
func TestWithDeploymentSelfMap_HasExactlyOneCallSiteInTheGateway(t *testing.T) {
	// go test runs with the package directory as cwd, so this is
	// services/aigateway.
	root, err := filepath.Abs("..")
	require.NoError(t, err)

	// The `domain.` qualifier and the `(` are load-bearing: the bare
	// identifier also matches this helper's own definition and doc comment,
	// so that grep could never equal one.
	const needle = "domain.WithDeploymentSelfMap("
	var callSites []string

	require.NoError(t, filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		content, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for i, line := range strings.Split(string(content), "\n") {
			if strings.Contains(line, needle) {
				rel, _ := filepath.Rel(root, path)
				callSites = append(callSites,
					filepath.Join("services/aigateway", rel)+":"+strconv.Itoa(i+1))
			}
		}
		return nil
	}))

	assert.Len(t, callSites, 1,
		"every Azure/Bedrock/Vertex dispatch must resolve its deployment at one shared chokepoint, "+
			"otherwise the next dispatch path added will forget it again; found %v", callSites)
}

// AC10: the chokepoint must leave providers that do not route on deployment
// exactly as it found them — a nil map stays nil, so nothing downstream can
// mistake them for deployment-routed providers.
//
// Spec: specs/ai-gateway/azure-deployment-map-control-plane-path.feature
func TestWithDeploymentSelfMap_NonMappedProvidersAreUntouched(t *testing.T) {
	for _, providerID := range []ProviderID{
		ProviderOpenAI,
		ProviderAnthropic,
		ProviderGemini,
		ProviderCustom,
	} {
		t.Run(string(providerID), func(t *testing.T) {
			cred := Credential{ID: "cred-1", ProviderID: providerID, APIKey: "sk-test"}

			got := WithDeploymentSelfMap(cred, "gpt-5.3-mini")

			assert.Nil(t, got.DeploymentMap, "%s does not route on deployment", providerID)
			assert.Equal(t, cred, got)
		})
	}
}
