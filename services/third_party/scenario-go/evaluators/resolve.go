package evaluators

import (
	"context"
	"errors"
	"fmt"

	scenario "github.com/langwatch/scenario/go"
)

// ResolvedKind says how a mapping resolved.
type ResolvedKind int

// Resolution kinds.
const (
	// ResolvedValue: the mapping found a value.
	ResolvedValue ResolvedKind = iota
	// ResolvedNothing: the mapping found nothing; the evaluator skips with
	// Reason. ReadTrace tells whether it read the trace, so the runner may
	// fetch the remote traces and call it again.
	ResolvedNothing
	// ResolvedError: the mapping failed with Err.
	ResolvedError
)

// Resolved is how one mapping resolved against the state.
type Resolved struct {
	Kind      ResolvedKind
	Value     any
	Reason    string
	ReadTrace bool
	Err       error
}

func reasonFor(r scenario.StateReads) string {
	switch {
	case len(r.BlankFields) > 0:
		return "no " + r.BlankFields[0] + " on this scenario"
	case len(r.MissingToolCalls) > 0:
		return "no " + r.MissingToolCalls[0] + " call in the trace"
	case r.EmptyContexts:
		return "no retrieved contexts in the trace"
	}
	return "the mapping returned nothing"
}

// mappingFunc returns the function of a mapping, or false for a literal.
func mappingFunc(mapping any) (scenario.MappingFunc, bool, error) {
	switch m := mapping.(type) {
	case StateMapping:
		return m.Read, true, nil
	case *StateMapping:
		return m.Read, true, nil
	case scenario.MappingFunc:
		return m, true, nil
	case func(context.Context, *scenario.ExecutionState) (any, error):
		return m, true, nil
	case func(*scenario.ExecutionState) any:
		return func(_ context.Context, s *scenario.ExecutionState) (any, error) { return m(s), nil }, true, nil
	case nil, string, bool:
		return nil, false, nil
	}
	if _, ok := normalizeNumber(mapping).(float64); ok {
		return nil, false, nil
	}
	return nil, false, fmt.Errorf("unsupported mapping type %T", mapping)
}

// ResolveMapping resolves one mapping: a literal resolves to itself, a
// function is called with the state while its reads are tracked. A panic in
// the mapping is reported as an error.
func ResolveMapping(ctx context.Context, mapping any, state *scenario.ExecutionState) Resolved {
	fn, isFunc, err := mappingFunc(mapping)
	if err != nil {
		return Resolved{Kind: ResolvedError, Err: err}
	}
	if !isFunc {
		return Resolved{Kind: ResolvedValue, Value: mapping}
	}
	if fn == nil {
		return Resolved{Kind: ResolvedNothing, Reason: "the mapping returned nothing"}
	}
	state.StartReadTracking()
	value, err := callMapping(ctx, fn, state)
	reads := state.TakeReads()
	if err != nil {
		return Resolved{Kind: ResolvedError, Err: err}
	}
	if IsNothing(value) {
		return Resolved{Kind: ResolvedNothing, Reason: reasonFor(reads), ReadTrace: reads.Trace}
	}
	return Resolved{Kind: ResolvedValue, Value: value}
}

func callMapping(ctx context.Context, fn scenario.MappingFunc, state *scenario.ExecutionState) (value any, err error) {
	defer func() {
		if r := recover(); r != nil {
			if e, ok := r.(error); ok {
				err = e
			} else {
				err = errors.New(fmt.Sprint(r))
			}
		}
	}()
	return fn(ctx, state)
}
