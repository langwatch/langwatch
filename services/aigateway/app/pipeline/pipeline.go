// Package pipeline implements the interceptor chain for AI Gateway dispatch.
// Interceptors are decoupled from the app layer — they accept function types,
// not app-level interfaces.
package pipeline

import (
	"context"

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
	Meta    *Meta
}

// Meta holds metadata accumulated during dispatch for response headers.
type Meta struct {
	GatewayRequestID    string
	FallbackCount       int
	BudgetWarnings      []string
	CacheMode           string
	CustomerTraceparent string
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
	Sync   DispatchFunc
	Stream StreamFunc
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

	return Pipeline{Sync: sync, Stream: stream}
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
