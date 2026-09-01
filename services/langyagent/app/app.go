package app

import (
	"context"
	"errors"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/internal/frames"
	"github.com/langwatch/langwatch/services/langyagent/internal/telemetry"
	langyotel "github.com/langwatch/langwatch/services/langyagent/otel"
)

// errStreamConsumerCrashed unblocks the handler when the SSE stream goroutine
// panics. Its message is user-safe (surfaced as an ndjson error event) and
// carries no internals — the stack is logged by the goroutine's recover.
var errStreamConsumerCrashed = errors.New("stream ended unexpectedly")

// Pre-first-frame status lines. Plain and factual: the cold line names a boot
// that is really happening, and the resume line names a checkpointed turn
// being picked back up (ADR-048). The cold line pairs with the panel's own
// pre-relay ladder ("Preparing Langy's workspace…", langyThinkingLine.ts): the
// panel covers the spawn window before any frame exists, this status takes
// over once the worker is up, and the two read as one startup progressing.
// A warm worker gets "Thinking…": its dispatch is a millisecond round-trip,
// so the whole window this status fills is the model working — a
// connection-flavored line there read as a lost connection on every
// follow-up message.
const (
	statusStartingUp = "Starting Langy…"
	statusThinking   = "Thinking…"
	statusResuming   = "Picking up where it left off…"
)

// readyStatusFor words the pre-first-frame status by the transition actually
// happening. "Starting Langy…" is reserved for the one case where the user
// really is waiting on a first-ever boot: a brand-new conversation whose
// worker a turn had to spawn. Everything else thinks:
//   - a resume from a shutdown handoff names the pick-up (ADR-048);
//   - a worker that has answered before is a round-trip;
//   - a pre-warmed worker booted while the panel sat open, so its first turn
//     has no startup the user should hear about;
//   - a follow-up whose worker was reaped (non-empty history seed) respawns
//     fast on the persisted session — the user just spoke to this
//     conversation, and "starting" reads as the workspace having vanished.
func readyStatusFor(req ChatRequest, worker Worker) string {
	if req.ResumeToken != "" {
		return statusResuming
	}
	if worker.HasServedTurn() || worker.Prewarmed() || req.HistorySeed != "" {
		return statusThinking
	}
	return statusStartingUp
}

// App is the langyagent application. It composes the worker pool and the
// telemetry seam. All fields are injected via Options so tests can swap any
// dependency.
type App struct {
	pool       WorkerPool
	telemetry  *telemetry.Telemetry
	finalizer  TurnFinalizer
	frameRelay FrameRelay
}

// finalizeTimeout bounds the durable final POST (across its internal retries).
const finalizeTimeout = 15 * time.Second

// Option configures an App.
type Option func(*App)

// New constructs an App with the given options.
func New(opts ...Option) *App {
	a := &App{}
	for _, o := range opts {
		o(a)
	}
	return a
}

// WithWorkerPool injects the worker pool.
func WithWorkerPool(p WorkerPool) Option { return func(a *App) { a.pool = p } }

// WithTelemetry injects the telemetry instruments.
func WithTelemetry(t *telemetry.Telemetry) Option { return func(a *App) { a.telemetry = t } }

// WithFinalizer injects the durable turn-result poster. Optional: when absent
// (tests, or a deployment with no internal secret) the app skips the durable
// HTTP-final and relies on the relay + liveness subscriber alone.
func WithFinalizer(f TurnFinalizer) Option { return func(a *App) { a.finalizer = f } }

// WithFrameRelay injects the control-plane relay push client. Optional: when
// absent (tests, or a deployment with no internal secret) the turn runs with no
// live edge (no signed frames pushed) and relies on the durable final alone.
func WithFrameRelay(r FrameRelay) Option { return func(a *App) { a.frameRelay = r } }

// Pool returns the configured worker pool (used by serve.go for lifecycle and
// by the health/status handler).
func (a *App) Pool() WorkerPool { return a.pool }

