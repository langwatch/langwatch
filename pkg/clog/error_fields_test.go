package clog

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// TestPrettyConsole_WrappedErrorIsOneLine pins the whole point: the nlp lane
// printed a three-line tree (`↳ error=… / .cause=… / .cause.cause=…`) for one
// failed metrics upload while every other Go lane printed one line.
//
/** @scenario "A wrapped error is one line, not a tree" */
func TestPrettyConsole_WrappedErrorIsOneLine(t *testing.T) {
	err := fmt.Errorf("failed to upload metrics: %w",
		fmt.Errorf("reader collect and export timeout: %w",
			errors.New(`Post "http://localhost:4318/v1/metrics"`)))

	line := renderedLine(t, zapcore.WarnLevel, "otel export failed", zap.Error(err))

	assert.NotContains(t, line, "\n")
	assert.Contains(t, line, "error=")
	assert.Equal(t, 2, strings.Count(line, "cause="))
}

// TestFlattenErrorFields_InnermostLast pins the order and the de-duplication:
// each level carries only its own words, innermost last.
//
/** @scenario "A wrapped error is one line, not a tree" */
func TestFlattenErrorFields_InnermostLast(t *testing.T) {
	err := fmt.Errorf("failed to upload metrics: %w",
		fmt.Errorf("reader collect and export timeout: %w", errors.New("connection refused")))

	assert.Equal(t,
		[]zapcore.Field{
			zap.String("error", "failed to upload metrics"),
			zap.String("cause", "reader collect and export timeout"),
			zap.String("cause", "connection refused"),
		},
		flattenErrorFields([]zapcore.Field{zap.Error(err)}),
	)
}

// TestFlattenErrorFields_UnwrappedErrorIsUnchangedInMeaning pins that a plain
// error still renders as one error= pair.
//
/** @scenario "A wrapped error is one line, not a tree" */
func TestFlattenErrorFields_PlainError(t *testing.T) {
	assert.Equal(t,
		[]zapcore.Field{zap.String("error", "boom")},
		flattenErrorFields([]zapcore.Field{zap.Error(errors.New("boom"))}),
	)
}

// TestFlattenErrorFields_KeepsTheFieldName pins that zap.NamedError keeps its
// own key for the outermost message.
//
/** @scenario "A wrapped error is one line, not a tree" */
func TestFlattenErrorFields_KeepsTheFieldName(t *testing.T) {
	err := fmt.Errorf("outer: %w", errors.New("inner"))

	assert.Equal(t,
		[]zapcore.Field{zap.String("shutdownError", "outer"), zap.String("cause", "inner")},
		flattenErrorFields([]zapcore.Field{zap.NamedError("shutdownError", err)}),
	)
}

// TestFlattenErrorFields_LeavesOtherFieldsAlone pins that only error fields
// are rewritten, and that a line with none pays nothing.
//
/** @scenario "A wrapped error is one line, not a tree" */
func TestFlattenErrorFields_LeavesOtherFieldsAlone(t *testing.T) {
	fields := []zapcore.Field{zap.String("endpoint", "http://localhost:4318"), zap.Int("attempt", 3)}

	assert.Equal(t, fields, flattenErrorFields(fields))
}

// TestFlattenErrorFields_WrapperThatDoesNotEmbedItsCause pins the conservative
// branch: a wrapper whose text does not end in its cause's keeps every word.
//
/** @scenario "A wrapped error is one line, not a tree" */
func TestFlattenErrorFields_WrapperThatDoesNotEmbedItsCause(t *testing.T) {
	assert.Equal(t,
		[]zapcore.Field{zap.String("error", "upload failed"), zap.String("cause", "timeout")},
		flattenErrorFields([]zapcore.Field{zap.Error(&wrapper{message: "upload failed", cause: errors.New("timeout")})}),
	)
}

// TestFlattenErrorFields_CyclicChainTerminates pins the depth bound: an
// Unwrap that returns itself must not render forever.
//
/** @scenario "A wrapped error is one line, not a tree" */
func TestFlattenErrorFields_CyclicChainTerminates(t *testing.T) {
	cyclic := &selfWrapper{}

	assert.Len(t, flattenErrorFields([]zapcore.Field{zap.Error(cyclic)}), maxCauseDepth)
}

// wrapper is an error whose message does not contain its cause's.
type wrapper struct {
	message string
	cause   error
}

func (w *wrapper) Error() string { return w.message }
func (w *wrapper) Unwrap() error { return w.cause }

// selfWrapper unwraps to itself, the shape the depth bound exists for.
type selfWrapper struct{}

func (s *selfWrapper) Error() string { return "round and round" }
func (s *selfWrapper) Unwrap() error { return s }
