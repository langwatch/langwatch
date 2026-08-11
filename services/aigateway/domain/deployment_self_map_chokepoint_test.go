package domain

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
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
// @scenario "Credential construction passes through exactly one deployment chokepoint"
func TestWithDeploymentSelfMap_HasExactlyOneCallSiteInTheGateway(t *testing.T) {
	// go test runs with the package directory as cwd, so this is
	// services/aigateway.
	root, err := filepath.Abs("..")
	require.NoError(t, err)

	// os.Root scopes every read below to the services/aigateway subtree: a
	// symlink inside it cannot resolve to a path outside root, so the walk
	// cannot be TOCTOU'd into reading a file the callback never intended.
	rootDir, err := os.OpenRoot(root)
	require.NoError(t, err)
	defer rootDir.Close()

	// The `domain.` qualifier and the `(` are load-bearing: the bare
	// identifier also matches this helper's own definition and doc comment,
	// so that grep could never equal one.
	const needle = "domain.WithDeploymentSelfMap("
	var callSites []string

	require.NoError(t, fs.WalkDir(rootDir.FS(), ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		content, err := rootDir.ReadFile(path)
		if err != nil {
			return err
		}
		for i, line := range strings.Split(string(content), "\n") {
			if strings.Contains(line, needle) {
				// path is already root-relative and forward-slash separated.
				callSites = append(callSites,
					filepath.Join("services", "aigateway", path)+":"+strconv.Itoa(i+1))
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
// mistake them for deployment-routed providers. The scenario's other half, that
// no Azure key configuration is fabricated for them, is held one layer out in
// adapters/providers/azure_deployment_selfmap_test.go.
//
// @scenario "Providers without deployments are left untouched"
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

// AC15: the doc comment claimed "Every dispatch path shares this" and then
// enumerated the entry points that did — an enumeration the control-plane path
// was missing from. An engineer checking whether their path was covered got a
// wrong answer out of the prose, which is how this defect reached a third
// dispatch path. The prose is therefore part of the fix, and pinned like any
// other behavior.
//
// @scenario "The self-map helper's documented invariant is true after the fix"
func TestWithDeploymentSelfMap_DocCommentNamesTheControlPlanePath(t *testing.T) {
	// go test runs with the package directory as cwd, so the helper's own
	// source file sits next to this one.
	parsed, err := parser.ParseFile(token.NewFileSet(), "provider.go", nil, parser.ParseComments)
	require.NoError(t, err)

	var doc string
	for _, decl := range parsed.Decls {
		fn, isFunc := decl.(*ast.FuncDecl)
		if !isFunc || fn.Name.Name != "WithDeploymentSelfMap" || fn.Doc == nil {
			continue
		}
		doc = fn.Doc.Text()
		break
	}
	require.NotEmpty(t, doc, "the helper needs a doc comment before it can be correct")

	assert.NotContains(t, doc, "Every dispatch path shares this",
		"the claim was untrue when written: the control-plane path did not share the helper")
	assert.Contains(t, doc, "control-plane",
		"the doc must name the path this change added, or the next reader re-runs the same audit")
}
