package workerpool

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// sigOf computes a worker credential signature exactly as the production Acquire
// path does — capabilitiesFor → app.SignatureKeys → domain.SignatureOf — so tests
// exercise the real composition rather than a hand-spelled copy that could drift.
func sigOf(creds domain.Credentials) domain.CredentialSignature {
	return domain.SignatureOf(creds.ProjectID, creds.ActorUserID, creds.Model, creds.EgressAllowlist, app.SignatureKeys((&Pool{}).capabilitiesFor(creds)), creds.DisabledSkillIds, creds.MirrorTier)
}

type recordingRevoker struct {
	mu       sync.Mutex
	calls    []string // apiKeyIDs
	projects []string // projectIDs, parallel to calls
	err      error
}

func (r *recordingRevoker) Revoke(_ context.Context, _ string, projectID, apiKeyID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, apiKeyID)
	r.projects = append(r.projects, projectID)
	return r.err
}

func (r *recordingRevoker) revoked() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.calls...)
}

// eventually polls because revocation is fired on a goroutine on purpose — a dead
// worker's cleanup must never block on an HTTP call to the control plane.
func (r *recordingRevoker) eventually(t *testing.T, n int) []string {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if got := r.revoked(); len(got) >= n {
			return got
		}
		time.Sleep(5 * time.Millisecond)
	}
	return r.revoked()
}

func newLifecyclePool(t *testing.T, rev CredentialRevoker) *Pool {
	t.Helper()
	p, err := New(context.Background(), Options{
		MaxWorkers:    4,
		SessionsRoot:  t.TempDir(),
		WorkspaceRoot: t.TempDir(),
		Revoker:       rev,
	})
	require.NoError(t, err)
	return p
}

// The whole design rests on this: the control plane omits the session key when its
// probe said a live worker exists, so a SPAWN that arrives without one must be
// refused rather than booting a worker that cannot reach LangWatch. If this ever
// silently spawned, the credential-sprawl fix would have traded a wasted key for a
// broken agent.
func TestAcquire_RefusesSpawnWithoutSessionKey(t *testing.T) {
	p := newLifecyclePool(t, nil)
	t.Cleanup(p.Shutdown)

	_, err := p.Acquire(context.Background(), "conv-no-key", "", domain.Credentials{
		// No LangwatchAPIKey — the control plane thought a worker was alive.
		LLMVirtualKey:     "vk",
		GatewayBaseURL:    "http://gw",
		LangwatchEndpoint: "http://cp",
	})

	require.Error(t, err)
	assert.ErrorIs(t, err, domain.ErrCredentialsRequired,
		"a keyless spawn must ask the control plane to mint and retry, got: %v", err)
}

// A whitespace-only key is no key: spawning on it would boot a CLI that tells the
// user to log in, so it takes the same mint-and-retry path as an absent one.
//
// @scenario "Langy never starts its CLI with a blank key"
func TestAcquire_RefusesSpawnWithBlankSessionKey(t *testing.T) {
	p := newLifecyclePool(t, nil)
	t.Cleanup(p.Shutdown)

	_, err := p.Acquire(context.Background(), "conv-blank-key", "", domain.Credentials{
		LangwatchAPIKey:   " \t\n",
		LLMVirtualKey:     "vk",
		GatewayBaseURL:    "http://gw",
		LangwatchEndpoint: "http://cp",
	})

	require.Error(t, err)
	assert.ErrorIs(t, err, domain.ErrCredentialsRequired,
		"a blank-key spawn must ask the control plane to mint and retry, got: %v", err)
}

// A keyless request must not consume a worker slot it was never going to fill —
// the refusal is checked before the capacity reservation.
func TestAcquire_KeylessSpawnDoesNotConsumeCapacity(t *testing.T) {
	p := newLifecyclePool(t, nil)
	t.Cleanup(p.Shutdown)

	for range 10 {
		_, _ = p.Acquire(context.Background(), "conv-no-key", "", domain.Credentials{
			LLMVirtualKey: "vk", GatewayBaseURL: "http://gw", LangwatchEndpoint: "http://cp",
		})
	}

	active, _ := p.Status()
	assert.Zero(t, active, "refused keyless spawns must leave no reservation behind")
}

