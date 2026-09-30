package providers

import (
	"context"
	"sync"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// These tests pin the dedup behavior added for #7892: the
// "azure api_version override is ignored" warning must fire once per
// credential ID on the shared, long-lived `account` (bifrost's per-request
// key-selection entry point, GetKeysForProvider, runs concurrently under a
// 1000-worker pool) rather than once per dispatch.
//
// Spec: specs/ai-gateway/azure-api-version-override.feature

func azureCredWithVersion(id, apiVersion string) domain.Credential {
	extra := map[string]string{"api_base": "https://acme.openai.azure.com"}
	if apiVersion != "" {
		extra["api_version"] = apiVersion
	}
	return domain.Credential{
		ID:         id,
		ProviderID: domain.ProviderAzure,
		APIKey:     "az-key",
		Extra:      extra,
	}
}

// @scenario "Repeated dispatches for one Azure credential warn only once"
func TestAccountGetKeysForProvider_Azure_WarnsOnceAcrossRepeatedDispatches(t *testing.T) {
	core, logs := observer.New(zapcore.WarnLevel)
	logger := zap.New(core)
	acc := &account{logger: logger}

	cred := azureCredWithVersion("mp-azure-1", "2023-05-15")
	ctx := withCredential(context.Background(), cred)

	for i := 0; i < 3; i++ {
		if _, err := acc.GetKeysForProvider(ctx, bfschemas.Azure); err != nil {
			t.Fatalf("GetKeysForProvider call %d: unexpected error: %v", i, err)
		}
	}

	entries := logs.FilterMessageSnippet("api_version override is ignored").All()
	if len(entries) != 1 {
		t.Fatalf("want exactly 1 warning across 3 dispatches for the same credential, got %d", len(entries))
	}
	if got := entries[0].ContextMap()["api_version"]; got != "2023-05-15" {
		t.Fatalf("warning api_version field = %v, want 2023-05-15", got)
	}
}

// @scenario "A credential sourced from the /go/proxy header path still warns on first sight"
func TestAccountGetKeysForProvider_Azure_ProxyStyleCredentialIDStillWarns(t *testing.T) {
	core, logs := observer.New(zapcore.WarnLevel)
	logger := zap.New(core)
	acc := &account{logger: logger}

	// gatewayproxy.ParseCredentialFromHeaders (services/nlpgo/adapters/gatewayproxy)
	// mints IDs of the shape "playground-inline-<provider>" for the /go/proxy
	// header-credential path, distinct from the control-plane virtual-key ID
	// shape. Dedup keys on cred.ID regardless of which path produced it.
	cred := azureCredWithVersion("playground-inline-azure", "2023-05-15")
	ctx := withCredential(context.Background(), cred)

	if _, err := acc.GetKeysForProvider(ctx, bfschemas.Azure); err != nil {
		t.Fatalf("GetKeysForProvider: unexpected error: %v", err)
	}

	entries := logs.FilterMessageSnippet("api_version override is ignored").All()
	if len(entries) != 1 {
		t.Fatalf("want exactly 1 warning on first sight of a proxy-style credential id, got %d", len(entries))
	}
}

// @scenario "Two Azure credentials each warn once"
func TestAccountGetKeysForProvider_Azure_TwoDistinctCredentialsWarnTwice(t *testing.T) {
	core, logs := observer.New(zapcore.WarnLevel)
	logger := zap.New(core)
	acc := &account{logger: logger}

	credA := azureCredWithVersion("mp-azure-a", "2023-05-15")
	credB := azureCredWithVersion("mp-azure-b", "2024-02-01")

	for i := 0; i < 2; i++ {
		ctxA := withCredential(context.Background(), credA)
		if _, err := acc.GetKeysForProvider(ctxA, bfschemas.Azure); err != nil {
			t.Fatalf("GetKeysForProvider(credA) call %d: unexpected error: %v", i, err)
		}
		ctxB := withCredential(context.Background(), credB)
		if _, err := acc.GetKeysForProvider(ctxB, bfschemas.Azure); err != nil {
			t.Fatalf("GetKeysForProvider(credB) call %d: unexpected error: %v", i, err)
		}
	}

	entries := logs.FilterMessageSnippet("api_version override is ignored").All()
	if len(entries) != 2 {
		t.Fatalf("want exactly 2 warnings for 2 distinct credential ids (dedup must be per-ID, not global), got %d", len(entries))
	}
}

// @scenario "A credential with no api-version override never warns"
func TestAccountGetKeysForProvider_Azure_NoOverrideNeverWarns(t *testing.T) {
	core, logs := observer.New(zapcore.WarnLevel)
	logger := zap.New(core)
	acc := &account{logger: logger}

	cred := azureCredWithVersion("mp-azure-no-version", "")
	ctx := withCredential(context.Background(), cred)

	for i := 0; i < 3; i++ {
		if _, err := acc.GetKeysForProvider(ctx, bfschemas.Azure); err != nil {
			t.Fatalf("GetKeysForProvider call %d: unexpected error: %v", i, err)
		}
	}

	entries := logs.FilterMessageSnippet("api_version override is ignored").All()
	if len(entries) != 0 {
		t.Fatalf("want 0 warnings for a credential with no api_version override, got %d", len(entries))
	}
}

// @scenario "Concurrent dispatches for one credential warn exactly once"
func TestAccountGetKeysForProvider_Azure_ConcurrentDispatchesWarnOnce(t *testing.T) {
	core, logs := observer.New(zapcore.WarnLevel)
	logger := zap.New(core)
	// One shared, long-lived account instance — the same struct literal
	// NewBifrostRouter builds and hands to bifrost.Init, dispatched to
	// concurrently by bifrost's worker pool in production. AC10 fails if the
	// warned-set turns out to be scoped per-call instead of per-account.
	acc := &account{logger: logger}

	cred := azureCredWithVersion("mp-azure-concurrent", "2023-05-15")

	const n = 50
	var wg sync.WaitGroup
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			ctx := withCredential(context.Background(), cred)
			if _, err := acc.GetKeysForProvider(ctx, bfschemas.Azure); err != nil {
				t.Errorf("GetKeysForProvider: unexpected error: %v", err)
			}
		}()
	}
	wg.Wait()

	entries := logs.FilterMessageSnippet("api_version override is ignored").All()
	if len(entries) != 1 {
		t.Fatalf("want exactly 1 warning across %d concurrent dispatches for the same credential, got %d", n, len(entries))
	}
}