// ChatRequest is the app-level view of a chat turn. The httpapi adapter builds
// it after auth + validation.
type ChatRequest struct {
	ConversationID string
	Prompt         string
	System         string
	// HistorySeed is the control plane's conversation-so-far block (transcript +
	// resource memory). It rides every dispatch; the WORKER folds it in ahead of
	// the prompt only on its session's first message (see Worker.PostMessage),
	// so a fresh session continues the conversation while a warm session's
	// requests keep a byte-stable, provider-cacheable prefix. Empty for a
	// brand-new conversation.
	HistorySeed string
	Credentials domain.Credentials
	// ResumeToken (ADR-048) is an opaque, worker-authored checkpoint from a prior
	// turn that handed off on shutdown. Threaded into PostMessage so opencode
	// resumes from it; empty on a normal cold start.
	ResumeToken string
	// TurnID is the control plane's idempotency key for this turn. It rides the
	// durable final POST so re-delivery (retry, or a final the relay already
	// recorded) collapses to one event. Empty ⇒ an older control plane that does
	// not yet thread it; the app then skips the durable final.
	TurnID string
	// ProjectID is the tenant the turn belongs to. Required by the ingest to
	// dispatch the finalize command; carried here so the agent can echo it back.
	ProjectID string
	// RunToken is the per-conversation frameauth secret the manager SIGNS every
	// pushed output frame with (never re-transmitted). Empty ⇒ no relay push
	// (older control plane); the app falls back to the in-band path.
	RunToken string
	// UserID scopes the signed frame identity to the conversation's owner. Part of
	// the frameauth identity tuple.
	UserID string
	// Intent is the caller's worker-turn label (create/revive/continue), a
	// semantic hint the transport derives from the route. Recorded on the turn
	// span + duration metric so per-intent behavior is visible; it does NOT change
	// how the turn runs (Acquire reconciles the real state).
	Intent string
}

// Warm spawns the conversation's worker WITHOUT running a turn.
//
// Acquiring a worker is the expensive half of a cold turn: it forks opencode,
// lays out the worker home, installs the skills and waits for the session to
// come up. The control plane knows a turn is coming the moment the browser POSTs
// — long before the event-sourced dispatch actually reaches us — so it calls this
// immediately and the subprocess boots in parallel with the rest of the request
// (persisting the message, reserving the PR permit, dispatching the command).
// By the time /chat lands, Acquire is a map lookup.
//
// It is SAFE TO CALL ANY NUMBER OF TIMES, and that is the whole design: it does
// not Claim the worker and it does not PostMessage, so it cannot start a turn,
// cannot duplicate one, and cannot race the real /chat. Pool.Acquire is keyed by
// conversation id and returns the existing worker when the credential signature
// matches — so the later /chat reuses exactly the worker this warmed.
//
// The credentials MUST be the ones the turn will actually run with (same model,
// same GitHub capability, same egress allow-list). SignatureOf covers all three,
// so warming with a different set would spawn a worker that /chat then kills and
// respawns — slower than not warming at all. The caller is responsible for
// warming only once its credentials are final.
//
// At capacity is not an error worth surfacing: the turn itself will report it.
// AcquireWarm rather than Acquire: a warm may only evict an idle worker that
// never served a turn (a stale warm cache); a worker holding real session
// state is evicted only by a real turn's spawn.
func (a *App) Warm(ctx context.Context, conversationID string, creds domain.Credentials) error {
	worker, err := a.pool.AcquireWarm(ctx, conversationID, creds)
	if err != nil {
		if errors.Is(err, domain.ErrMaxWorkers) {
			return nil
		}
		return err
	}
	// A warm is an explicit promise that a turn is imminent. Refresh an existing
	// worker too, so a strict reaper cannot kill it between the warm and durable
	// outbox dispatch.
	worker.Touch()
	return nil
}

// CancelTurn asks the conversation's live worker to abort the named in-flight
// turn (ADR-078: the token-burn half of the user's Stop). Deliberately returns
// nothing: the control plane treats a cancel as fire-and-forget. The stopped
// terminal is already on the durable record before the cancel is sent, so a
// cancel that finds nothing to halt (worker gone, turn finished, harness
// without abort support) has succeeded at its only job, which is best-effort.
func (a *App) CancelTurn(ctx context.Context, conversationID, turnID string) {
	clog.Get(ctx).Info("canceling in-flight turn",
		zap.String("conversation_id", conversationID),
		zap.String("turn_id", turnID),
	)
	a.pool.CancelTurn(conversationID, turnID)
}

