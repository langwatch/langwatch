// Package app is the langyagent application layer. It orchestrates a chat
// turn — acquire a worker, run the turn, map failures — through the consumer
// interfaces declared here, so it stays testable without a real worker pool or
// a real HTTP response. Driven adapters implement these ports: app/workerpool
// backs WorkerPool/Worker, adapters/opencode backs CodingAgent (agent.go),
// adapters/controlplane backs TurnFinalizer; the driving adapter (transport/rpc)
// provides the ChatSink.
package app

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
)

// ErrRelayDisabled is returned by FrameRelay.Open when the relay push cannot run
// for a turn — no internal secret, no endpoint, or no runToken (an older control
// plane that mints none). The app treats it as "no live edge for this turn",
// never a turn failure.
var ErrRelayDisabled = errors.New("langyagent: relay push disabled (missing secret, endpoint, or runToken)")

// WorkerPool is the driven port the app uses to get a worker for a
// conversation. Implemented by app/workerpool.Pool.
type WorkerPool interface {
	// Acquire returns the worker for conversationID, spawning one if needed.
	// This is the TURN path: at capacity it evicts the least-recently-active
	// idle worker (a pre-warmed pool must never starve a real turn) and only
	// returns herr(domain.ErrMaxWorkers) when every worker is busy. A herr with
	// domain.ErrCredentialsRequired is returned when a spawn is needed but the
	// credentials carry no session key — see HasLiveWorker.
	Acquire(ctx context.Context, conversationID string, creds domain.Credentials) (Worker, error)
	// AcquireWarm is Acquire for a pre-warm: best-effort by contract, so at
	// capacity it returns herr(domain.ErrMaxWorkers) instead of evicting.
	AcquireWarm(ctx context.Context, conversationID string, creds domain.Credentials) (Worker, error)
	// HasLiveWorker reports whether a worker matching `sig` is already running for
	// this conversation. The control plane calls this BEFORE a turn to decide
	// whether it needs to mint a session key at all: a reused worker already
	// carries one in its environment, so minting a second would create a live
	// credential that nothing ever reads.
	//
	// Advisory only — the worker may die immediately after we answer. Acquire is
	// the authority, and it refuses a keyless spawn rather than booting a worker
	// that cannot reach LangWatch.
	HasLiveWorker(conversationID string, sig domain.CredentialSignature) bool
	// Status returns the live worker count and the configured cap.
	Status() (active, capacity int)
	// KillSessionVanished recycles a worker whose opencode session disappeared.
	KillSessionVanished(conversationID string)
	// CancelTurn asks the conversation's live worker to abort the named
	// in-flight turn, the token-burn half of the user's Stop (ADR-078). A
	// lookup, never a spawn, and every miss (no worker, a different turn in
	// flight, an agent that cannot abort) is a silent no-op: the durable
	// stopped terminal is already recorded upstream, so a cancel is
	// fire-and-forget by contract.
	CancelTurn(conversationID, turnID string)
	// StartReaper begins the idle-worker sweep.
	StartReaper()
	// ShutdownHandoff (ADR-048) is the pre-drain SIGTERM step: it notifies each
	// live worker that shutdown is imminent (so opencode checkpoints the
	// in-flight turn and emits a terminal handoff frame) and waits, bounded by
	// deadline, for those turns to quiesce. Runs BEFORE Shutdown so the handoff
	// frames reach the control plane before the process-group kill.
	ShutdownHandoff(ctx context.Context, deadline time.Time)
	// Shutdown tears down every worker.
	Shutdown()
}

// TurnAborter is the OPTIONAL capability a CodingAgent (agent.go) implements
// when it can abort an in-flight turn mid-generation. The worker type-asserts
// its agent against this at cancel time: an agent without it (opencode today)
// is a silent no-op, fail-open, so a cancel can never change behavior for a
// harness that has no abort. Same drive shape as the CodingAgent methods: the
// endpoint and session route the call, and turnID names the one turn allowed
// to die.
type TurnAborter interface {
	AbortTurn(ctx context.Context, ep Endpoint, sessionID, turnID string) error
}

