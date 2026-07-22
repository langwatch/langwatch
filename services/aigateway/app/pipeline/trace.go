package pipeline

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/langwatch/langwatch/pkg/forkedcontext"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// classifyUpstream maps a dispatch error to an HTTP status + short error-class
// token for the customer trace. A *domain.UpstreamError forwards the provider's
// verbatim status; everything else collapses to a generic 502/provider_error so
// the trace still records that the request failed rather than dropping silently.
func classifyUpstream(err error) (status int, errType string) {
	var ue *domain.UpstreamError
	if errors.As(err, &ue) {
		status = ue.StatusCode
		switch {
		case status == 429:
			return status, "rate_limited"
		case status == 504 || status == 408:
			return status, "provider_timeout"
		case status >= 500:
			return status, "provider_error"
		case status == 404:
			return status, "not_found"
		case status >= 400:
			return status, "bad_request"
		default:
			return status, "provider_error"
		}
	}
	return 502, "provider_error"
}

// BeginSpanFunc starts a customer trace span and returns the enriched context
// plus a W3C traceparent string representing the new span.
type BeginSpanFunc func(ctx context.Context, projectID string, reqType domain.RequestType) (context.Context, string)

// EndSpanFunc ends the customer trace span, setting final attributes.
type EndSpanFunc func(ctx context.Context, params domain.AITraceParams)

// Trace creates an interceptor that brackets dispatch with customer trace spans.
func Trace(begin BeginSpanFunc, end EndSpanFunc) Interceptor {
	return Interceptor{
		Name: "traces",
		Sync: func(next DispatchFunc) DispatchFunc {
			return func(ctx context.Context, call *Call) (*domain.Response, error) {
				spanCtx, tp := begin(ctx, call.Bundle.Config.TraceProjectID, call.Request.Type)
				call.Meta.CustomerTraceparent = tp
				internalModel, internalProviderID := internalTraceMetadata(call.Bundle.Config, call.Request.Model)

				resp, err := next(spanCtx, call)
				if err != nil {
					// End the span on error too (previously this early-returned,
					// leaking the begin() span AND dropping the failed request from
					// the trace). Stamp the upstream status so the trace shows red.
					if call.Request.Resolved != nil {
						status, errType := classifyUpstream(err)
						end(spanCtx, domain.AITraceParams{
							ProjectID:          call.Bundle.ProjectID,
							Model:              call.Request.Resolved.ModelID,
							ProviderID:         call.Request.Resolved.ProviderID,
							InternalModel:      internalModel,
							InternalProviderID: internalProviderID,
							RequestType:        call.Request.Type,
							VirtualKeyID:       call.Bundle.VirtualKeyID,
							GatewayRequestID:   call.Meta.GatewayRequestID,
							RequestBody:        call.Request.Body,
							UpstreamStatusCode: status,
							UpstreamErrorType:  errType,
							MirrorTier:         call.Bundle.Config.MirrorTier,
							MirrorSourceOrgID:  call.Bundle.OrganizationID,
						})
					}
					return nil, err
				}
				if call.Request.Resolved != nil {
					end(spanCtx, domain.AITraceParams{
						ProjectID:          call.Bundle.ProjectID,
						Model:              call.Request.Resolved.ModelID,
						ProviderID:         call.Request.Resolved.ProviderID,
						InternalModel:      internalModel,
						InternalProviderID: internalProviderID,
						Usage:              resp.Usage,
						RequestType:        call.Request.Type,
						VirtualKeyID:       call.Bundle.VirtualKeyID,
						GatewayRequestID:   call.Meta.GatewayRequestID,
						RequestBody:        call.Request.Body,
						ResponseBody:       resp.Body,
						MirrorTier:         call.Bundle.Config.MirrorTier,
						MirrorSourceOrgID:  call.Bundle.OrganizationID,
					})
				}
				return resp, nil
			}
		},
		Stream: func(next StreamFunc) StreamFunc {
			return func(ctx context.Context, call *Call) (domain.StreamIterator, error) {
				spanCtx, tp := begin(ctx, call.Bundle.Config.TraceProjectID, call.Request.Type)
				call.Meta.CustomerTraceparent = tp
				internalModel, internalProviderID := internalTraceMetadata(call.Bundle.Config, call.Request.Model)

				iter, err := next(spanCtx, call)
				if err != nil {
					// Stream failed to establish (e.g. upstream 504 before the
					// first chunk). End the span with the error stamped so the
					// failure is visible instead of silently dropped.
					if call.Request.Resolved != nil {
						status, errType := classifyUpstream(err)
						end(spanCtx, domain.AITraceParams{
							ProjectID:          call.Bundle.ProjectID,
							Model:              call.Request.Resolved.ModelID,
							ProviderID:         call.Request.Resolved.ProviderID,
							InternalModel:      internalModel,
							InternalProviderID: internalProviderID,
							RequestType:        call.Request.Type,
							VirtualKeyID:       call.Bundle.VirtualKeyID,
							GatewayRequestID:   call.Meta.GatewayRequestID,
							RequestBody:        call.Request.Body,
							UpstreamStatusCode: status,
							UpstreamErrorType:  errType,
							MirrorTier:         call.Bundle.Config.MirrorTier,
							MirrorSourceOrgID:  call.Bundle.OrganizationID,
						})
					}
					return nil, err
				}
				if call.Request.Resolved == nil {
					return iter, nil
				}
				return &traceStreamWrapper{
					inner:              iter,
					end:                end,
					bundle:             call.Bundle,
					req:                call.Request,
					meta:               call.Meta,
					spanCtx:            spanCtx,
					internalModel:      internalModel,
					internalProviderID: internalProviderID,
				}, nil
			}
		},
	}
}

