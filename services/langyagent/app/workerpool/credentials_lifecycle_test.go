package workerpool

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/langyagent/domain"
)

type recordingRevoker struct {
	mu    sync.Mutex
	calls []string // apiKeyIDs
	err   error
}

func (r *recordingRevoker) Revoke(_ context.Context, _ string, apiKeyID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, apiKeyID)
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

	_, err := p.Acquire(context.Background(), "conv-no-key", domain.Credentials{
		// No LangwatchAPIKey — the control plane thought a worker was alive.
		LLMVirtualKey:     "vk",
		GatewayBaseURL:    "http://gw",
		LangwatchEndpoint: "http://cp",
	})

	require.Error(t, err)
	assert.True(t, errors.Is(err, domain.ErrCredentialsRequired),
		"a keyless spawn must ask the control plane to mint and retry, got: %v", err)
}

// A keyless request must not consume a worker slot it was never going to fill —
// the refusal is checked before the capacity reservation.
func TestAcquire_KeylessSpawnDoesNotConsumeCapacity(t *testing.T) {
	p := newLifecyclePool(t, nil)
	t.Cleanup(p.Shutdown)

	for range 10 {
		_, _ = p.Acquire(context.Background(), "conv-no-key", domain.Credentials{
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
	sig := domain.SignatureOf(creds)

	p.mu.Lock()
	p.workers["conv-4"] = &Worker{conversationID: "conv-4", credSig: sig}
	p.mu.Unlock()

	assert.True(t, p.HasLiveWorker("conv-4", sig),
		"a live worker with matching capabilities means no key need be minted")

	otherModel := domain.SignatureOf(domain.Credentials{
		LangwatchAPIKey: "k", Model: "anthropic/claude-haiku-4-5",
		EgressAllowlist: []string{"example.com"},
	})
	assert.False(t, p.HasLiveWorker("conv-4", otherModel),
		"a capability change recycles the worker, so the control plane must mint")

	assert.False(t, p.HasLiveWorker("conv-unknown", sig),
		"no worker means the control plane must mint")
}

// The signature the probe compares must never depend on the key itself — that is
// precisely what makes "probe before minting" possible.
func TestSignatureOf_IgnoresTheSessionKey(t *testing.T) {
	base := domain.Credentials{Model: "openai/gpt-5-mini", LangwatchAPIKey: "key-one"}
	rotated := base
	rotated.LangwatchAPIKey = "key-two"
	rotated.LangwatchAPIKeyID = "id-two"

	assert.Equal(t, domain.SignatureOf(base), domain.SignatureOf(rotated),
		"a different session key must not look like a capability change")
}
