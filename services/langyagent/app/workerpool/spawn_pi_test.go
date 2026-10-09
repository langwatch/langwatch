package workerpool

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/langyagent/adapters/pi"
	"github.com/langwatch/langwatch/services/langyagent/adapters/runner/localunsafe"
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
	dir, err := os.MkdirTemp("", "spawn") //nolint:usetesting // t.TempDir's strict cleanup is the race this helper works around
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = os.RemoveAll(dir)
	})
	return dir
}

func newSpawningPool(t *testing.T, piBinary string, rev CredentialRevoker) *Pool {
	t.Helper()
	runner, err := localunsafe.New("test")
	require.NoError(t, err)
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
// langy-worker process through the pi adapter, whose only control surface is
// the stdio pair (no listener a sibling worker could dial).
func TestAcquire_SpawnsThePiAgent(t *testing.T) {
	p := newSpawningPool(t, stubPiBinary(t), nil)

	got, err := p.Acquire(context.Background(), "conv-pi", spawnableCreds())
	require.NoError(t, err, "the spawn path must boot the stub wrapper")
	w := got.(*Worker)

	if _, ok := w.agent.(*pi.Agent); !ok {
		t.Fatalf("worker agent = %T, want the pi adapter", w.agent)
	}
}
