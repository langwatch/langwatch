package domain

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
)

// A link to a page nobody wrote is worse than no link: it reads as an answer
// and ends on a 404, at the moment the reader is already stuck.
// @scenario "A terminal provider failure tells the caller how to fix it"
func TestRemediationDocsPathsAllExist(t *testing.T) {
	root := repoRoot(t)

	for _, path := range RemediationDocsPaths() {
		t.Run(path, func(t *testing.T) {
			assert.True(t, strings.HasPrefix(path, "/"),
				"docs paths are leading-slashed Mintlify paths, not URLs")
			page := filepath.Join(root, "docs", strings.TrimPrefix(path, "/")+".mdx")
			_, err := os.Stat(page)
			assert.NoErrorf(t, err, "%s links to docs/%s.mdx, which does not exist",
				path, strings.TrimPrefix(path, "/"))
		})
	}
}

// The Vertex report that started this: a credential failure whose only advice
// was "check your credentials" left the reader choosing between a malformed
// document, a missing "type", a wrong project and an unpermitted service
// account — and, as the report showed, guessing at the region instead.
// @scenario "A terminal provider failure tells the caller how to fix it"
func TestRemediate_VertexCredentialFailureNamesWhatVertexNeeds(t *testing.T) {
	e := herr.E{
		Code: ErrProviderCredentialInvalid,
		Meta: herr.M{"message": "not accepted", "provider": "vertex"},
	}

	got := Remediate(e)

	tips, ok := got.Meta["tips"].([]string)
	require.True(t, ok, "tips must be attached")
	joined := strings.Join(tips, "\n")
	assert.Contains(t, joined, "service-account JSON document",
		"the reader is told what a Vertex credential IS")
	assert.Contains(t, joined, `"service_account"`,
		"and what makes one valid, which is the failure they actually hit")
	assert.Contains(t, joined, "global",
		"and that the location is not the cause, which is where the report went first")
	assert.Equal(t, "https://docs.langwatch.ai/ai-gateway/providers/vertex", got.Meta["docs_url"],
		"a Vertex failure links to the Vertex page, not the provider index")
}

// Each provider's credential is a different artifact, and generic advice is
// what makes a tip useless.
// @scenario "A terminal provider failure tells the caller how to fix it"
func TestRemediate_ProviderSpecificTipsAndDocs(t *testing.T) {
	cases := []struct {
		provider string
		wantTip  string
		wantDocs string
	}{
		{"bedrock", "AWS access key", "https://docs.langwatch.ai/ai-gateway/providers/bedrock"},
		{"azure", "resource endpoint", "https://docs.langwatch.ai/ai-gateway/providers/azure-openai"},
		{"gemini", "Generative Language API", "https://docs.langwatch.ai/ai-gateway/providers/gemini"},
	}

	for _, tc := range cases {
		t.Run(tc.provider, func(t *testing.T) {
			got := Remediate(herr.E{
				Code: ErrProviderCredentialInvalid,
				Meta: herr.M{"provider": tc.provider},
			})

			tips, _ := got.Meta["tips"].([]string)
			assert.Contains(t, strings.Join(tips, "\n"), tc.wantTip)
			assert.Equal(t, tc.wantDocs, got.Meta["docs_url"])
		})
	}
}

// An error naming no provider still gets the generic advice; a bare error is
// the outcome this registry exists to prevent.
// @scenario "A terminal provider failure tells the caller how to fix it"
func TestRemediate_UnknownProviderStillGetsGenericAdvice(t *testing.T) {
	got := Remediate(herr.E{Code: ErrProviderConfigInvalid, Meta: herr.M{}})

	tips, ok := got.Meta["tips"].([]string)
	require.True(t, ok)
	assert.NotEmpty(t, tips)
	assert.Equal(t, "https://docs.langwatch.ai/platform/model-providers", got.Meta["docs_url"])
}

// A construction site that composed tips from the specific thing that failed
// knows more than a code-level default. budget.go does exactly this.
// @scenario "A terminal provider failure tells the caller how to fix it"
func TestRemediate_NeverOverwritesWhatTheConstructionSiteSet(t *testing.T) {
	e := herr.E{
		Code: ErrProviderConfigInvalid,
		Meta: herr.M{
			"tips":     []string{"the specific thing that failed"},
			"docs_url": "https://docs.langwatch.ai/ai-gateway/budgets",
		},
	}

	got := Remediate(e)

	assert.Equal(t, []string{"the specific thing that failed"}, got.Meta["tips"])
	assert.Equal(t, "https://docs.langwatch.ai/ai-gateway/budgets", got.Meta["docs_url"])
}

// Remediate must not mutate the error it was handed — the same herr is read by
// the log line and the span after the response is written.
func TestRemediate_DoesNotMutateTheInputMeta(t *testing.T) {
	original := herr.M{"provider": "vertex"}
	e := herr.E{Code: ErrProviderCredentialInvalid, Meta: original}

	Remediate(e)

	assert.NotContains(t, original, "tips")
	assert.NotContains(t, original, "docs_url")
}

// A code with no entry passes through untouched rather than acquiring empty
// fields nobody wrote.
func TestRemediate_LeavesUnregisteredCodesAlone(t *testing.T) {
	got := Remediate(herr.E{Code: ErrInternal, Meta: herr.M{"message": "boom"}})

	assert.NotContains(t, got.Meta, "tips")
	assert.NotContains(t, got.Meta, "docs_url")
}

// The codes this whole change introduced are the ones a reader is most likely
// to be stuck on, so none of them may ship bare.
// @scenario "A terminal provider failure tells the caller how to fix it"
func TestRemediate_EveryNewProviderCodeHasAdvice(t *testing.T) {
	for _, code := range []herr.Code{
		ErrProviderCredentialInvalid, ErrProviderCredentialRejected,
		ErrProviderConfigInvalid, ErrProviderConnectionFailed,
		ErrProviderTimeout, ErrRequestAbandoned,
	} {
		t.Run(string(code), func(t *testing.T) {
			got := Remediate(herr.E{Code: code, Meta: herr.M{}})
			tips, _ := got.Meta["tips"].([]string)
			assert.NotEmptyf(t, tips, "%s reaches callers with no advice at all", code)
		})
	}
}

// repoRoot walks up from the package directory to the checkout root, found by
// the docs/ directory the paths are resolved against.
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	require.NoError(t, err)
	for range 8 {
		if _, err := os.Stat(filepath.Join(dir, "docs", "docs.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatal("could not locate the repo root from the package directory")
	return ""
}
