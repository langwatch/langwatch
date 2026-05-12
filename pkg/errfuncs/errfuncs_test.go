package errfuncs

import (
	"errors"
	"fmt"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAs_Match(t *testing.T) {
	inner := &os.PathError{Op: "open", Path: "/tmp/x", Err: errors.New("no such file")}
	wrapped := fmt.Errorf("wrapped: %w", inner)

	target, ok := As[*os.PathError](wrapped)

	assert.True(t, ok)
	assert.Equal(t, "/tmp/x", target.Path)
}

func TestAs_NoMatch(t *testing.T) {
	err := errors.New("plain error")

	_, ok := As[*os.PathError](err)

	assert.False(t, ok)
}