// HasLiveWorker answers the control plane's pre-flight: is there already a worker
// for this conversation with these capabilities?
//
// It exists so the control plane can skip minting a session key on the common
// path. A `true` means "do not bother minting — the running worker already holds
// a key"; a `false` means "you will need to send one". Getting it wrong is safe
// in one direction only, which is why Acquire, not this, is the authority: a
// stale `true` is caught there and answered with ErrCredentialsRequired.
func (a *App) HasLiveWorker(conversationID string, sig domain.CredentialSignature) bool {
	return a.pool.HasLiveWorker(conversationID, sig)
}

// StartTurn runs the SYNCHRONOUS half of a self-driven turn — acquire the worker
// and Claim it — and returns a detached runner for the streaming half. The split
// preserves the pre-stream outcomes the dispatcher relies on, now as HTTP statuses
// (there is no in-band stream to carry an error event any more):
//
//	at capacity          → herr(ErrMaxWorkers)          (transport → 503)
//	keyless spawn needed → herr(ErrCredentialsRequired) (transport → 428)
//	conversation busy    → herr(ErrConversationBusy)    (transport → 409)
//	success              → nil + a runner the transport runs detached after 202
//
// The worker is Claimed before this returns, so the 409 busy-guard still fires
// synchronously; the returned runner owns Release. The transport runs it on a
// detached, panic-guarded goroutine — the client is not held open for the turn,
// whose output flows out-of-band as signed frames to the relay.
func (a *App) StartTurn(ctx context.Context, req ChatRequest) (func(context.Context), error) {
	worker, err := a.pool.Acquire(ctx, req.ConversationID, req.Credentials)
	if err != nil {
		if errors.Is(err, domain.ErrMaxWorkers) {
			a.atCapacity(ctx)
			return nil, herr.NewLight(ctx, domain.ErrMaxWorkers, nil)
		}
		clog.Get(ctx).Error("acquire worker failed", zap.Error(err))
		return nil, err // already a herr from the pool (e.g. ErrCredentialsRequired)
	}
	// Per-conversation in-flight guard, turnId-idempotent (review "F"). The
	// worker's OpenCode session is single-stream — two concurrent DIFFERENT turns
	// would splice replies (busy → 409). But a redundant dispatch of the SAME
	// turnId — exactly what the self-retry re-drive of a merely-slow worker
	// produces — must be a benign no-op, never a second run.
	switch worker.ClaimTurn(req.TurnID) {
	case ClaimAlreadyHandled:
		// Nothing claimed, nothing to drive; the transport answers 202 so the
		// re-driving subscriber treats it as accepted, not a failure.
		return func(context.Context) {}, nil
	case ClaimBusy:
		// Expected hot-path control-flow outcome — no stack capture needed.
		return nil, herr.NewLight(ctx, domain.ErrConversationBusy, nil)
	case ClaimGranted:
		// Fall through to drive the turn below.
	}
	worker.Touch()
	return func(runCtx context.Context) { a.driveTurn(runCtx, req, worker) }, nil
}

