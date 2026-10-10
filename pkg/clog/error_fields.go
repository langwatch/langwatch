package clog

import (
	"errors"
	"strings"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
)

// The keys a flattened chain is written under: the outermost message under
// "error", every wrapped one under "cause", innermost last — the reading order
// of `fmt.Errorf("...: %w", err)` itself.
const (
	errorKey = "error"
	causeKey = "cause"
)

// maxCauseDepth bounds the walk. Nothing legitimate wraps this deep, and a
// cyclic Unwrap (a custom error type returning itself) would otherwise render
// the same message until the buffer ran out.
const maxCauseDepth = 8

// flattenErrorFields rewrites every error field as one message per wrap level,
// so a console line stays a line.
//
// The pretty console encoder renders an error by expanding its Unwrap chain as
// a nested tree — `↳ error=… / .cause=… / .cause.cause=…` over three or four
// indented lines. Every other field on every other lane is one key=value pair
// on the line it belongs to, and a reader scanning a column of lanes has to
// re-find where the message went. Fields that are not errors are passed
// through untouched.
func flattenErrorFields(fields []zapcore.Field) []zapcore.Field {
	if !hasErrorField(fields) {
		return fields
	}

	flattened := make([]zapcore.Field, 0, len(fields)+maxCauseDepth)
	for _, field := range fields {
		err, ok := errorFrom(field)
		if !ok {
			flattened = append(flattened, field)
			continue
		}
		for depth, message := range causeChain(err) {
			key := causeKey
			if depth == 0 {
				key = field.Key
			}
			flattened = append(flattened, zap.String(key, message))
		}
	}
	return flattened
}

// hasErrorField keeps the common line — a log line with no error on it — from
// paying for a second slice.
func hasErrorField(fields []zapcore.Field) bool {
	for _, field := range fields {
		if _, ok := errorFrom(field); ok {
			return true
		}
	}
	return false
}

// errorFrom reads the error out of a field zap built with zap.Error or
// zap.NamedError. Any other field type is not ours to rewrite.
func errorFrom(field zapcore.Field) (error, bool) {
	if field.Type != zapcore.ErrorType {
		return nil, false
	}
	err, ok := field.Interface.(error)
	if !ok || err == nil {
		return nil, false
	}
	return err, true
}

// causeChain is one message per wrap level, outermost first.
//
// A wrapped error's Error() already contains its cause's, so each level's own
// message is what is left once the child's text is trimmed off the end —
// otherwise every level would repeat everything below it and the line would
// carry the same words four times.
func causeChain(err error) []string {
	messages := make([]string, 0, maxCauseDepth)
	for depth := 0; err != nil && depth < maxCauseDepth; depth++ {
		next := errors.Unwrap(err)
		if next == nil {
			messages = append(messages, err.Error())
			break
		}
		messages = append(messages, ownMessage(err.Error(), next.Error()))
		err = next
	}
	return messages
}

// ownMessage strips a cause's rendering off the end of its wrapper's, with the
// ": " a wrap conventionally joins them by. A wrapper that does not embed its
// cause's text (or embeds it somewhere other than the end) keeps its message
// whole — trimming there would lose words rather than duplicate them.
func ownMessage(message, cause string) string {
	trimmed := strings.TrimSuffix(message, cause)
	if trimmed == message {
		return message
	}
	trimmed = strings.TrimRight(trimmed, " ")
	trimmed = strings.TrimSuffix(trimmed, ":")
	if trimmed == "" {
		return message
	}
	return trimmed
}
