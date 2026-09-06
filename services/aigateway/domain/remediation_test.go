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

// Every path the registry can emit must resolve to a file under docs/, since
// nothing else checks them and a wrong one 404s only for the customer.
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
	assert.Contains(t, joined, "retrying will not clear it",
		"and that no retry helps — Vertex carries maxTips specific lines, so this "+
			"is the tip the cap drops unless tipsFor reserves its slot")
	assert.Equal(t, "https://docs.langwatch.ai/ai-gateway/providers/vertex", got.Meta["docs_url"],
		"a Vertex failure links to the Vertex page, not the provider index")
}

// vertex_ai is the credential provider id the reported failure actually
// carried. Keying only the docs map on it bought the Vertex page and the
// generic two-line advice — the exact "check your credentials" answer this
// file replaces, delivered under a link that looks specific.
// @scenario "A terminal provider failure tells the caller how to fix it"
func TestRemediate_VertexAliasResolvesTipsAndDocsAlike(t *testing.T) {
	e := herr.E{
		Code: ErrProviderCredentialInvalid,
		Meta: herr.M{"message": "not accepted", "provider": "vertex_ai"},
	}

	got := Remediate(e)

	tips, ok := got.Meta["tips"].([]string)
	require.True(t, ok, "tips must be attached")
	assert.Contains(t, strings.Join(tips, "\n"), "service-account JSON document",
		"vertex_ai resolves the same credential artifact as vertex")
	assert.Equal(t, "https://docs.langwatch.ai/ai-gateway/providers/vertex", got.Meta["docs_url"],
		"and the same page, so the two cannot disagree about who the provider is")
}

// A truncating capTips used to hand back a prefix of its input, which keeps
// the spare capacity of the array behind it. Appending to that prefix writes
// through into the source — and every source here is either the package-level
// registry or a slice built from it, so one consumer appending to meta["tips"]
// would rewrite the advice every later request in the process reads.
//
// Asserted on capTips directly: no registry entry is long enough to truncate
// today, so routing this through Remediate would assert nothing.
// @scenario "A terminal provider failure tells the caller how to fix it"
func TestCapTips_DoesNotAliasItsInput(t *testing.T) {
	source := []string{"a", "b", "c", "d", "e", "f"}
	require.Greater(t, len(source), maxTips, "the input must be long enough to truncate")

	capped := capTips(source)
	require.Len(t, capped, maxTips)
	_ = append(capped, "appended by a consumer")

	assert.Equal(t, "e", source[maxTips],
		"the append wrote through the returned prefix into the source slice")
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

// The client truncates tips on arrival (MAX_TIPS in readHandledError.ts), from
// the END, so anything past the fourth is not shown however it got there. That
// is why the cap is applied here, where the ordering can decide what survives:
// Vertex contributes four provider-specific tips on top of two generic ones,
// and the provider-specific ones are the reason this registry exists.
//
// The last slot is not theirs to take, though. The spec requires every
// credential answer to say the failure is terminal, and Vertex alone carries
// enough specific lines to push that sentence out — so the surviving four are
// the three highest-value Vertex lines plus the terminality statement, not the
// four Vertex lines. Asserted as an exact list because the failure this guards
// is a tip going missing.
// @scenario "A provider-setup failure tells the customer how to fix it"
func TestRemediate_CapsTipsSoTheProviderSpecificOnesSurvive(t *testing.T) {
	generic := registry[ErrProviderCredentialInvalid].tips
	specific := providerCredentialTips["vertex"]
	require.Greater(t, len(specific)+len(generic), maxTips,
		"vertex must over-fill the cap, or this test proves nothing")
	require.GreaterOrEqual(t, len(specific), maxTips,
		"vertex must fill the cap on its own, or the reserved slot proves nothing")

	got := Remediate(herr.E{
		Code: ErrProviderCredentialInvalid,
		Meta: herr.M{"provider": "vertex"},
	})

	tips, ok := got.Meta["tips"].([]string)
	require.True(t, ok)
	assert.Len(t, tips, maxTips, "more than this and the client drops the tail unseen")
	assert.Equal(t, append(append([]string{}, specific[:maxTips-1]...), generic[0]), tips,
		"the cap keeps the top provider-specific advice and reserves the last slot "+
			"for the terminality statement")
}

// The per-provider docs page is for the codes whose FIX is provider-specific.
// A connection failure is not one of them: the host did not answer, which the
// provider's credential page says nothing about.
func TestRemediate_ProviderDocsOnlyForCodesWhoseFixIsProviderSpecific(t *testing.T) {
	got := Remediate(herr.E{
		Code: ErrProviderConnectionFailed,
		Meta: herr.M{"provider": "vertex"},
	})

	assert.NotEqual(t, "https://docs.langwatch.ai/ai-gateway/providers/vertex", got.Meta["docs_url"],
		"a transport failure must not be sent to the Vertex credential page")
	assert.Equal(t, docsBase+registry[ErrProviderConnectionFailed].docsPath, got.Meta["docs_url"])
}

// The rejected code shares the credential path's provider-specific advice: the
// artifact to go and look at is the same one, whoever refused it.
func TestRemediate_RejectedCredentialAlsoGetsProviderSpecificAdvice(t *testing.T) {
	got := Remediate(herr.E{
		Code: ErrProviderCredentialRejected,
		Meta: herr.M{"provider": "bedrock"},
	})

	tips, ok := got.Meta["tips"].([]string)
	require.True(t, ok)
	assert.Contains(t, strings.Join(tips, "\n"), "AWS access key")
	assert.Equal(t, "https://docs.langwatch.ai/ai-gateway/providers/bedrock", got.Meta["docs_url"])
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