// driveTurn is the detached streaming half: open the relay push, post the prompt,
// stream the agent's frames into it, emit the terminal frame, and post the durable
// final. It owns the worker's Release and returns no value — every outcome is a
// pushed frame and/or the durable final, never a value to a caller.
func (a *App) driveTurn(ctx context.Context, req ChatRequest, worker Worker) {
	defer worker.Release()
	ctx, endTurn := a.startTurn(ctx, req.ConversationID, req.TurnID, req.Intent)
	defer endTurn()
	turnSpan := trace.SpanFromContext(ctx)
	// Pin the turn's trace context on the worker's telemetry-relay entry BEFORE
	// the prompt is posted, so every span the worker exports during this turn —
	// and every mediated LLM call it makes — is stitched under this turn's trace.
	// With telemetry off this is the remote (control-plane) span context. When
	// even that is absent (noop tracers on both processes, dev without an OTLP
	// endpoint), the turn MINTS its identity: without one, worker spans keep
	// their own trace ids, the customer turn root is never forwarded, and the
	// gateway's gen_ai span roots a standalone trace duplicating the turn.
	start := time.Now()
	// How the turn ended, when it ended in an error: set by every failing
	// branch below, read by the deferred customer turn-span forward so the
	// customer trace shows the failure (status + message), and mirrored onto
	// the internal turn span. Nil means the turn completed (or handed off).
	var failure *domain.TurnFailure
	sc := turnSpan.SpanContext()
	if !sc.IsValid() {
		sc = langyotel.MintSpanContext()
	}
	worker.SetTurnTraceContext(sc)
	// The customer's copy of the turn span, emitted when the turn ends:
	// the real root under which the worker's re-parented spans and the
	// gateway's retold LLM spans already sit.
	defer func() { worker.ForwardTurnSpan(sc, start, time.Now(), failure) }()

	// The per-turn relay push. Disabled (no runToken/endpoint/secret) ⇒ nil stream:
	// the turn still runs + finalizes, it just has no live edge. The sink owns the
	// stream from here (including any replacement it reopens after a push failure),
	// so the deferred Close goes through it.
	sink := newFrameSink(a.openRelay(ctx, req), func() FrameStream {
		return a.openRelay(ctx, req)
	})
	defer sink.Close()
	// A true status for the cold window: between the prompt POST and the first
	// LLM request the worker prepares its tools (measured at 10s+ on a cold
	// home) and produces NO frames — without a status the panel would sit on
	// its own waiting ladder and read as a hang. The wording names the
	// transition the manager actually knows (readyStatusFor): a resume from a
	// shutdown handoff (ADR-048) is picking a checkpointed turn back up, a
	// worker that has never answered is starting, and a warm worker is a
	// round-trip. Emitted BEFORE onFirstFrame is wired, so time-to-first-
	// frame keeps meaning the agent's own first output; the client clears the
	// status the moment real output arrives.
	if f, err := frames.Status(readyStatusFor(req, worker)); err == nil {
		_ = sink.Emit(f)
	}
	// Mark time-to-first-frame (the agent's first output) on the turn span, so the
	// trace waterfall shows how long the worker sat before it spoke — the readiness
	// span covers the cold-start wait, this covers the wait once it is warm.
	sink.onFirstFrame = func() { turnSpan.AddEvent("langy.first_frame") }

	// Inner ctx the SSE consumer is bound to, so a PostMessage failure can cancel it
	// immediately rather than wait for the outer ctx.
	streamCtx, cancelStream := context.WithCancel(ctx)
	defer cancelStream()

	// The GitHub gate (githubgate.go): watches the tool stream for the agent
	// reaching for GitHub without the access this turn carries, and cancels the
	// stream the moment it happens. The tripped check below turns that into the
	// vetted `langy_github_not_connected` / `langy_github_repo_not_accessible`
	// error frame the client renders as the install card / access hint — instead
	// of the model floundering through an opaque auth failure in prose.
	githubGate := newGithubGate(req.Credentials.GithubToken != "", cancelStream)
	sink.onFrame = githubGate.Observe

	// Kick the consumer first so we don't lose the first delta. Panic-guarded: a
	// crash is recovered + a sentinel pushed so the flow below never hangs on errCh.
	errCh := make(chan error, 1)
	go func() {
		streamed := false
		defer func() {
			if !streamed {
				errCh <- errStreamConsumerCrashed
			}
		}()
		defer clog.HandlePanic(streamCtx, false)
		err := worker.StreamEvents(streamCtx, sink)
		streamed = true
		errCh <- err
	}()

	// Records the turn's terminal failure (for the customer turn span) and
	// pushes the matching terminal error frame in one move, so the two
	// surfaces can never disagree about how the turn ended.
	failTurn := func(message, code string) {
		failure = &domain.TurnFailure{Code: code, Message: message}
		emitError(ctx, sink, message, code)
	}

	if err := worker.PostMessage(ctx, req.System, req.Prompt, req.HistorySeed, req.ResumeToken); err != nil {
		cancelStream()
		<-errCh // the stream consumer has now fully returned.
		if errors.Is(err, domain.ErrSessionNotFound) {
			a.pool.KillSessionVanished(req.ConversationID)
			failTurn("the session ended — please retry", "session_not_found")
			a.turnObserved(ctx, start, "session-not-found", req.Intent)
			return
		}
		clog.Get(ctx).Error("post message failed", zap.Error(err))
		failTurn("the agent could not start the turn", "post_error")
		a.turnObserved(ctx, start, "post-error", req.Intent)
		return
	}

	streamErr := <-errCh
	// The GitHub gate preempts every other outcome: a trip means WE canceled
	// the stream deliberately (so streamErr is a benign nil/cancellation, and
	// letting it fall through would emit a SUCCESS final for a turn we stopped).
	if message, code, tripped := githubGate.Tripped(); tripped {
		clog.Get(ctx).Info("github gate stopped the turn", zap.String("code", code))
		failTurn(message, code)
		a.turnObserved(ctx, start, "github-gate", req.Intent)
		return
	}
	switch {
	case errors.Is(streamErr, domain.ErrTurnHandedOff):
		// ADR-048: the resume-token frame was already pushed; skip our terminal
		// frame, but post the durable final exactly as the in-band path did.
		a.finalizeCompletedTurn(ctx, req, sink)
		a.turnObserved(ctx, start, "handoff", req.Intent)
	case herr.IsCode(streamErr, domain.ErrAgentError):
		// The agent itself reported the turn failed (an opencode error event —
		// e.g. its LLM call was rejected). Deterministic and terminal: emit the
		// vetted `agent_error` herr NOW so the control plane fails the turn in
		// milliseconds instead of the liveness sweep misreading it as a stall.
		// The adapter's herr carries the raw agent prose as an unknown reason —
		// log only. The WIRE herr is composed fresh: vetted copy, and when the
		// LLM proxy captured the gateway's typed herr for this turn, that herr
		// (our own service's vetted code and copy) rides as a REASON, so the
		// control plane classifies the real failure (e.g.
		// no_provider_configured) end-to-end — herr ⇄ DomainError, one model
		// across every wire.
		clog.Get(ctx).Warn("agent reported turn error", zap.Error(streamErr))
		var reasons []error
		failureMessage := "the agent hit an error before finishing"
		if llmErr, ok := worker.LastLLMError(); ok {
			reasons = append(reasons, llmErr)
			// The captured cause's message is OURS by the time it gets
			// here: the relay keeps a gateway-authored message only when
			// the response marker proved we wrote it, and strips it back
			// off the codes that merely relay provider text (see
			// scrubUpstreamRelayedProse). So this names the real failure
			// rather than the generic wrapper, without putting a
			// provider's sentence — written for whoever holds the API
			// key, which on a mediated call is us — into the turn.
			if m, _ := llmErr.Meta["message"].(string); m != "" {
				failureMessage = m
			}
		} else {
			clog.Get(ctx).Warn("agent error carried no captured LLM cause")
		}
		failure = &domain.TurnFailure{Code: "agent_error", Message: failureMessage}
		turnSpan.RecordError(streamErr)
		he := herr.NewLight(ctx, domain.ErrAgentError,
			herr.M{"message": "the agent hit an error before finishing"}, reasons...)
		f, mErr := frames.ErrorFromHerr(he)
		if mErr != nil {
			clog.Get(ctx).Warn("build error frame failed", zap.Error(mErr))
		} else {
			_ = sink.Emit(f)
		}
		a.turnObserved(ctx, start, "agent-error", req.Intent)
	case streamErr != nil:
		// The worker's event stream died before the turn finished — the opencode
		// subprocess crashed, was OOM-killed, or the connection dropped. The raw
		// error is for the log only; the control plane classifies the vetted
		// `worker_stopped` code into a final "Langy's worker stopped" state (never
		// the raw prose, and never a client auto-retry into the dead worker).
		clog.Get(ctx).Warn("stream events ended with error", zap.Error(streamErr))
		failTurn("the worker stopped before finishing", "worker_stopped")
		a.turnObserved(ctx, start, "stream-error", req.Intent)
	default:
		emitFinal(ctx, sink)
		// Durable final: post the completed answer to langy-internal independently
		// of the relay's terminal frame — the path that survives the relay dropping.
		// The turnId-idempotent ingest collapses the duplicate.
		a.finalizeCompletedTurn(ctx, req, sink)
		a.turnObserved(ctx, start, "ok", req.Intent)
	}
}

