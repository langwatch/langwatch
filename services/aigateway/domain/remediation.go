package domain

import (
	"fmt"
	"maps"

	"github.com/langwatch/langwatch/pkg/herr"
)

// Central remediation registry for the gateway's own error codes: every `tips`
// list and docs link the gateway emits lives here, keyed by code, and is
// attached at the single HTTP write choke point rather than at each
// construction site. Mirrors the TypeScript side's
// `src/server/app-layer/error-remediation.ts`, for the same two reasons: one
// place to audit the customer-facing copy, and a docs path CI can verify
// actually exists under `docs/` (remediation_test.go).
//
// Why it matters more here than anywhere else in the platform: an error from
// the gateway is usually read by an agent or an SDK, not by a person looking at
// our UI, and often by someone who cannot see our settings screens at all. The
// tips ARE the interface. A gateway error that says only "the credentials were
// not accepted" leaves the reader to guess between five different fixes.
//
// Dynamic detail (which model, which provider) does NOT belong here — the
// classifier composes it into `meta`, and Remediate leaves `meta` alone.

// docsBase is the canonical docs origin. The client only renders a docs link
// whose origin it recognises (readHandledError.safeDocsUrl), so this must be an
// absolute URL rather than a path.
const docsBase = "https://docs.langwatch.ai"

// remediation is the copy attached to one error code.
type remediation struct {
	tips []string
	// docsPath is a leading-slashed Mintlify path, e.g. "/ai-gateway/providers/vertex".
	// Stored as a path so a test can check the page exists in the repo.
	docsPath string
}

// providerDocsPath names the per-provider setup page for the providers that
// have one, so a credential failure links to the page describing THAT
// provider's credentials rather than the generic index. Keys are the
// credential provider ids (domain.Provider*).
var providerDocsPath = map[string]string{
	"vertex":    "/ai-gateway/providers/vertex",
	"vertex_ai": "/ai-gateway/providers/vertex",
	"bedrock":   "/ai-gateway/providers/bedrock",
	"azure":     "/ai-gateway/providers/azure-openai",
	"gemini":    "/ai-gateway/providers/gemini",
	"openai":    "/ai-gateway/providers/openai",
	"anthropic": "/ai-gateway/providers/anthropic",
}

// providerCredentialTips names what a given provider's credential actually is,
// because "check your credentials" means something different for each of them:
// a service-account document, an IAM role, an API key. Naming the artefact is
// the difference between a tip and a shrug.
var providerCredentialTips = map[string][]string{
	"vertex": {
		"Vertex AI authenticates with a Google Cloud service-account JSON document, not an API key — paste the whole file contents into the provider's credentials field",
		"The document must be valid JSON with a top-level \"type\" of \"service_account\"; a file PATH, or the OAuth client JSON that has no \"type\", is rejected here",
		"The service account needs the Vertex AI User role on the project named by Vertex Project ID",
		"Vertex Location may be a region such as us-central1, or \"global\" — both are valid, and neither one causes this error",
	},
	"bedrock": {
		"Bedrock authenticates with an AWS access key and secret (optionally a session token) — check all of them are present and current",
		"A session token expires; if this started working and then stopped, that is usually why",
		"The IAM principal needs bedrock:InvokeModel on the model you are calling, in the region configured for the provider",
	},
	"azure": {
		"Azure OpenAI needs the API key AND the resource endpoint, and the endpoint must be the resource's own URL",
	},
	"gemini": {
		"The Gemini API key must belong to a Google Cloud project with the Generative Language API enabled",
	},
}

var registry = map[herr.Code]remediation{
	ErrProviderCredentialInvalid: {
		tips: []string{
			"This failed before the request left LangWatch, so it is not a provider outage and retrying will not clear it",
			"Re-save the credentials for this provider under Settings → Model Providers, then send the request again",
		},
		docsPath: "/platform/model-providers",
	},
	ErrProviderCredentialRejected: {
		tips: []string{
			"The provider received the credentials and refused them, so they are well-formed but the account behind them is not accepted",
			"Check the key or service account has not been revoked, expired, or lost access to the model being called",
		},
		docsPath: "/platform/model-providers",
	},
	ErrProviderConfigInvalid: {
		tips: []string{
			"Add the model to this provider under Settings → Model Providers, or send the request to a provider that already serves it",
			"For Azure and Bedrock, a model also needs a deployment mapping before it can be called",
			"This is a settings mismatch rather than a provider failure, so every retry returns the same answer",
		},
		docsPath: "/platform/model-providers",
	},
	ErrProviderConnectionFailed: {
		tips: []string{
			"Nothing answered at the provider's address, so the request never reached it",
			"If this provider uses a custom base URL, check it is correct and reachable from LangWatch",
			"Retrying is worthwhile — this one is usually transient",
		},
		docsPath: "/ai-gateway/providers/custom-openai-compatible",
	},
	ErrProviderTimeout: {
		tips: []string{
			"The provider accepted the request and did not answer in time",
			"Retry with backoff; if it persists, check the provider's own status page",
		},
	},
	ErrRequestAbandoned: {
		tips: []string{
			"The client disconnected or its deadline expired before the provider answered",
			"Nothing is wrong with the key or the provider; send the request again if you still need the answer",
		},
	},
}