// TurnBoundary is the OPTIONAL capability a CodingAgent implements when it
// carries per-turn state that must not survive into the next turn. The worker
// calls TurnEnded from Release, which runs after Post and Stream have both
// finished, so the agent gets a point where no turn is in flight.
//
// It exists because Post and Stream are NOT ordered against each other: app.go
// starts the Stream goroutine before PostMessage. An agent that hands the turn
// from Post to Stream can therefore be left holding a handle nobody consumed
// (a turn abandoned between the two), and the NEXT turn's Stream could pick
// that stale handle up instead of its own. Clearing at the boundary is what
// makes the handoff unambiguous: turns are serialized by ClaimTurn, so nothing
// left behind can reach the turn after it. An agent without the capability
// (opencode, which drives turns over HTTP and keeps no such handle) is a
// silent no-op.
type TurnBoundary interface {
	TurnEnded()
}

// ClaimOutcome is the result of Worker.ClaimTurn — a turnId-idempotent claim.
type ClaimOutcome int

const (
	// ClaimGranted means the worker is now driving THIS turn (a fresh claim).
	ClaimGranted ClaimOutcome = iota
	// ClaimAlreadyHandled means this exact turnId is already in flight on this worker,
	// OR was recently completed on it — a redundant dispatch, which is exactly what
	// the self-retry re-drive of a merely-slow worker produces. A BENIGN no-op: the
	// caller answers 2xx and drives nothing, so the turn never double-runs.
	ClaimAlreadyHandled
	// ClaimBusy means a DIFFERENT turn holds the worker's single-stream session (the
	// orchestrator returns conversation-busy → 409).
	ClaimBusy
)

// Worker is one acquired conversation worker. A turn Claims it, PostMessages the
// prompt, StreamEvents the reply, then Releases it.
type Worker interface {
	// ClaimTurn takes exclusive, turnId-idempotent ownership for one turn. It is
	// the safety the self-retry needs (review "F"): a redundant dispatch of the
	// SAME turnId (a re-drive of a worker whose heartbeat merely lapsed) is a benign
	// no-op, never a second run; a different turn overlapping is busy. An empty
	// turnId (older control plane) degrades to the boolean in-flight guard.
	ClaimTurn(turnID string) ClaimOutcome
	// Release returns the worker to idle and records the turn as recently-handled.
	// Always paired with a granted ClaimTurn.
	Release()
	// HasServedTurn reports whether this worker has completed at least one turn —
	// the cold/warm signal behind the pre-first-frame status copy.
	HasServedTurn() bool
	// Prewarmed reports whether this worker was spawned by a pre-warm rather
	// than by a turn. A pre-warmed worker's first turn is not a startup the
	// user should hear about: the boot already happened while the panel sat
	// open, so its status reads as thinking, not starting.
	Prewarmed() bool
	// Touch resets the idle timer.
	Touch()
	// PostMessage queues the turn on the worker's opencode session. historySeed
	// is the control plane's conversation-so-far block: folded in ahead of the
	// prompt on the FIRST message this worker's session receives, ignored once a
	// prompt has been delivered (the session's own transcript carries it from
	// then on, and re-sending it would bloat every later message). resumeToken
	// (ADR-048) carries an opaque prior-turn checkpoint to resume from; empty on
	// a cold start.
	PostMessage(ctx context.Context, system, prompt, historySeed, resumeToken string) error
	// StreamEvents forwards this session's opencode events into sink until a
	// terminal event or ctx cancellation.
	StreamEvents(ctx context.Context, sink ChatSink) error
	// SetTurnTraceContext records the current turn's trace context for
	// host-mediated worker telemetry: the worker's exported spans are re-parented
	// under it, and its mediated LLM calls carry it as traceparent. Called at
	// each turn start; implementations without a telemetry relay no-op.
	SetTurnTraceContext(sc trace.SpanContext)
	// ForwardTurnSpan emits the turn's customer-facing root span — the real
	// parent for everything the worker and gateway put in the customer's
	// trace this turn. Called once at turn end with the turn's span context
	// and wall-clock bounds; failure is non-nil when the turn ended in a
	// terminal error, so the customer span carries the error status and
	// message instead of reading as a silent success. Implementations
	// without a telemetry relay no-op.
	ForwardTurnSpan(sc trace.SpanContext, start, end time.Time, failure *domain.TurnFailure)
	// LastLLMError is the typed gateway herr the worker's most recent mediated
	// LLM call failed with this turn, if any — the real cause behind an
	// agent-reported turn error. Implementations without mediation return
	// false.
	LastLLMError() (herr.E, bool)
}

