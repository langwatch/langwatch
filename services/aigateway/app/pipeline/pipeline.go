// Package pipeline implements the interceptor chain for AI Gateway dispatch.
// Interceptors are decoupled from the app layer — they accept function types,
// not app-level interfaces.
package pipeline

import (
	"context"
	"fmt"
	"io"
	"slices"
	"sync"

	"github.com/langwatch/langwatch/pkg/httpmiddleware"
	"github.com/langwatch/langwatch/pkg/ksuid"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// DispatchFunc is the sync dispatch signature.
type DispatchFunc func(ctx context.Context, call *Call) (*domain.Response, error)

// StreamFunc is the streaming dispatch signature.
type StreamFunc func(ctx context.Context, call *Call) (domain.StreamIterator, error)

// Call carries input and accumulated state through the interceptor chain.
type Call struct {
	Bundle  *domain.Bundle
	Request *domain.Request
	Meta    *MetaAccumulator

	// BudgetExcludedProviders records the providers whose provider-filtered
	// blocking budgets are out of money. The interceptor only records them
	// here; terminal dispatch is what subtracts them from the candidate
	// chain, treats each like an unavailable provider (contract §4.6), and
	// blocks, naming an excluding budget, only when nothing is left to
	// dispatch to.
	BudgetExcludedProviders []domain.ExcludedProvider
}

// Meta holds metadata accumulated during dispatch for response headers. It is
// a snapshot: transports read it, interceptors write through MetaAccumulator.
type Meta struct {
	GatewayRequestID string
	FallbackCount    int
	// DispatchedProviderID is the ModelProvider row id of the credential the
	// request was actually dispatched to (the one that served it, or the
	// last one tried when every attempt failed). Empty when nothing was
	// dispatched. The trace interceptor stamps it on the customer span as
	// langwatch.model_provider_id, which is what lets the control plane's
	// trace fold debit provider-filtered budgets.
	DispatchedProviderID string
	BudgetWarnings       []string
	CacheMode            string
	CustomerTraceparent  string
}

// MetaAccumulator is what interceptors write response metadata into. Dispatch
// runs on its own goroutine while the transport may need the metadata before
// dispatch returns (the non-streaming keep-alive commits the response header
// block the moment it writes its first byte), so every access is guarded.
type MetaAccumulator struct {
	mu   sync.Mutex
	meta Meta
}

// Update applies fn to the accumulated metadata.
func (a *MetaAccumulator) Update(fn func(*Meta)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	fn(&a.meta)
}

// GatewayRequestID reads just the request id, which several interceptors stamp
// onto trace spans.
func (a *MetaAccumulator) GatewayRequestID() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.meta.GatewayRequestID
}