// Remediate attaches the registry's tips and docs link for e's code, and
// sharpens both with the provider when the error names one.
//
// Applied at the write choke point (httpapi.writeError) so no construction site
// has to remember, and so a code added without copy is a visible gap in one
// file rather than a silently bare error. Never overwrites what a construction
// site set deliberately: budget.go composes its own tips from the budget that
// ran out, and that is more specific than anything a code-level default knows.
func Remediate(e herr.E) herr.E {
	entry, ok := registry[e.Code]
	if !ok {
		return e
	}

	_, hasTips := e.Meta["tips"]
	_, hasDocs := e.Meta["docs_url"]
	if hasTips && hasDocs {
		return e
	}

	provider, _ := e.Meta["provider"].(string)

	meta := make(herr.M, len(e.Meta)+2)
	maps.Copy(meta, e.Meta)
	if !hasTips {
		if tips := tipsFor(entry, e.Code, provider); len(tips) > 0 {
			meta["tips"] = tips
		}
	}
	if !hasDocs {
		if url := docsFor(entry, e.Code, provider); url != "" {
			meta["docs_url"] = url
		}
	}

	e.Meta = meta
	return e
}

// maxTips mirrors MAX_TIPS in
// platform/app/src/features/errors/logic/readHandledError.ts, where the client
// truncates the list on arrival ("more than this is a document, not
// remediation"). Truncating HERE instead of sending more and letting the client
// drop the tail is what keeps the choice of which advice survives with the
// person who wrote it: the client cuts from the end, so an over-long list loses
// whatever happened to be last rather than whatever mattered least.
const maxTips = 4

// tipsFor puts the provider-specific advice first, then fills the remaining
// room with the generic advice. "Check your credentials" is the same sentence
// for every provider and tells the reader nothing; "paste the whole
// service-account JSON document" tells them what to go and do, so it is the
// advice that must survive the cap.
func tipsFor(entry remediation, code herr.Code, provider string) []string {
	if code != ErrProviderCredentialInvalid && code != ErrProviderCredentialRejected {
		return capTips(entry.tips)
	}
	specific, ok := providerCredentialTips[provider]
	if !ok {
		return capTips(entry.tips)
	}
	tips := make([]string, 0, len(specific)+len(entry.tips))
	tips = append(tips, specific...)
	tips = append(tips, entry.tips...)
	return capTips(tips)
}

func capTips(tips []string) []string {
	if len(tips) <= maxTips {
		return tips
	}
	return tips[:maxTips]
}

// docsFor prefers the provider's own setup page over the generic index — a
// Vertex credential failure should land on the Vertex page, not on a list of
// every provider we support.
func docsFor(entry remediation, code herr.Code, provider string) string {
	if code == ErrProviderCredentialInvalid || code == ErrProviderCredentialRejected ||
		code == ErrProviderConfigInvalid {
		if path, ok := providerDocsPath[provider]; ok {
			return docsBase + path
		}
	}
	if entry.docsPath == "" {
		return ""
	}
	return docsBase + entry.docsPath
}

// RemediationDocsPaths returns every docs path the registry can emit, for the
// test that checks each one exists in the repo. A link to a page nobody wrote
// is worse than no link: it reads as an answer and ends on a 404.
func RemediationDocsPaths() []string {
	seen := map[string]bool{}
	var paths []string
	add := func(p string) {
		if p == "" || seen[p] {
			return
		}
		seen[p] = true
		paths = append(paths, p)
	}
	for _, entry := range registry {
		add(entry.docsPath)
	}
	for _, path := range providerDocsPath {
		add(path)
	}
	return paths
}

// RemediationCodes returns every code the registry answers for, so a test can
// assert the codes that most need remediation actually have it.
func RemediationCodes() []herr.Code {
	codes := make([]herr.Code, 0, len(registry))
	for code := range registry {
		codes = append(codes, code)
	}
	return codes
}

func (r remediation) String() string {
	return fmt.Sprintf("remediation{tips:%d docsPath:%q}", len(r.tips), r.docsPath)
}
