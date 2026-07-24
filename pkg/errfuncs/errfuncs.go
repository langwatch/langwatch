package errfuncs

import "errors"

// As is a generic wrapper around errors.As for cleaner type assertions.
func As[T error](err error) (target T, ok bool) {
	ok = errors.As(err, &target)
	return
}
