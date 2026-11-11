package workerpool

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
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

	got, err := p.Acquire(context.Background(), "conv-pi", "", spawnableCreds())
	require.NoError(t, err, "the spawn path must boot the stub wrapper")
	w := got.(*Worker)

	if _, ok := w.agent.(*pi.Agent); !ok {
		t.Fatalf("worker agent = %T, want the pi adapter", w.agent)
	}
}

// A worker booted with a token scoped to one repository is not reused once the
// next turn resolves a different scope: the scope rides the credential
// signature, so the pool replaces the worker instead of handing it back.
// @scenario "Changing the resolved repository scope re-warms the worker"
func TestAcquire_ChangedRepositoryScopeReplacesTheWorker(t *testing.T) {
	p := newSpawningPool(t, stubPiBinary(t), nil)
	scoped := spawnableCreds()
	scoped.GithubToken = "ghs_installation_token"
	scoped.GithubLogin = "octocat"
	scoped.GithubRepoScope = "acme/service-x"

	first, err := p.Acquire(context.Background(), "conv-scope", "", scoped)
	require.NoError(t, err, "the first turn must boot a worker scoped to acme/service-x")

	same, err := p.Acquire(context.Background(), "conv-scope", "", scoped)
	require.NoError(t, err)
	require.Same(t, first, same, "an unchanged scope reuses the running worker")

	rescoped := scoped
	rescoped.GithubRepoScope = "acme/other-repo"
	next, err := p.Acquire(context.Background(), "conv-scope", "", rescoped)
	require.NoError(t, err, "the next turn with a new scope must boot a fresh worker")
	require.NotSame(t, first, next, "a changed repository scope must not reuse the old worker")
	require.Equal(t, 1, activeWorkers(p), "the replaced worker must be gone, not left running beside the new one")
}

// resumingPiBinary is stubPiBinary that also appends its LANGWATCH_API_KEY to
// keyLog and, like the real wrapper, announces a resume when the conversation's
// persistent session dir already holds a session file.
func resumingPiBinary(t *testing.T, keyLog string) string {
	t.Helper()
	bin := filepath.Join(t.TempDir(), "langy-worker")
	script := "#!/bin/sh\n" +
		"printf '%s\\n' \"$LANGWATCH_API_KEY\" >> '" + keyLog + "'\n" +
		"dir=$(sed -n 's/^ *\"sessionDir\": *\"\\(.*\\)\",*$/\\1/p' \"$HOME/" + configFileNameForTest + "\")\n" +
		"resumed=false\n" +
		"if [ -f \"$dir/session.jsonl\" ]; then resumed=true; else : > \"$dir/session.jsonl\"; fi\n" +
		"printf '{\"type\":\"ready\",\"protocol\":1,\"resumed\":%s}\\n' \"$resumed\"\n" +
		"exec sleep 60\n"
	require.NoError(t, os.WriteFile(bin, []byte(script), 0o755))
	return bin
}

// configFileNameForTest is the wrapper config file the pi adapter writes into
// the worker home (adapters/pi configFileName).
const configFileNameForTest = ".langy-worker.json"

// The over-age replacement end to end: the next keyed turn retires the old
// worker, boots a new one carrying the NEW session key, revokes the old key,
// and the new worker resumes the conversation's persisted session.
//
// @scenario "The next turn after the max age runs on a fresh worker with a fresh key"
func TestAcquire_OverAgeWorkerIsReplacedWithAFreshKeyAndResumesTheSession(t *testing.T) {
	keyLog := filepath.Join(t.TempDir(), "keys")
	rev := &recordingRevoker{}
	p := newSpawningPool(t, resumingPiBinary(t, keyLog), rev)
	p.workerMaxAge = time.Hour

	first, err := p.Acquire(context.Background(), "conv-age", "", spawnableCreds())
	require.NoError(t, err)
	old := first.(*Worker)
	require.False(t, old.promptDelivered, "a new conversation has no session to resume")

	old.mu.Lock()
	old.spawnedAt = time.Now().Add(-2 * time.Hour)
	old.mu.Unlock()
	require.False(t, p.HasLiveWorker("conv-age", sigOf(spawnableCreds())))

	fresh := spawnableCreds()
	fresh.LangwatchAPIKey = "sk-lw-session-new"
	fresh.LangwatchAPIKeyID = "key-new"
	next, err := p.Acquire(context.Background(), "conv-age", "turn-after-max-age", fresh)
	require.NoError(t, err)
	replacement := next.(*Worker)

	require.NotSame(t, old, replacement, "an over-age worker must not be reused")
	assert.Equal(t, 1, activeWorkers(p), "the retired worker must be gone, not left beside the new one")
	assert.Equal(t, "key-new", replacement.apiKeyID)
	keys, err := os.ReadFile(keyLog)
	require.NoError(t, err)
	assert.Equal(t, "sk-lw-session\nsk-lw-session-new\n", string(keys),
		"the replacement's CLI must run on the new key")
	assert.True(t, replacement.promptDelivered, "the replacement resumes the conversation's persisted session")
	assert.Equal(t, []string{"key-old"}, rev.eventually(t, 1), "the retired worker's key is revoked")
	assert.True(t, p.HasLiveWorker("conv-age", sigOf(fresh)))
}

func activeWorkers(p *Pool) int {
	active, _ := p.Status()
	return active
}
