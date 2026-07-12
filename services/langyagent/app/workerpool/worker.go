package workerpool

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/services/langyagent/adapters/egress"
	"github.com/langwatch/langwatch/services/langyagent/adapters/opencode"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// Worker is the pool's bookkeeping for one OpenCode subprocess. It satisfies
// app.Worker so the app orchestrator can drive a turn without importing this
// adapter.
type Worker struct {
	conversationID string
	// agent drives the turn on this worker's coding-agent process through the
	// endpoint below — Post/Stream/Notify all route through it, so the pool never
	// touches the agent's wire protocol (adapters/opencode implements it).
	agent app.CodingAgent
	// endpoint is the loopback address + credential the authProxy exposes for the
	// agent process: the external (authproxy) port the manager dials, the internal
	// port opencode actually listens on (fronted by the proxy, never exposed to
	// callers), the per-worker bearer token, and the precomputed external BaseURL
	// so per-turn calls don't re-Sprintf the host.
	endpoint app.Endpoint
	// authProxy fronts opencode with bearer-token auth. Shutdown on worker exit
	// so the externally-advertised port frees up.
	authProxy *opencode.AuthProxy
	// egress is the per-worker OUTBOUND egress handle (ADR-043) returned by the
	// egress guard's PrepareWorker: it carries the loopback forward-proxy port
	// the worker's HTTPS_PROXY points at (0 when the guard runs no proxy) and a
	// Close that tears the proxy down. Closed on every teardown path (kill /
	// exit / spawn failure), exactly like authProxy, so it never outlives the
	// worker or leaks across a recycle.
	egress            egress.WorkerEgress
	openCodeSessionID string
	cmd               *exec.Cmd
	uid               uint32

	// credSig is set at spawn and compared on each reuse. A mismatch means the
	// caller's capability set differs from this worker's — we must recreate the
	// worker rather than continue with stale env.
	credSig domain.CredentialSignature

	// apiKeyID + langwatchEndpoint are the two things needed to revoke this
	// worker's session key when it dies, and nothing else. They are recorded at
	// spawn because that is the only moment we have them: the key itself goes into
	// the subprocess env and is never readable again, and later turns on a reused
	// worker deliberately arrive with no credentials at all.
	//
	// The key's lifetime IS this worker's lifetime — it was injected at spawn and
	// a reused worker keeps it — so the worker is the right thing to hang the
	// revocation handle off.
	apiKeyID          string
	langwatchEndpoint string

	mu sync.Mutex
	// lastSeen drives the idle reaper.
	lastSeen time.Time
	// inFlight serialises turns on the same conversation. Two simultaneous
	// /chat requests for one conversationID would otherwise both subscribe to
	// the same /event stream and each terminate on the other's terminal event,
	// splicing replies. Claim/Release wrap it.
	inFlight bool
}

// compile-time proof Worker satisfies the app port.
var _ app.Worker = (*Worker)(nil)

// Touch updates the worker's idle timer. Called whenever a turn arrives.
func (w *Worker) Touch() {
	w.mu.Lock()
	w.lastSeen = time.Now()
	w.mu.Unlock()
}

// idleSince reports the elapsed idle duration without taking ownership.
func (w *Worker) idleSince() time.Duration {
	w.mu.Lock()
	defer w.mu.Unlock()
	return time.Since(w.lastSeen)
}

// Claim is true if the worker was idle and now belongs to the caller — the
// caller MUST call Release() when its turn is done (success or error). False
// means another turn is already running; the orchestrator converts that into a
// conversation-busy error (409).
func (w *Worker) Claim() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.inFlight {
		return false
	}
	w.inFlight = true
	return true
}

// Release marks the worker idle again.
func (w *Worker) Release() {
	w.mu.Lock()
	w.inFlight = false
	w.mu.Unlock()
}