// The key's lifetime is the worker's. kill() is the funnel for every deliberate
// death — capability change, idle reap, shutdown — so it is the one place that has
// to revoke, and a key that outlives its worker is the bug this exists to remove.
func TestKill_RevokesTheWorkersSessionKey(t *testing.T) {
	rev := &recordingRevoker{}
	p := newLifecyclePool(t, rev)
	t.Cleanup(p.Shutdown)

	p.mu.Lock()
	p.workers["conv-1"] = &Worker{
		conversationID:    "conv-1",
		apiKeyID:          "key-abc",
		langwatchEndpoint: "http://cp",
	}
	p.mu.Unlock()

	p.kill("conv-1", "idle timeout")

	assert.Equal(t, []string{"key-abc"}, rev.eventually(t, 1),
		"a killed worker's session key must be revoked, not left valid for hours")
}

// Revocation is best-effort: a control plane that is down must not turn a routine
// worker teardown into a failure. The key still expires and the reaper collects it.
func TestKill_RevocationFailureIsNonFatal(t *testing.T) {
	rev := &recordingRevoker{err: errors.New("control plane down")}
	p := newLifecyclePool(t, rev)
	t.Cleanup(p.Shutdown)

	p.mu.Lock()
	p.workers["conv-2"] = &Worker{
		conversationID: "conv-2", apiKeyID: "key-def", langwatchEndpoint: "http://cp",
	}
	p.mu.Unlock()

	assert.NotPanics(t, func() { p.kill("conv-2", "shutdown") })
	rev.eventually(t, 1)

	active, _ := p.Status()
	assert.Zero(t, active, "the worker is still torn down even if revocation failed")
}

// A worker with no key (spawned before this change, or a pool wired without a
// revoker) must not produce a revoke call for an empty id.
func TestKill_NoKeyNoRevocation(t *testing.T) {
	rev := &recordingRevoker{}
	p := newLifecyclePool(t, rev)
	t.Cleanup(p.Shutdown)

	p.mu.Lock()
	p.workers["conv-3"] = &Worker{conversationID: "conv-3"}
	p.mu.Unlock()

	p.kill("conv-3", "idle timeout")
	time.Sleep(50 * time.Millisecond)

	assert.Empty(t, rev.revoked(), "a worker with no session key has nothing to revoke")
}

// The probe is what lets the control plane skip minting. It must answer true only
// for a worker whose capabilities actually match — a false positive means the turn
// arrives keyless and pays a retry; a false negative means we mint a key nothing
// reads, which is the sprawl we are removing.
func TestHasLiveWorker_MatchesOnCapabilitySignature(t *testing.T) {
	p := newLifecyclePool(t, nil)
	t.Cleanup(p.Shutdown)

	creds := domain.Credentials{
		LangwatchAPIKey: "k", Model: "openai/gpt-5-mini",
		EgressAllowlist: []string{"example.com"},
	}
	sig := sigOf(creds)

	p.mu.Lock()
	p.workers["conv-4"] = &Worker{conversationID: "conv-4", credSig: sig}
	p.mu.Unlock()

	assert.True(t, p.HasLiveWorker("conv-4", sig),
		"a live worker with matching capabilities means no key need be minted")

	otherModel := sigOf(domain.Credentials{
		LangwatchAPIKey: "k", Model: "anthropic/claude-haiku-4-5",
		EgressAllowlist: []string{"example.com"},
	})
	assert.False(t, p.HasLiveWorker("conv-4", otherModel),
		"a capability change recycles the worker, so the control plane must mint")

	assert.False(t, p.HasLiveWorker("conv-unknown", sig),
		"no worker means the control plane must mint")
}

func TestSignatureOf_IgnoresTheSessionKey(t *testing.T) {
	base := domain.Credentials{Model: "openai/gpt-5-mini", LangwatchAPIKey: "key-one"}
	rotated := base
	rotated.LangwatchAPIKey = "key-two"
	rotated.LangwatchAPIKeyID = "id-two"

	assert.Equal(t, sigOf(base), sigOf(rotated),
		"a different session key must not look like a capability change")
}