// DispatchedProviderID reads the ModelProvider row id the request was
// dispatched to, once dispatch has recorded it. The trace interceptor reads
// it when ending the customer span. Nil-safe so span teardown paths never
// trade a missing accumulator for a panic.
func (a *MetaAccumulator) DispatchedProviderID() string {
	if a == nil {
		return ""
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.meta.DispatchedProviderID
}

// Snapshot copies the metadata accumulated so far. Safe to call while dispatch
// is still in flight.
func (a *MetaAccumulator) Snapshot() Meta {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := a.meta
	out.BudgetWarnings = slices.Clone(a.meta.BudgetWarnings)
	return out
}

type metaContextKey struct{}

// NewMetaContext seeds ctx with the accumulator this request's dispatch will
// write into, so the transport can snapshot it mid-flight rather than only
// once dispatch returns. Without it the pipeline allocates its own accumulator
// and the transport can only see the final result.
func NewMetaContext(ctx context.Context) context.Context {
	return context.WithValue(ctx, metaContextKey{}, &MetaAccumulator{
		meta: Meta{GatewayRequestID: requestID(ctx)},
	})
}

// MetaFromContext returns the accumulator seeded by NewMetaContext, or nil.
func MetaFromContext(ctx context.Context) *MetaAccumulator {
	acc, _ := ctx.Value(metaContextKey{}).(*MetaAccumulator)
	return acc
}

// metaFor returns the request's accumulator, allocating a standalone one for
// callers that drive the pipeline without seeding a context (tests, and any
// non-HTTP entry point).
func metaFor(ctx context.Context) *MetaAccumulator {
	if acc := MetaFromContext(ctx); acc != nil {
		return acc
	}
	return &MetaAccumulator{meta: Meta{GatewayRequestID: requestID(ctx)}}
}

// SyncResult is the outcome of a non-streaming dispatch.
type SyncResult struct {
	Meta     Meta
	Response *domain.Response
}

// StreamResult is the outcome of a streaming dispatch.
type StreamResult struct {
	Meta     Meta
	Iterator domain.StreamIterator
}

// Interceptor wraps dispatch in an onion pattern. Each provides a sync and
// stream variant that wrap the next handler in the chain.
type Interceptor struct {
	Name   string
	Sync   func(next DispatchFunc) DispatchFunc
	Stream func(next StreamFunc) StreamFunc
}

// Pipeline holds the built sync and stream dispatch chains.
type Pipeline struct {
	sync   DispatchFunc
	stream StreamFunc
}

// Build constructs the pipeline by wrapping terminals with interceptors.
// Interceptors are applied outermost-first: the first in the slice is the
// outermost wrapper.
func Build(interceptors []Interceptor, syncTerminal DispatchFunc, streamTerminal StreamFunc) Pipeline {
	sync := syncTerminal
	for i := len(interceptors) - 1; i >= 0; i-- {
		if interceptors[i].Sync != nil {
			sync = interceptors[i].Sync(sync)
		}
	}

	stream := streamTerminal
	for i := len(interceptors) - 1; i >= 0; i-- {
		if interceptors[i].Stream != nil {
			stream = interceptors[i].Stream(stream)
		}
	}

	return Pipeline{sync: sync, stream: stream}
}

// Sync dispatches a non-streaming request through the interceptor chain.
func (p Pipeline) Sync(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (*SyncResult, error) {
	call := &Call{
		Bundle:  bundle,
		Request: req,
		Meta:    metaFor(ctx),
	}
	resp, err := p.sync(ctx, call)
	if err != nil {
		return nil, err
	}
	return &SyncResult{Meta: call.Meta.Snapshot(), Response: resp}, nil
}

// Stream dispatches a streaming request through the interceptor chain.
func (p Pipeline) Stream(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (*StreamResult, error) {
	call := &Call{
		Bundle:  bundle,
		Request: req,
		Meta:    metaFor(ctx),
	}
	iter, err := p.stream(ctx, call)
	if err != nil {
		return nil, err
	}
	return &StreamResult{Meta: call.Meta.Snapshot(), Iterator: iter}, nil
}

// PreOnly creates an interceptor that only gates the request before dispatch.
// The gate logic is identical for sync and stream paths.
func PreOnly(name string, gate func(ctx context.Context, call *Call) error) Interceptor {
	return Interceptor{
		Name: name,
		Sync: func(next DispatchFunc) DispatchFunc {
			return func(ctx context.Context, call *Call) (*domain.Response, error) {
				if err := gate(ctx, call); err != nil {
					return nil, err
				}
				return next(ctx, call)
			}
		},
		Stream: func(next StreamFunc) StreamFunc {
			return func(ctx context.Context, call *Call) (domain.StreamIterator, error) {
				if err := gate(ctx, call); err != nil {
					return nil, err
				}
				return next(ctx, call)
			}
		},
	}
}

// MaterializeBody ensures the request body is read into memory. Callers that
// need to inspect or mutate the body must call this first.
func (c *Call) MaterializeBody() error {
	if c.Request.Body != nil {
		return nil
	}
	if c.Request.BodyReader == nil {
		return fmt.Errorf("no body reader available")
	}
	body, err := io.ReadAll(c.Request.BodyReader)
	if err != nil {
		return fmt.Errorf("read request body: %w", err)
	}
	c.Request.Body = body
	return nil
}

func requestID(ctx context.Context) string {
	if id := httpmiddleware.GetRequestID(ctx); id != "" {
		return id
	}
	return ksuid.Generate(ctx, ksuid.ResourceGatewayRequest).String()
}
