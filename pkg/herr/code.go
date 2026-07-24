package herr

import "errors"

// Code is a string-based error code that implements the error interface.
type Code string

func (c Code) Error() string  { return string(c) }
func (c Code) String() string { return string(c) }

// IsCode is a convenience wrapper for errors.Is with a Code target.
func IsCode(err error, code Code) bool {
	return errors.Is(err, code)
}