// openRelay opens the per-turn relay push, returning nil when the relay is
// unconfigured or disabled for this turn (no runToken) — never an error the turn
// should fail on. A real open failure is logged; the turn proceeds without a live
// edge and the durable final still lands.
func (a *App) openRelay(ctx context.Context, req ChatRequest) FrameStream {
	if a.frameRelay == nil {
		return nil
	}
	stream, err := a.frameRelay.Open(ctx, req.Credentials.LangwatchEndpoint, req.RunToken,
		req.ProjectID, req.UserID, req.ConversationID, req.TurnID)
	if err != nil {
		if !errors.Is(err, ErrRelayDisabled) {
			clog.Get(ctx).Warn("relay push open failed; turn runs without a live edge", zap.Error(err))
		}
		return nil
	}
	return stream
}

// emitFinal builds the durable final from the accumulator and pushes it as the
// terminal frames.Final (the relay marks the buffer end + records the answer).
func emitFinal(ctx context.Context, sink *frameSink) {
	text, tools := sink.result()
	tc := make([]frames.ToolCall, 0, len(tools))
	for _, t := range tools {
		tc = append(tc, frames.ToolCall{ID: t.ID, Name: t.Name, Input: t.Input, Output: t.Output, IsError: t.IsError})
	}
	f, err := frames.Final(text, tc)
	if err != nil {
		clog.Get(ctx).Warn("build final frame failed", zap.Error(err))
		return
	}
	_ = sink.Emit(f)
}

