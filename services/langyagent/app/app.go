package app

import (
	"context"
	"errors"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/langyagent/domain"
	"github.com/langwatch/langwatch/services/langyagent/telemetry"
)

// errStreamConsumerCrashed unblocks the handler when the SSE stream goroutine
// panics. Its message is user-safe (surfaced as an ndjson error event) and
// carries no internals — the stack is logged by the goroutine's recover.
var errStreamConsumerCrashed = errors.New("stream ended unexpectedly")

// App is the langyagent application. It composes the worker pool and the
// telemetry seam. All fields are injected via Options so tests can swap any
// dependency.
type App struct {
	logger    *zap.Logger
	pool      WorkerPool
	telemetry *telemetry.Telemetry
}

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

// WithLogger injects the logger.
func WithLogger(l *zap.Logger) Option { return func(a *App) { a.logger = l } }

// WithWorkerPool injects the worker pool.
func WithWorkerPool(p WorkerPool) Option { return func(a *App) { a.pool = p } }

// WithTelemetry injects the telemetry instruments.
func WithTelemetry(t *telemetry.Telemetry) Option { return func(a *App) { a.telemetry = t } }

// Pool returns the configured worker pool (used by serve.go for lifecycle and
// by the health/status handler).
func (a *App) Pool() WorkerPool { return a.pool }

func (a *App) log() *zap.Logger {
	if a.logger == nil {
		return zap.NewNop()
	}
	return a.logger
}

// ChatRequest is the app-level view of a chat turn. The httpapi adapter builds
// it after auth + validation.
type ChatRequest struct {
	ConversationID string
	Prompt         string
	System         string
	Credentials    domain.Credentials
	// ResumeToken (ADR-048) is an opaque, worker-authored checkpoint from a prior
	// turn that handed off on shutdown. Threaded into PostMessage so opencode
	// resumes from it; empty on a normal cold start.
	ResumeToken string
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
func (a *App) Warm(ctx context.Context, conversationID string, creds domain.Credentials) error {
	if _, err := a.pool.Acquire(ctx, conversationID, creds); err != nil {
		if errors.Is(err, domain.ErrMaxWorkers) {
			return nil
		}
		return err
	}
	return nil
}

// Chat runs one chat turn: acquire the worker, claim it, post the prompt, and
// stream the reply into sink. It mirrors the flat handler's control flow
// exactly — the only behavioural change is that operational telemetry is
// emitted around it.
//
// Outcome mapping (unchanged from the flat handler):
//   - at capacity           → 200 stream carrying an "at-capacity" error event
//   - other acquire failure → 200 stream carrying the error as an error event
//   - conversation busy      → herr(ErrConversationBusy) returned to the caller
//     (transport writes a 409) — no stream is begun
//   - session vanished       → "session-not-found" error event; worker recycled
//   - stream/post error      → the error surfaced as an error event
//   - success                → the opencode ndjson event stream
func (a *App) Chat(ctx context.Context, req ChatRequest, sink ChatSink) error {
	ctx, span := a.startTurn(ctx, req.ConversationID)
	defer span()
	start := time.Now()

	worker, err := a.pool.Acquire(ctx, req.ConversationID, req.Credentials)
	if err != nil {
		if errors.Is(err, domain.ErrMaxWorkers) {
			a.atCapacity(ctx)
			sink.Begin()
			sink.ErrorEvent("at-capacity")
			a.turnObserved(ctx, start, "at-capacity")
			return nil
		}
		a.log().Error("acquire worker failed",
			zap.String("conversation", req.ConversationID),
			zap.Error(err),
		)
		sink.Begin()
		sink.ErrorEvent(err.Error())
		a.turnObserved(ctx, start, "acquire-error")
		return nil
	}

	// Per-conversation in-flight guard. The worker's OpenCode session is
	// single-stream — two concurrent turns subscribing to /event from the same
	// worker would each receive the other's deltas and could terminate on the
	// other's terminal event, splicing replies. Return conversation-busy on
	// overlap (transport → 409); the control plane shows a "still answering —
	// wait" notice. This must happen BEFORE Begin() commits the 200.
	if !worker.Claim() {
		a.turnObserved(ctx, start, "busy")
		// Expected hot-path control-flow outcome — no stack capture needed.
		return herr.NewLight(ctx, domain.ErrConversationBusy, nil)
	}
	defer worker.Release()
	worker.Touch()

	sink.Begin()

	// Inner ctx whose lifetime this turn owns: the SSE consumer is bound to it
	// so a PostMessage failure can cancel the consumer immediately rather than
	// wait for the outer request ctx to time out.
	streamCtx, cancelStream := context.WithCancel(ctx)
	defer cancelStream()

	// Kick the SSE consumer first so we don't lose the first delta if opencode
	// is fast to start producing. The goroutine is panic-guarded: a panic in
	// StreamEvents is recovered + logged (via HandlePanic) AND a sentinel is
	// pushed into errCh so the handler below never hangs on <-errCh — one crashed
	// turn can't wedge the request or the manager.
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

	if err := worker.PostMessage(ctx, req.System, req.Prompt, req.ResumeToken); err != nil {
		// Cancel the SSE consumer, then DRAIN it (<-errCh) BEFORE writing any error
		// event. StreamEvents writes to the same http.ResponseWriter as the sink;
		// waiting for it to return first avoids a concurrent write on the ndjson
		// stream. Worker stays claimed until the deferred Release — keep that
		// window small.
		cancelStream()
		<-errCh // the stream consumer has now fully returned.
		if errors.Is(err, domain.ErrSessionNotFound) {
			a.pool.KillSessionVanished(req.ConversationID)
			sink.ErrorEvent("session-not-found")
			a.turnObserved(ctx, start, "session-not-found")
			return nil
		}
		a.log().Error("post message failed",
			zap.String("conversation", req.ConversationID),
			zap.Error(err),
		)
		sink.ErrorEvent(err.Error())
		a.turnObserved(ctx, start, "post-error")
		return nil
	}

	if err := <-errCh; err != nil {
		a.log().Warn("stream events ended with error",
			zap.String("conversation", req.ConversationID),
			zap.Error(err),
		)
		sink.ErrorEvent(err.Error())
		a.turnObserved(ctx, start, "stream-error")
		return nil
	}

	a.turnObserved(ctx, start, "ok")
	return nil
}

// --- telemetry helpers: nil-safe so the app unit-tests without instruments ---

func (a *App) startTurn(ctx context.Context, conversationID string) (context.Context, func()) {
	if a.telemetry == nil {
		return ctx, func() {}
	}
	ctx, span := a.telemetry.StartTurn(ctx, conversationID)
	return ctx, func() { span.End() }
}

func (a *App) turnObserved(ctx context.Context, start time.Time, outcome string) {
	if a.telemetry == nil {
		return
	}
	a.telemetry.TurnObserved(ctx, time.Since(start).Seconds(), outcome)
}

func (a *App) atCapacity(ctx context.Context) {
	if a.telemetry == nil {
		return
	}
	a.telemetry.AtCapacity(ctx)
}
