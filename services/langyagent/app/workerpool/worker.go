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

	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/adapters/egress"
	"github.com/langwatch/langwatch/services/langyagent/adapters/opencode"
	"github.com/langwatch/langwatch/services/langyagent/adapters/otelrelay"
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

	// otelRelay + otelToken are this worker's registration with the manager's
	// loopback telemetry/LLM relay (adapters/otelrelay): the token routes the
	// worker's OTLP export and mediated LLM calls to this conversation's entry.
	// The app updates the entry's turn trace context via SetTurnTraceContext at
	// each turn start; the pool Unregisters the token on every death path. nil
	// relay ⇒ unmediated worker (tests, partial wiring).
	otelRelay *otelrelay.Relay
	otelToken string

	// credSig is set at spawn and compared on each reuse. A mismatch means the
	// caller's capability set differs from this worker's — we must recreate the
	// worker rather than continue with stale env.
	credSig domain.CredentialSignature

	// apiKeyID + projectID + langwatchEndpoint are what is needed to revoke this
	// worker's session key when it dies, and nothing else. They are recorded at
	// spawn because that is the only moment we have them: the key itself goes into
	// the subprocess env and is never readable again, and later turns on a reused
	// worker deliberately arrive with no credentials at all. projectID scopes the
	// revoke to the key's own tenant (the control plane refuses a cross-project
	// revoke).
	//
	// The key's lifetime IS this worker's lifetime — it was injected at spawn and
	// a reused worker keeps it — so the worker is the right thing to hang the
	// revocation handle off.
	apiKeyID          string
	projectID         string
	langwatchEndpoint string

	mu sync.Mutex
	// lastSeen drives the idle reaper.
	lastSeen time.Time
	// inFlight serialises turns on the same conversation. Two simultaneous
	// /worker requests for one conversationID would otherwise both subscribe to
	// the same /event stream and each terminate on the other's terminal event,
	// splicing replies. ClaimTurn/Release wrap it.
	inFlight bool
	// currentTurnID is the turnId currently in flight (empty when idle, or when an
	// older control plane sent none). It makes ClaimTurn turnId-idempotent: a
	// re-dispatch of the SAME turn is a benign no-op, not a second run.
	currentTurnID string
	// handled + handledRing are a bounded FIFO set of recently-completed turnIds,
	// so a re-dispatch that arrives AFTER a turn finished (the self-retry racing a
	// just-completed worker) is also a benign no-op. Capacity-bounded: a worker
	// serves many turns over its life and must not grow this without limit.
	handled     map[string]struct{}
	handledRing [recentTurnsCap]string
	handledNext int
}

// recentTurnsCap bounds the per-worker recently-completed turnId set. Comfortably
// larger than any plausible in-flight-plus-retry window for one conversation.
const recentTurnsCap = 64

// compile-time proof Worker satisfies the app port.
var _ app.Worker = (*Worker)(nil)

// Touch updates the worker's idle timer. Called whenever a turn arrives or an
// imminent turn warms an already-running worker.
func (w *Worker) Touch() {
	w.mu.Lock()
	w.lastSeen = time.Now()
	w.mu.Unlock()
}

// shouldReap reports whether the worker has been genuinely idle for longer than
// cutoff. An in-flight turn is never idle, even when it runs longer than the
// configured idle timeout.
func (w *Worker) shouldReap(cutoff time.Duration) bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return !w.inFlight && time.Since(w.lastSeen) > cutoff
}

// ClaimTurn takes turnId-idempotent ownership for one turn — the caller MUST call
// Release() when the turn is done (success or error) after a granted claim. See
// app.ClaimOutcome: the SAME turnId in flight or recently completed is a benign
// no-op (the self-retry re-drive of a merely-slow worker), a DIFFERENT turn is
// busy. An empty turnId degrades to the boolean in-flight guard.
func (w *Worker) ClaimTurn(turnID string) app.ClaimOutcome {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.inFlight {
		if turnID != "" && w.currentTurnID == turnID {
			return app.ClaimAlreadyHandled
		}
		return app.ClaimBusy
	}
	if turnID != "" {
		if _, done := w.handled[turnID]; done {
			return app.ClaimAlreadyHandled
		}
	}
	w.inFlight = true
	w.currentTurnID = turnID
	return app.ClaimGranted
}

// Release marks the worker idle again and records the turn as recently-handled so
// a re-dispatch arriving after completion is a benign no-op.
func (w *Worker) Release() {
	w.mu.Lock()
	if w.currentTurnID != "" {
		w.rememberHandled(w.currentTurnID)
	}
	w.inFlight = false
	w.currentTurnID = ""
	// Idle time starts when work finishes, not when the turn was claimed. Without
	// this, a nine-minute turn under a ten-minute timeout is killed one minute
	// after completion; a turn longer than the timeout can be killed mid-stream.
	w.lastSeen = time.Now()
	w.mu.Unlock()
}

// rememberHandled records a completed turnId in the bounded FIFO set. Caller holds
// w.mu.
func (w *Worker) rememberHandled(turnID string) {
	if w.handled == nil {
		w.handled = make(map[string]struct{}, recentTurnsCap)
	}
	if _, ok := w.handled[turnID]; ok {
		return
	}
	if old := w.handledRing[w.handledNext]; old != "" {
		delete(w.handled, old)
	}
	w.handledRing[w.handledNext] = turnID
	w.handledNext = (w.handledNext + 1) % recentTurnsCap
	w.handled[turnID] = struct{}{}
}

// SetTurnTraceContext records the current turn's trace context on this
// worker's relay entry: the parent the worker's exported spans are re-parented
// under, and the traceparent injected on its mediated LLM calls. Called by the
// app at each turn start; a no-op without a relay.
func (w *Worker) SetTurnTraceContext(sc trace.SpanContext) {
	if w.otelRelay != nil {
		w.otelRelay.SetTurnContext(w.otelToken, sc)
	}
}

// LastLLMError is the typed gateway herr this worker's most recent mediated
// LLM call failed with, if any — reset at each turn start. Read by the app
// when the agent reports a turn error so the terminal frame carries the real
// cause. Always absent without a relay (unmediated worker).
func (w *Worker) LastLLMError() (herr.E, bool) {
	if w.otelRelay == nil {
		return herr.E{}, false
	}
	return w.otelRelay.LastLLMError(w.otelToken)
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
