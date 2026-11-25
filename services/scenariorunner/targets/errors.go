package targets

import "errors"

// Error is an error shaped like a JavaScript Error: a name, its own message,
// an optional code and the error it was caused by. Error() is the message
// alone, as `error.message` is; the runner walks Unwrap to flatten the chain
// the way the Node child's formatScenarioChildError walks `cause`.
type Error struct {
	Name    string
	Message string
	Code    string
	Cause   error
}

func (e *Error) Error() string { return e.Message }

// Unwrap returns the cause.
func (e *Error) Unwrap() error { return e.Cause }

// newError is a plain `new Error(message)`.
func newError(message string) *Error { return &Error{Name: "Error", Message: message} }

// NameOf is the JS name of an error: its own for an *Error, "Error" otherwise.
func NameOf(err error) string {
	var e *Error
	if errors.As(err, &e) && e.Name != "" {
		return e.Name
	}
	return "Error"
}

// ToString is `String(error)`: "Name: message", or the name alone.
func ToString(err error) string {
	name := NameOf(err)
	if err.Error() == "" {
		return name
	}
	return name + ": " + err.Error()
}
