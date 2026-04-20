package herr

import (
	"context"
	"errors"
	"fmt"

	"github.com/langwatch/langwatch/pkg/stacktrace"
	"go.opentelemetry.io/otel/trace"
)

var _ interface {
	error
	Is(error) bool
	Unwrap() []error
} = E{}

// StackError is implemented by errors that carry stack frames.
type StackError interface {
	GetStack() []stacktrace.Frame
}

// Herrer represents a herr-compatible error.
type Herrer interface {
	error
	Herr() E
}

// E is a structured error with code, metadata, stack trace, and OTel context.
type E struct {
	Code    Code                `json:"code"`
	Meta    M                   `json:"meta"`
	TraceID trace.TraceID       `json:"trace_id"`
	SpanID  trace.SpanID        `json:"span_id"`
	Stack   []stacktrace.Frame  `json:"stack"`
	Reasons []error             `json:"reasons"`
}

// M is error metadata.
type M map[string]any

// New creates a new handled error with stack trace and OTel context.
func New(ctx context.Context, code Code, meta M, reasons ...error) E {
	spanContext := trace.SpanContextFromContext(ctx)

	for _, reason := range reasons {
		if reason == nil {
			panic("herr.New: nil reason provided for " + code.String())
		}
	}

	stack := stacktrace.GetCallerFrames(2)
	if len(reasons) == 1 {
		if stackErr, ok := reasons[0].(StackError); ok {
			rootStack := stackErr.GetStack()
			stack = stacktrace.MergeStacks(rootStack, stack)
		}
	}

	return E{
		Code:    code,
		Meta:    meta,
		TraceID: spanContext.TraceID(),
		SpanID:  spanContext.SpanID(),
		Stack:   stack,
		Reasons: reasons,
	}
}

func (e E) Herr() E { return e }

// Fields returns the error as a map suitable for structured logging.
func (e E) Fields() map[string]any {
	return map[string]any{
		"code":    e.Code,
		"meta":    e.Meta,
		"stack":   e.Stack,
		"reasons": e.Reasons,
	}
}

func (e E) String() string {
	return e.Error() + "\n\n" + stacktrace.FormatFrames(e.Stack)
}

func (e E) Error() string {
	str := string(e.Code)
	if len(e.Meta) > 0 {
		str += fmt.Sprintf(" (%v)", e.Meta)
	}
	for _, reason := range e.Reasons {
		str += fmt.Sprintf("\n- %v", reason)
	}
	return str
}

func (e E) Is(err error) bool {
	if errors.Is(e.Code, err) {
		return true
	}
	if herr, ok := err.(E); ok {
		return e.Code == herr.Code
	}
	return false
}

func (e E) Unwrap() []error { return e.Reasons }

func (e E) GetStack() []stacktrace.Frame { return e.Stack }