// A worker past its max age is retired between turns, never under one: the
// running turn finishes on it, a keyed turn arriving meanwhile gets the same
// worker back, and only once the worker has gone quiet is it retired and its
// key revoked.
//
// @scenario "An over-age worker finishes its running turn before it is retired"
func TestReap_OverAgeWorkerIsNeverRetiredMidTurn(t *testing.T) {
	rev := &recordingRevoker{}
	p := newLifecyclePool(t, rev)
	t.Cleanup(p.Shutdown)
	p.workerIdle = time.Hour
	p.workerMaxAge = time.Hour

	creds := spawnableCreds()
	w := &Worker{
		conversationID: "conv-old", credSig: sigOf(creds),
		apiKeyID: "key-old", langwatchEndpoint: "http://cp",
		spawnedAt: time.Now().Add(-2 * time.Hour), lastSeen: time.Now().Add(-2 * time.Hour),
	}
	require.Equal(t, app.ClaimGranted, w.ClaimTurn("turn-long"))
	p.mu.Lock()
	p.workers["conv-old"] = w
	p.mu.Unlock()

	p.reapIdle()
	got, err := p.Acquire(context.Background(), "conv-old", "turn-next", creds)
	require.NoError(t, err)
	assert.Same(t, w, got, "a keyed turn must not replace a worker whose turn is still running")
	assert.Equal(t, 1, activeWorkers(p), "an over-age worker with a turn in flight must stay in service")
	time.Sleep(50 * time.Millisecond)
	assert.Empty(t, rev.revoked(), "the running turn's key must not be revoked under it")

	w.Release()
	assert.Equal(t, app.ClaimAlreadyHandled, w.ClaimTurn("turn-long"), "the running turn completed on its worker")

	w.mu.Lock()
	w.lastSeen = time.Now().Add(-2 * overAgeQuietPeriod)
	w.mu.Unlock()
	p.reapIdle()
	assert.Zero(t, activeWorkers(p), "a quiet over-age worker is retired between turns")
	assert.Equal(t, []string{"key-old"}, rev.eventually(t, 1), "retiring it revokes its key")
	assert.Equal(t, app.ClaimBusy, w.ClaimTurn("turn-next"),
		"a turn holding the retired worker is re-dispatched, never run on it")
}

// A warm that reuses a live worker never runs the key the control plane minted
// for it, so that key is revoked rather than left valid until it expires.
func TestAcquireWarm_RevokesItsUnusedKeyWhenItReusesAWorker(t *testing.T) {
	creds := spawnableCreds()

	t.Run("a different key id is revoked, the worker's own is not", func(t *testing.T) {
		rev := &recordingRevoker{}
		p := newLifecyclePool(t, rev)
		t.Cleanup(p.Shutdown)
		p.workerMaxAge = time.Hour

		w := &Worker{
			conversationID: "conv-warm", credSig: sigOf(creds),
			apiKeyID: creds.LangwatchAPIKeyID, langwatchEndpoint: "http://cp",
			spawnedAt: time.Now().Add(-2 * time.Hour), lastSeen: time.Now(),
		}
		p.mu.Lock()
		p.workers["conv-warm"] = w
		p.mu.Unlock()

		warmCreds := creds
		warmCreds.LangwatchAPIKeyID = "key-b"
		got, err := p.AcquireWarm(context.Background(), "conv-warm", warmCreds)
		require.NoError(t, err)
		assert.Same(t, w, got, "a warm reuses the live worker even when it is over age")
		assert.Equal(t, []string{"key-b"}, rev.eventually(t, 1), "the warm's unused key is revoked")
	})

	t.Run("the same key id revokes nothing", func(t *testing.T) {
		rev := &recordingRevoker{}
		p := newLifecyclePool(t, rev)
		t.Cleanup(p.Shutdown)

		w := &Worker{
			conversationID: "conv-warm-same", credSig: sigOf(creds),
			apiKeyID: creds.LangwatchAPIKeyID, langwatchEndpoint: "http://cp",
			spawnedAt: time.Now(), lastSeen: time.Now(),
		}
		p.mu.Lock()
		p.workers["conv-warm-same"] = w
		p.mu.Unlock()

		got, err := p.AcquireWarm(context.Background(), "conv-warm-same", creds)
		require.NoError(t, err)
		assert.Same(t, w, got)
		time.Sleep(50 * time.Millisecond)
		assert.Empty(t, rev.revoked(), "the worker's own key is still in use and must not be revoked")
	})

	t.Run("a warm with a different signature revokes its key and leaves the worker", func(t *testing.T) {
		rev := &recordingRevoker{}
		p := newLifecyclePool(t, rev)
		t.Cleanup(p.Shutdown)

		w := &Worker{
			conversationID: "conv-warm-sig", credSig: sigOf(creds),
			apiKeyID: creds.LangwatchAPIKeyID, langwatchEndpoint: "http://cp",
			spawnedAt: time.Now(), lastSeen: time.Now(),
		}
		p.mu.Lock()
		p.workers["conv-warm-sig"] = w
		p.mu.Unlock()

		warmCreds := creds
		warmCreds.Model = creds.Model + "-other"
		warmCreds.LangwatchAPIKeyID = "key-b"
		require.NotEqual(t, sigOf(creds), sigOf(warmCreds))
		got, err := p.AcquireWarm(context.Background(), "conv-warm-sig", warmCreds)
		require.NoError(t, err)
		assert.Same(t, w, got, "a mismatched warm returns the live worker untouched")
		assert.Equal(t, []string{"key-b"}, rev.eventually(t, 1), "the warm's unused key is revoked")
	})
}