// internalTraceMetadata selects model metadata that is safe for LangWatch's
// operational span. A raw request model is arbitrary customer input unless it
// exactly names a control-plane alias or a finite allowed-model entry.
func internalTraceMetadata(config domain.BundleConfig, rawModel string) (string, domain.ProviderID) {
	if alias, ok := config.ModelAliases[rawModel]; ok {
		return alias.Model, alias.ProviderID
	}
	for _, allowed := range config.AllowedModels {
		if allowed == rawModel {
			return allowed, ""
		}
	}
	return "", ""
}

// responseBodyCap bounds the per-stream response accumulator at 8 MiB so a
// runaway upstream cannot OOM the gateway. Once the cap is hit further
// chunks are dropped from the trace body (the upstream client still sees
// them — we don't gate on this). 8 MiB fits the longest realistic LLM
// response we've measured (claude-opus-4-7 with full reasoning at ~6 MiB)
// with headroom; anything past that is almost always pathological.
const responseBodyCap = 8 * 1024 * 1024

// traceStreamWrapper ends the customer trace span when the stream closes
// and accumulates response chunks so the emitter can lift the assistant
// output text out of the streamed SSE body. Without this accumulator the
// onClose path was passing nil ResponseBody to AITraceParams, which made
// extractOutputMessages return "" for every streamed Path A trace — the
// gen_ai.output.messages key was simply absent from every streaming span.
type traceStreamWrapper struct {
	inner              domain.StreamIterator
	end                EndSpanFunc
	bundle             *domain.Bundle
	req                *domain.Request
	meta               *Meta
	spanCtx            context.Context
	internalModel      string
	internalProviderID domain.ProviderID
	closeOnce          sync.Once
	bodyMu             sync.Mutex
	body               []byte
	isBodyDropped      bool
}

func (w *traceStreamWrapper) Next(ctx context.Context) bool {
	if !w.inner.Next(ctx) {
		w.onClose()
		return false
	}
	w.captureChunk(w.inner.Chunk())
	return true
}

func (w *traceStreamWrapper) Chunk() []byte       { return w.inner.Chunk() }
func (w *traceStreamWrapper) Usage() domain.Usage { return w.inner.Usage() }
func (w *traceStreamWrapper) Err() error          { return w.inner.Err() }

// captureChunk appends chunk to the body accumulator under the cap.
// Called from Next() after the inner iterator advances, so we capture
// exactly once per chunk regardless of how many times the caller reads
// Chunk(). isBodyDropped flips once we've truncated so onClose can stamp
// a langwatch.reserved.trace_body_truncated marker downstream.
func (w *traceStreamWrapper) captureChunk(chunk []byte) {
	if len(chunk) == 0 {
		return
	}
	w.bodyMu.Lock()
	defer w.bodyMu.Unlock()
	if w.isBodyDropped {
		return
	}
	remaining := responseBodyCap - len(w.body)
	if remaining <= 0 {
		w.isBodyDropped = true
		return
	}
	if len(chunk) > remaining {
		w.body = append(w.body, chunk[:remaining]...)
		w.isBodyDropped = true
		return
	}
	w.body = append(w.body, chunk...)
}

// RawFraming delegates to the inner iterator so writers can still
// detect raw-framed (Gemini passthrough) streams through wrapper chains.
func (w *traceStreamWrapper) RawFraming() bool {
	if rf, ok := w.inner.(domain.RawFramer); ok {
		return rf.RawFraming()
	}
	return false
}

func (w *traceStreamWrapper) Close() error {
	w.onClose()
	return w.inner.Close()
}

func (w *traceStreamWrapper) onClose() {
	w.closeOnce.Do(func() {
		w.bodyMu.Lock()
		body := w.body
		w.bodyMu.Unlock()
		// A stream that errored mid-flight (e.g. upstream dropped the
		// connection) carries the error on the inner iterator; stamp it so the
		// trace records the failure instead of looking like a clean response.
		var status int
		var errType string
		if err := w.inner.Err(); err != nil {
			status, errType = classifyUpstream(err)
		}
		// Use spanCtx (not the caller's Next ctx) because the active span is
		// stored there by BeginSpan — the transport's request context doesn't
		// carry it.
		forkedcontext.ForkWithTimeout(w.spanCtx, 5*time.Second, func(ctx context.Context) error {
			w.end(ctx, domain.AITraceParams{
				ProjectID:          w.bundle.ProjectID,
				Model:              w.req.Resolved.ModelID,
				ProviderID:         w.req.Resolved.ProviderID,
				InternalModel:      w.internalModel,
				InternalProviderID: w.internalProviderID,
				Usage:              w.inner.Usage(),
				RequestType:        w.req.Type,
				VirtualKeyID:       w.bundle.VirtualKeyID,
				GatewayRequestID:   w.meta.GatewayRequestID,
				RequestBody:        w.req.Body,
				ResponseBody:       body,
				UpstreamStatusCode: status,
				UpstreamErrorType:  errType,
				MirrorTier:         w.bundle.Config.MirrorTier,
				MirrorSourceOrgID:  w.bundle.OrganizationID,
			})
			return nil
		})
	})
}
