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
	dir, err := os.MkdirTemp("", "harness") //nolint:usetesting // t.TempDir's strict cleanup is the race this helper works around
	require.NoError(t, err)
	t.Cleanup(func() {
		_ = os.RemoveAll(dir)
		_ = os.RemoveAll(dir)
	})
	return dir
}

func newHarnessPool(t *testing.T, piBinary string, rev CredentialRevoker) *Pool {
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

func spawnableCreds(harness string) domain.Credentials {
	return domain.Credentials{
		LangwatchAPIKey:   "sk-lw-session",
		LangwatchAPIKeyID: "key-old",
		LLMVirtualKey:     "vk",
		GatewayBaseURL:    "http://gw/v1",
		LangwatchEndpoint: "http://cp",
		Model:             "openai/gpt-5-mini",
		Harness:           harness,
	}
}

// The pi branch of the spawn path, end to end against a stub wrapper binary:
// Acquire on a pi-harness turn boots the langy-worker process through the pi
// adapter, with no authproxy and no listener ports (stdio is the only control
// surface).
//
// @scenario "Selecting the pi harness replaces the conversation's worker"
func TestAcquire_PiHarnessSpawnsThePiAgent(t *testing.T) {
	p := newHarnessPool(t, stubPiBinary(t), nil)

	got, err := p.Acquire(context.Background(), "conv-pi", spawnableCreds(domain.HarnessPi))
	require.NoError(t, err, "the pi spawn path must boot the stub wrapper")
	w := got.(*Worker)

	if _, ok := w.agent.(*pi.Agent); !ok {
		t.Fatalf("worker agent = %T, want the pi adapter", w.agent)
	}
	if w.authProxy != nil {
		t.Errorf("a pi worker must run no authproxy")
	}
	if w.endpoint.ExternalPort != 0 || w.endpoint.InternalPort != 0 {
		t.Errorf("a pi worker binds no ports, got endpoint %+v", w.endpoint)
	}
}

// A live worker built for one harness is never reused for the other: the flip
// kills it (revoking its session key with it) and the conversation continues
// on a worker built for the new harness.
//
// @scenario "Selecting the pi harness replaces the conversation's worker"
func TestAcquire_HarnessFlipKillsAndReplacesTheWorker(t *testing.T) {
	rev := &recordingRevoker{}
	p := newHarnessPool(t, stubPiBinary(t), rev)

	// A running worker spawned before harness selection existed (empty
	// harness in its signature).
	oldCreds := spawnableCreds("")
	existing := &Worker{
		conversationID:    "conv-flip",
		credSig:           sigOf(oldCreds),
		apiKeyID:          "key-old",
		langwatchEndpoint: "http://cp",
	}
	p.mu.Lock()
	p.workers["conv-flip"] = existing
	p.mu.Unlock()

	got, err := p.Acquire(context.Background(), "conv-flip", spawnableCreds(domain.HarnessPi))
	require.NoError(t, err)
	w := got.(*Worker)
	if w == existing {
		t.Fatal("the harness flip must replace the worker, not reuse it")
	}
	if _, ok := w.agent.(*pi.Agent); !ok {
		t.Fatalf("replacement agent = %T, want the pi adapter", w.agent)
	}
	if revoked := rev.eventually(t, 1); len(revoked) != 1 || revoked[0] != "key-old" {
		t.Errorf("the replaced worker's session key must be revoked, got %v", revoked)
	}
}

// The default-harness invariant at the pool level: a worker spawned before
// harness selection existed (empty harness) is REUSED by a turn naming the
// default harness explicitly, no worker is replaced just because harness
// selection was deployed.
//
// @scenario "A conversation that names no harness keeps its running worker"
func TestAcquire_ExplicitDefaultHarnessReusesPreSelectionWorker(t *testing.T) {
	p := newTestPool(4)
	preSelection := spawnableCreds("")
	existing := &Worker{conversationID: "conv-keep", credSig: sigOf(preSelection)}
	p.workers["conv-keep"] = existing

	got, err := p.Acquire(context.Background(), "conv-keep", spawnableCreds(domain.HarnessOpenCode))
	require.NoError(t, err)
	if got.(*Worker) != existing {
		t.Fatal("an explicit default harness must reuse the pre-selection worker")
	}
	if active, _ := p.Status(); active != 1 {
		t.Fatalf("no replacement may be spawned; active=%d", active)
	}
}