// A keyed re-dispatch of a turn the over-age worker already completed (an
// outbox retry after a lost answer) must reach that worker, which remembers the
// turn. A fresh replacement would remember nothing and run the turn twice.
//
// @scenario "A re-sent turn the over-age worker already ran is not run again"
func TestAcquire_OverAgeWorkerKeepsATurnItAlreadyRan(t *testing.T) {
	rev := &recordingRevoker{}
	p := newLifecyclePool(t, rev)
	t.Cleanup(p.Shutdown)
	p.workerMaxAge = time.Hour

	creds := spawnableCreds()
	w := &Worker{
		conversationID: "conv-rerun", credSig: sigOf(creds),
		apiKeyID: "key-old", langwatchEndpoint: "http://cp",
		spawnedAt: time.Now().Add(-2 * time.Hour), lastSeen: time.Now(),
	}
	require.Equal(t, app.ClaimGranted, w.ClaimTurn("turn-done"))
	w.Release()
	p.mu.Lock()
	p.workers["conv-rerun"] = w
	p.mu.Unlock()

	got, err := p.Acquire(context.Background(), "conv-rerun", "turn-done", creds)
	require.NoError(t, err)
	assert.Same(t, w, got, "a re-dispatch of a turn the worker ran must reach that worker")
	assert.Equal(t, app.ClaimAlreadyHandled, got.ClaimTurn("turn-done"), "the turn must not run twice")
	assert.Equal(t, 1, activeWorkers(p), "no replacement worker is spawned")
	time.Sleep(50 * time.Millisecond)
	assert.Empty(t, rev.revoked(), "the worker's key is not revoked")
}

// An over-age worker's key is close to expiry, so the probe answers false and
// the control plane mints a fresh key for the next turn.
//
// @scenario "The probe asks for a fresh key once the worker is past its max age"
func TestHasLiveWorker_FalseForAnOverAgeWorker(t *testing.T) {
	p := newLifecyclePool(t, nil)
	t.Cleanup(p.Shutdown)
	p.workerMaxAge = time.Hour
	sig := sigOf(spawnableCreds())

	p.mu.Lock()
	p.workers["conv-fresh"] = &Worker{conversationID: "conv-fresh", credSig: sig, spawnedAt: time.Now()}
	p.workers["conv-aged"] = &Worker{conversationID: "conv-aged", credSig: sig, spawnedAt: time.Now().Add(-2 * time.Hour)}
	p.mu.Unlock()

	assert.True(t, p.HasLiveWorker("conv-fresh", sig), "a young worker's key is still good")
	assert.False(t, p.HasLiveWorker("conv-aged", sig), "an over-age worker must make the control plane mint")
}
