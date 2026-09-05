package workerpool

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/langyagent/adapters/pi"
	"github.com/langwatch/langwatch/services/langyagent/adapters/runner/sharedidentity"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// stubPiBinary writes a minimal executable speaking just enough of the
// langy-worker protocol for a spawn to succeed: the ready handshake, then
// sleep until killed.
func stubPiBinary(t *testing.T) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "langy-worker")
	script := "#!/bin/sh\nprintf '{\"type\":\"ready\",\"protocol\":1}\\n'\nexec sleep 60\n"
	require.NoError(t, os.WriteFile(bin, []byte(script), 0o755))
	return bin
}

// tolerantTempDir is t.TempDir without the strict cleanup: the pool's shutdown
// tears worker homes down asynchronously, and t.TempDir's RemoveAll fails the
// whole test when it races that teardown (directory not empty). Best-effort
// removal is enough for a test scratch root.
func tolerantTempDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "harness") //nolint:usetesting // t.TempDir's strict cleanup is the race this helper works around
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = os.RemoveAll(dir)
	})
	return dir
}

func newHarnessPool(t *testing.T, piBinary string, rev CredentialRevoker) *Pool {
	t.Helper()
	runner := sharedidentity.New()
	p, err := New(context.Background(), Options{
		MaxWorkers:       4,
		WorkerIdle:       time.Minute,
		ReadinessTimeout: 5 * time.Second,
		ReaperInterval:   time.Minute,
		SessionsRoot:     tolerantTempDir(t),
		WorkspaceRoot:    tolerantTempDir(t),
		PiBinaryPath:     piBinary,
		Runner:           runner,
		Revoker:          rev,
	})
	require.NoError(t, err)
	t.Cleanup(p.Shutdown)
	return p
}

func spawnableCreds() domain.Credentials {
	return domain.Credentials{
		LangwatchAPIKey:   "sk-lw-session",
		LangwatchAPIKeyID: "key-old",
		LLMVirtualKey:     "vk",
		GatewayBaseURL:    "http://gw/v1",
		LangwatchEndpoint: "http://cp",
		Model:             "openai/gpt-5-mini",
	}
}

// The spawn path end to end against a stub wrapper binary: Acquire boots the
// langy-worker process through the pi adapter. There is nothing to select — a
// harness field chose between two adapters until ADR-131 — so what is worth
// asserting is that the worker comes up and holds its session handle.
//
// @scenario "A turn that names no harness runs"
func TestAcquire_SpawnsTheWorkerOverStdio(t *testing.T) {
	p := newHarnessPool(t, stubPiBinary(t), nil)

	got, err := p.Acquire(context.Background(), "conv-pi", spawnableCreds())
	require.NoError(t, err, "the spawn path must boot the stub wrapper")
	w := got.(*Worker)

	if _, ok := w.agent.(*pi.Agent); !ok {
		t.Fatalf("worker agent = %T, want the pi adapter", w.agent)
	}
	if w.agentSessionID == "" {
		t.Error("a booted worker must hold its agent's session handle")
	}
}

// A control plane that still names the removed harness must be SERVED, not
// refused. This is the deploy-window case: a queued job, a retry, or a control
// plane that has not yet rolled will carry `harness` in its envelope, and the
// failure mode of rejecting it is an outage confined to whatever was in flight
// — the hardest kind to attribute afterwards.
//
// The field is no longer decoded at all, so this comes in through the door a
// real control plane uses: raw JSON naming the harness, unmarshalled the way
// the transport does it. Constructing the struct directly would prove nothing,
// because the field it would have to set no longer exists.
//
// @scenario "A turn that names the removed harness still runs"
func TestAcquire_EnvelopeNamingTheRemovedHarnessStillSpawns(t *testing.T) {
	var creds domain.Credentials
	raw := `{"langwatchApiKey":"sk-lw-session","langwatchApiKeyId":"key-old",` +
		`"llmVirtualKey":"vk","gatewayBaseUrl":"http://gw/v1",` +
		`"langwatchEndpoint":"http://cp","model":"openai/gpt-5-mini",` +
		`"harness":"opencode"}`
	require.NoError(t, json.Unmarshal([]byte(raw), &creds),
		"an envelope naming the removed harness must still decode")

	p := newHarnessPool(t, stubPiBinary(t), nil)
	got, err := p.Acquire(context.Background(), "conv-legacy", creds)
	require.NoError(t, err, "the turn must run rather than be refused over the name it carried")
	if _, ok := got.(*Worker).agent.(*pi.Agent); !ok {
		t.Fatal("the turn must run on the harness that remains")
	}
}
