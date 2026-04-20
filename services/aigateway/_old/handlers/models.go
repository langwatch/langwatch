package handlers

import (
	"encoding/json"
	"net/http"
	"sort"

	"github.com/langwatch/langwatch/services/gateway/internal/auth"
	"github.com/langwatch/langwatch/services/gateway/internal/httpx"
	"github.com/langwatch/langwatch/services/gateway/pkg/gwerrors"
)

// Models returns the models the caller's virtual key is allowed to use. This
// is an OpenAI-compatible /v1/models endpoint — every CLI uses it for the
// completion hint / model picker.
//
// Entries are emitted in three groups, each deduplicated:
//   1. Aliases from VK.Config.ModelAliases — the names the user chose.
//   2. Glob entries from VK.Config.ModelsAllowed — shown verbatim; CLIs
//      that support globs (Claude Code, Codex) pass them through, CLIs
//      that require literals can still show the pattern to the human.
//   3. Provider-type shortcuts (`openai`, `anthropic`, etc) so a user
//      can write `openai/gpt-5-mini` explicitly even when no alias
//      covers it — the dispatcher's explicit-slash path handles this.
//
// Stable sort within each group so CLI dropdowns don't jitter.
type modelEntry struct {
	ID       string `json:"id"`
	Object   string `json:"object"`
	OwnedBy  string `json:"owned_by"`
	Provider string `json:"provider,omitempty"`
}
type modelsResponse struct {
	Object string       `json:"object"`
	Data   []modelEntry `json:"data"`
}

func Models(w http.ResponseWriter, r *http.Request) {
	b := auth.BundleFromContext(r.Context())
	if b == nil || b.Config == nil {
		gwerrors.Write(w, httpx.IDFromContext(r.Context()),
			gwerrors.TypeServiceUnavailable, "config_not_loaded",
			"virtual key config not yet loaded; retry in a moment", "")
		return
	}

	seen := make(map[string]struct{})
	var data []modelEntry

	// 1. Aliases (stable sort by alias name).
	aliasKeys := make([]string, 0, len(b.Config.ModelAliases))
	for k := range b.Config.ModelAliases {
		aliasKeys = append(aliasKeys, k)
	}
	sort.Strings(aliasKeys)
	for _, alias := range aliasKeys {
		target := b.Config.ModelAliases[alias]
		data = append(data, modelEntry{
			ID:       alias,
			Object:   "model",
			OwnedBy:  "langwatch-vk",
			Provider: target,
		})
		seen[alias] = struct{}{}
	}

	// 2. Explicit models_allowed globs / literals. We expose patterns
	// verbatim — CLIs that accept globs pass them through, others
	// render them for the human.
	for _, model := range b.Config.ModelsAllowed {
		if _, dup := seen[model]; dup {
			continue
		}
		data = append(data, modelEntry{
			ID:      model,
			Object:  "model",
			OwnedBy: "langwatch-vk",
		})
		seen[model] = struct{}{}
	}

	// 3. Provider-type shortcuts ("openai", "anthropic", ...) so
	// `<provider>/<model>` explicit routing is discoverable. Emit
	// one entry per distinct provider the VK has bound, sorted.
	providers := make(map[string]struct{})
	for _, pc := range b.Config.ProviderCreds {
		if pc.Type != "" {
			providers[pc.Type] = struct{}{}
		}
	}
	pKeys := make([]string, 0, len(providers))
	for p := range providers {
		pKeys = append(pKeys, p)
	}
	sort.Strings(pKeys)
	for _, p := range pKeys {
		id := p + "/*"
		if _, dup := seen[id]; dup {
			continue
		}
		data = append(data, modelEntry{
			ID:       id,
			Object:   "model",
			OwnedBy:  "langwatch-vk",
			Provider: p,
		})
		seen[id] = struct{}{}
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-LangWatch-Request-Id", httpx.IDFromContext(r.Context()))
	_ = json.NewEncoder(w).Encode(modelsResponse{Object: "list", Data: data})
}
