package pipeline

import (
	"context"
	"errors"
	"sync"
	"time"

	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// SpendAdmission records that a request entered the gateway, before any
// resolution or gating ran. Model is the model as requested.
type SpendAdmission struct {
	GatewayRequestID string
	OccurredAt       time.Time
	OrganizationID   string
	ProjectID        string
	VirtualKeyID     string
	EndUserID        string
	// TraceID joins the spend record to the request's trace without
	// depending on the span pipeline having delivered it.
	TraceID      string
	Model        string
	RequestType  string
	Labels       []string
	MetadataJSON string
}

// SpendError is the full error taxonomy token plus the HTTP status the
// caller saw.
type SpendError struct {
	Type       string
	HTTPStatus int
}

// SpendOutcome closes an admitted request: confirmed when Err is nil,
// failed otherwise. Model and provider identity are the post-dispatch
// resolution, which admission could not know.
type SpendOutcome struct {
	GatewayRequestID string
	OccurredAt       time.Time
	// ProjectID is the ingest tenancy key; every record ships it because
	// the control plane rejects tenantless records per item.
	ProjectID       string
	Err             *SpendError
	Usage           domain.Usage
	Model           string
	ModelProviderID string
	Duration        time.Duration
}

// SpendEmitter receives spend lifecycle records. Implementations must
// return without blocking: the interceptor calls these on the request path.
type SpendEmitter interface {
	AdmitSpend(SpendAdmission)
	ConfirmSpend(SpendOutcome)
	FailSpend(SpendOutcome)
}

// Spend creates the outermost interceptor: every request that reaches the
// pipeline admits a spend record immediately, and exactly one outcome
// (confirm or fail) follows, including for requests the gateway itself
// rejects further down the chain (budget, guardrail, rate limit, policy),
// which is what makes blocked traffic visible to billing at all. Emission
// is fire-and-forget into the emitter's queue; this interceptor adds no
// I/O to the request path.
func Spend(emit SpendEmitter) Interceptor {
	return Interceptor{
		Name: "spend",
		Sync: func(next DispatchFunc) DispatchFunc {
			return func(ctx context.Context, call *Call) (*domain.Response, error) {
				start := time.Now()
				emit.AdmitSpend(admissionFor(ctx, call, start))
				resp, err := next(ctx, call)
				if err != nil {
					emit.FailSpend(outcomeFor(outcomeInput{call: call, start: start, err: classifySpendError(err)}))
					return nil, err
				}
				emit.ConfirmSpend(outcomeFor(outcomeInput{call: call, start: start, usage: resp.Usage}))
				return resp, nil
			}
		},
		Stream: func(next StreamFunc) StreamFunc {
			return func(ctx context.Context, call *Call) (domain.StreamIterator, error) {
				start := time.Now()
				emit.AdmitSpend(admissionFor(ctx, call, start))
				iter, err := next(ctx, call)
				if err != nil {
					emit.FailSpend(outcomeFor(outcomeInput{call: call, start: start, err: classifySpendError(err)}))
					return nil, err
				}
				return &spendStreamWrapper{
					inner: iter,
					emit:  emit,
					call:  call,
					start: start,
				}, nil
			}
		},
	}
}

// traceIDFrom returns the active trace id, or empty when no span is
// recording: an all-zeros id must never masquerade as a join key.
func traceIDFrom(ctx context.Context) string {
	sc := trace.SpanFromContext(ctx).SpanContext()
	if !sc.HasTraceID() {
		return ""
	}
	return sc.TraceID().String()
}

func admissionFor(ctx context.Context, call *Call, at time.Time) SpendAdmission {
	return SpendAdmission{
		GatewayRequestID: call.Meta.GatewayRequestID(),
		OccurredAt:       at,
		OrganizationID:   call.Bundle.OrganizationID,
		ProjectID:        call.Bundle.ProjectID,
		VirtualKeyID:     call.Bundle.VirtualKeyID,
		EndUserID:        ResolveEndUser(ctx, call),
		TraceID:          traceIDFrom(ctx),
		Model:            call.Request.Model,
		RequestType:      string(call.Request.Type),
		Labels:           call.Bundle.Config.VKTags,
		MetadataJSON:     customertracebridge.RequestMetadataJSON(ctx),
	}
}

// ResolveEndUser is the ONE end-user resolution: the middleware-lifted
// header value wins (X-LangWatch-End-User-Id, then the LiteLLM alias),
// else the OpenAI `user` body param on the request shapes that carry one,
// both through the shared sanitizer. Spend admission and budget
// enforcement both call this, so metering and capping can never disagree
// about who a request belonged to.
func ResolveEndUser(ctx context.Context, call *Call) string {
	if id := customertracebridge.EndUserID(ctx); id != "" {
		return id
	}
	switch call.Request.Type {
	case domain.RequestTypeChat, domain.RequestTypeMessages,
		domain.RequestTypeEmbeddings, domain.RequestTypeResponses,
		domain.RequestTypeSpeech:
		if err := call.MaterializeBody(); err != nil {
			return ""
		}
		return customertracebridge.EndUserIDFromBody(call.Request.Body)
	case domain.RequestTypePassthrough, domain.RequestTypeTranscription:
		// Passthrough carries a provider-native body shape, and
		// transcription is multipart form, not JSON: neither exposes the
		// OpenAI `user` field this reads, so header-only attribution
		// (resolved above) is all these types get.
		return ""
	}
	return ""
}

// outcomeInput bundles the four things an outcome is built from: the call,
// when it started, the usage measured, and the spend error if it failed.
type outcomeInput struct {
	call  *Call
	start time.Time
	usage domain.Usage
	err   *SpendError
}

func outcomeFor(in outcomeInput) SpendOutcome {
	model := in.call.Request.Model
	if in.call.Request.Resolved != nil {
		model = in.call.Request.Resolved.ModelID
	}
	return SpendOutcome{
		GatewayRequestID: in.call.Meta.GatewayRequestID(),
		OccurredAt:       time.Now(),
		ProjectID:        in.call.Bundle.ProjectID,
		Err:              in.err,
		Usage:            in.usage,
		Model:            model,
		ModelProviderID:  in.call.Meta.DispatchedProviderID(),
		Duration:         time.Since(in.start),
	}
}

// classifySpendError keeps the gateway's own rejection taxonomy intact
// (budget_exceeded, guardrail_blocked, rate_limited, policy_violation, and
// friends arrive as herr codes) and falls back to the upstream
// classification for provider-side failures.
func classifySpendError(err error) *SpendError {
	var e herr.E
	if errors.As(err, &e) && e.Code != "" {
		return &SpendError{Type: string(e.Code), HTTPStatus: herr.HTTPStatus(err)}
	}
	status, errType := classifyUpstream(err)
	return &SpendError{Type: errType, HTTPStatus: status}
}

// spendStreamWrapper emits exactly one outcome for a streaming request, on
// stream exhaustion or Close, whichever comes first. Usage is whatever the
// inner iterator accumulated by then; a client that disconnects mid-stream
// confirms with the tokens actually consumed so far.
type spendStreamWrapper struct {
	inner domain.StreamIterator
	emit  SpendEmitter
	call  *Call
	start time.Time
	once  sync.Once
}

func (w *spendStreamWrapper) Next(ctx context.Context) bool {
	if !w.inner.Next(ctx) {
		w.finish()
		return false
	}
	return true
}

func (w *spendStreamWrapper) Chunk() []byte       { return w.inner.Chunk() }
func (w *spendStreamWrapper) Usage() domain.Usage { return w.inner.Usage() }
func (w *spendStreamWrapper) Err() error          { return w.inner.Err() }

func (w *spendStreamWrapper) RawFraming() bool {
	if rf, ok := w.inner.(domain.RawFramer); ok {
		return rf.RawFraming()
	}
	return false
}

func (w *spendStreamWrapper) Close() error {
	w.finish()
	return w.inner.Close()
}

func (w *spendStreamWrapper) finish() {
	w.once.Do(func() {
		if err := w.inner.Err(); err != nil {
			w.emit.FailSpend(outcomeFor(outcomeInput{call: w.call, start: w.start, usage: w.inner.Usage(), err: classifySpendError(err)}))
			return
		}
		w.emit.ConfirmSpend(outcomeFor(outcomeInput{call: w.call, start: w.start, usage: w.inner.Usage()}))
	})
}