// emitError pushes a terminal frames.Error (the relay marks the buffer errored +
// records a failed turn).
func emitError(ctx context.Context, sink *frameSink, message, code string) {
	f, err := frames.Error(message, code)
	if err != nil {
		clog.Get(ctx).Warn("build error frame failed", zap.Error(err))
		return
	}
	_ = sink.Emit(f)
}

// finalizeCompletedTurn posts the accumulated final for a successful turn. It is
// detached from the request ctx and fire-and-forget with a panic guard: a dropped
// final is recoverable via the ingest's idempotency and the liveness subscriber
// backstop, so it must never block or fail the turn.
func (a *App) finalizeCompletedTurn(ctx context.Context, req ChatRequest, sink *frameSink) {
	if a.finalizer == nil || req.TurnID == "" {
		return
	}
	text, toolCalls := sink.result()
	detached := context.WithoutCancel(ctx)
	go func() {
		defer clog.HandlePanic(detached, false)
		fctx, cancel := context.WithTimeout(detached, finalizeTimeout)
		defer cancel()
		if err := a.finalizer.Finalize(fctx, req.Credentials.LangwatchEndpoint, req.TurnID, TurnResult{
			ProjectID:      req.ProjectID,
			ConversationID: req.ConversationID,
			Status:         "completed",
			Text:           text,
			ToolCalls:      toolCalls,
		}); err != nil {
			clog.Get(detached).Warn("durable turn finalize failed; liveness subscriber is the backstop", zap.Error(err))
		}
	}()
}

// --- telemetry helpers: nil-safe so the app unit-tests without instruments ---

func (a *App) startTurn(ctx context.Context, conversationID, turnID, intent string) (context.Context, func()) {
	if a.telemetry == nil {
		return ctx, func() {}
	}
	ctx, span := a.telemetry.StartTurn(ctx, conversationID, turnID, intent)
	return ctx, func() { span.End() }
}

func (a *App) turnObserved(ctx context.Context, start time.Time, outcome, intent string) {
	// Stamp the turn span with how it ended so the trace waterfall reads the outcome
	// (ok / handoff / stream-error / post-error / session-not-found), and mark the
	// failure outcomes as span errors. SpanFromContext is a no-op span when telemetry
	// is off, so this is safe unconditionally.
	span := trace.SpanFromContext(ctx)
	span.SetAttributes(attribute.String("langy.outcome", outcome))
	switch outcome {
	case "ok", "handoff":
		span.SetStatus(codes.Ok, "")
	default:
		span.SetStatus(codes.Error, outcome)
	}
	if a.telemetry == nil {
		return
	}
	a.telemetry.TurnObserved(ctx, time.Since(start).Seconds(), outcome, intent)
}

func (a *App) atCapacity(ctx context.Context) {
	if a.telemetry == nil {
		return
	}
	a.telemetry.AtCapacity(ctx)
}
