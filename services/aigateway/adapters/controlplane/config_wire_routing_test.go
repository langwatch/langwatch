package controlplane

import (
	"encoding/json"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// decodeConfig reads a control-plane config payload the way the client does.
func decodeConfig(t *testing.T, payload string) domain.BundleConfig {
	t.Helper()
	var wire configWire
	if err := json.Unmarshal([]byte(payload), &wire); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return wire.toDomain()
}

// @scenario "A provider slot carries its handle to the gateway"
func TestProviderSlotHandleAndModelsDecode(t *testing.T) {
	t.Parallel()

	cfg := decodeConfig(t, `{
		"providers": [
			{
				"id": "mp_1",
				"type": "custom",
				"handle": "MyRouter",
				"models": ["stealth/ox-alpha", "ox-beta"],
				"credentials": {"api_key": "k"}
			}
		]
	}`)

	if len(cfg.Credentials) != 1 {
		t.Fatalf("got %d credentials, want 1", len(cfg.Credentials))
	}
	cred := cfg.Credentials[0]
	if cred.Handle != "myrouter" {
		t.Errorf("a handle must decode lowercased: got %q", cred.Handle)
	}
	if !cred.ServesModel("stealth/ox-alpha") || !cred.ServesModel("ox-beta") {
		t.Errorf("declared models did not decode: %v", cred.Models)
	}
	if cred.ServesModel("something-else") {
		t.Error("a model outside the catalog must not match")
	}
	if _, ok := cfg.CredentialByHandle("MYROUTER"); !ok {
		t.Error("a handle lookup must be case-insensitive")
	}
}

// @scenario "A provider with no handle carries none"
func TestProviderSlotWithoutHandleCarriesNone(t *testing.T) {
	t.Parallel()

	cfg := decodeConfig(t, `{
		"providers": [{"id": "mp_1", "type": "openai", "credentials": {"api_key": "k"}}]
	}`)

	if cfg.Credentials[0].Handle != "" {
		t.Errorf("got handle %q, want none", cfg.Credentials[0].Handle)
	}
	if cfg.Credentials[0].DeclaresCatalog() {
		t.Error("a provider that declared nothing must not read as declaring a catalog")
	}
	if len(cfg.RoutingHandles()) != 0 {
		t.Errorf("got handles %v, want none", cfg.RoutingHandles())
	}
}

// @scenario "An excluded provider carries its handle too"
func TestExcludedProviderHandleDecodes(t *testing.T) {
	t.Parallel()

	cfg := decodeConfig(t, `{
		"providers": [{"id": "mp_1", "type": "anthropic", "credentials": {"api_key": "k"}}],
		"routing_excluded_providers": [{"id": "mp_2", "type": "anthropic", "handle": "EU"}]
	}`)

	row, ok := cfg.ExcludedByHandle("eu")
	if !ok {
		t.Fatal("an excluded row's handle must be addressable")
	}
	if row.ID != "mp_2" || row.ProviderID != domain.ProviderAnthropic {
		t.Errorf("got %+v", row)
	}
	if cfg.BlockedRowReason("mp_2") != domain.ProviderBlockRouting {
		t.Error("the row's own reason must be the routing policy")
	}
	if cfg.BlockedRowReason("mp_1") != domain.ProviderBlockNone {
		t.Error("a dispatchable row must not read as blocked")
	}
}

// An alias target whose first segment is not a provider family is left whole,
// so the resolver can read it against the key's own handles and catalogs.
func TestAliasTargetsKeepUnknownPrefixesWhole(t *testing.T) {
	t.Parallel()

	cfg := decodeConfig(t, `{
		"providers": [{"id": "mp_1", "type": "custom", "credentials": {}}],
		"model_aliases": {
			"fast": "stealth/ox-alpha",
			"smart": "openai/gpt-5-mini",
			"pinned": "eu/claude-sonnet-5"
		}
	}`)

	if got := cfg.ModelAliases["fast"]; got.ProviderID != "" || got.Model != "stealth/ox-alpha" {
		t.Errorf("unknown prefix was split: %+v", got)
	}
	if got := cfg.ModelAliases["smart"]; got.ProviderID != domain.ProviderOpenAI || got.Model != "gpt-5-mini" {
		t.Errorf("a family prefix must still split: %+v", got)
	}
	if got := cfg.ModelAliases["pinned"]; got.ProviderID != "" || got.Model != "eu/claude-sonnet-5" {
		t.Errorf("a handle target must stay whole: %+v", got)
	}
}