// FinalToolCall is one tool call a turn ran, in the compact shape the durable
// final carries. Output doubles as the error text when IsError. Mirrors the
// control plane's LangyFinalToolCall (langy-final-parts.ts).
type FinalToolCall struct {
	ID      string          `json:"id"`
	Name    string          `json:"name"`
	Input   json.RawMessage `json:"input,omitempty"`
	Output  *string         `json:"output,omitempty"`
	IsError *bool           `json:"isError,omitempty"`
}

// TurnResult is the durable final the agent posts back to the control plane's
// langy-internal ingest, independently of the best-effort NDJSON relay. The
// wire contract for POST /api/internal/langy/turn/{turnId}/result.
type TurnResult struct {
	ProjectID      string `json:"projectId"`
	ConversationID string `json:"conversationId"`
	// Status is "completed" or "failed". Only "completed" is posted today;
	// failures are covered by the relay's error dispatch and the liveness subscriber.
	Status    string          `json:"status"`
	Text      string          `json:"text,omitempty"`
	ToolCalls []FinalToolCall `json:"toolCalls,omitempty"`
	ErrorCode string          `json:"errorCode,omitempty"`
}

// TurnFinalizer is the driven port for delivering a turn's durable final to the
// control plane. Implemented by adapters/controlplane.Finalizer; nil in tests
// and in deployments without the internal secret (the app no-ops).
type TurnFinalizer interface {
	// Finalize posts result for turnID to the control plane at endpoint (the
	// LangwatchEndpoint the turn was spawned with). Bounded, idempotent retry
	// lives in the implementation.
	Finalize(ctx context.Context, endpoint, turnID string, result TurnResult) error
}

// ChatSink is the typed frame sink the app streams a turn's output frames into.
// In self-drive (see app.go and adapters/controlplane) the app no longer holds an
// http.ResponseWriter open: the coding agent's output is mapped to typed
// internal/frames values, and the sink SIGNS each and pushes it to the
// control-plane relay (adapters/controlplane.RelayStream) — while the app also
// tees the same frames into the durable-final accumulator.
type ChatSink interface {
	// Emit signs + pushes one output frame (best-effort at the call site — a
	// dropped ephemeral frame must never fail the turn). It also feeds the
	// durable-final accumulator.
	Emit(f frames.Frame) error
}

// FrameRelay opens ONE authenticated push connection per turn to the control-plane
// relay (POST /api/internal/langy/relay/frames). Implemented by
// adapters/controlplane.RelayClient; the app owns the turn drive and streams into
// it. A herr-free ErrRelayDisabled (no secret/endpoint/runToken) means "no live
// edge for this turn" — the durable final (Finalizer) still lands.
type FrameRelay interface {
	Open(ctx context.Context, endpoint, runToken, projectID, userID, conversationID, turnID string) (FrameStream, error)
}

// FrameStream is one turn's push connection. Emit signs+pushes a frame in order;
// Close ends the stream and reports the relay's outcome.
type FrameStream interface {
	Emit(f frames.Frame) error
	Close() error
}