// PostMessage queues a turn on the worker's opencode session. resumeToken
// (ADR-048) is the opaque checkpoint from a prior turn that handed off on
// shutdown; empty on a normal cold start. It is forwarded verbatim to opencode,
// never parsed by the manager.
func (w *Worker) PostMessage(ctx context.Context, system, prompt, resumeToken string) error {
	return w.agent.Post(ctx, w.endpoint, w.openCodeSessionID, app.Turn{
		System:      system,
		Prompt:      prompt,
		ResumeToken: resumeToken,
	})
}

// NotifyShutdownImminent posts a shutdown-imminent notice to this worker's
// opencode control API (ADR-048), asking it to checkpoint the in-flight turn and
// emit a terminal `handoff` frame before the process-group kill. deadline is the
// absolute instant the worker must checkpoint before.
func (w *Worker) NotifyShutdownImminent(ctx context.Context, deadline time.Time) error {
	return w.agent.NotifyShutdownImminent(ctx, w.endpoint, w.openCodeSessionID, deadline)
}

// isInFlight reports whether a turn currently owns this worker (Claimed but not
// yet Released). The shutdown-handoff step waits on this clearing so the
// in-flight turn's StreamEvents can forward the terminal `handoff` frame to the
// control plane before the drain kills the process group (ADR-048).
func (w *Worker) isInFlight() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.inFlight
}

// StreamEvents tails the worker's /event stream and forwards this session's
// events as ndjson into the sink until a terminal event lands or ctx is
// cancelled.
func (w *Worker) StreamEvents(ctx context.Context, sink app.ChatSink) error {
	return w.agent.Stream(ctx, w.endpoint, w.openCodeSessionID, sink)
}

// tombstoneWorkerHome atomically renames the per-worker home to a unique sibling
// path under sessionsRoot and returns that path for out-of-lock deletion. The
// rename is metadata-only (same directory) so it completes in microseconds while
// the pool lock is held; the caller then os.RemoveAll(tombstone) OUTSIDE the
// lock, off the pool-wide hot path (every Acquire/kill/reap/Status blocks on the
// lock, so the old in-lock tree-walk unlink stalled them all).
//
// Renaming — not deleting — under the lock still frees the canonical home path
// atomically, so the replacement-race invariant holds: a concurrent Acquire that
// creates a fresh home at the canonical path can't collide with our teardown,
// and the uniquely-named tombstone can't be clobbered by (or clobber) a new
// worker. The config.json inside holds the plaintext LangWatch API key and
// ${HOME}/work holds cloned repos, so the caller MUST delete the returned
// tombstone — nothing sensitive may linger on the pod volume.
//
// Returns "" (nothing to delete) when conversationID is invalid, the resolved
// path escapes SESSIONS_ROOT, the home is already gone, or the rename fails.
func tombstoneWorkerHome(ctx context.Context, sessionsRoot, conversationID string) string {
	if !domain.IsValidConversationID(conversationID) {
		return ""
	}
	workerHome := filepath.Join(sessionsRoot, conversationID)
	resolvedRoot, err := filepath.Abs(sessionsRoot)
	if err != nil {
		return ""
	}
	resolvedHome, err := filepath.Abs(workerHome)
	if err != nil {
		return ""
	}
	if !strings.HasPrefix(resolvedHome, resolvedRoot+string(filepath.Separator)) {
		return ""
	}
	// A leading dot + ".dead-<nanos>" suffix keeps the tombstone OUT of the
	// conversationID namespace (IsValidConversationID rejects dots), so it can
	// never collide with a live worker home or a future spawn's canonical path.
	tombstone := filepath.Join(sessionsRoot, fmt.Sprintf(".%s.dead-%d", conversationID, time.Now().UnixNano()))
	if err := os.Rename(workerHome, tombstone); err != nil {
		if !os.IsNotExist(err) {
			clog.Get(ctx).Warn("tombstone worker home failed",
				zap.String("conversation", conversationID),
				zap.Error(err),
			)
		}
		return ""
	}
	return tombstone
}
