package herr

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	codeNotFound Code = "not_found"
	codeInternal Code = "internal"
)

func TestNew_SetsCodeAndMeta(t *testing.T) {
	reason := errors.New("record missing")
	e := New(context.Background(), codeNotFound, M{"id": "abc"}, reason)

	assert.Equal(t, codeNotFound, e.Code)
	assert.Equal(t, "abc", e.Meta["id"])
	require.Len(t, e.Reasons, 1)
	assert.Equal(t, reason, e.Reasons[0])
}

func TestE_Error_IncludesCodeAndMeta(t *testing.T) {
	reason := errors.New("timeout")
	e := New(context.Background(), codeInternal, M{"svc": "db"}, reason)

	s := e.Error()
	assert.Contains(t, s, "internal")
	assert.Contains(t, s, "svc")
	assert.Contains(t, s, "db")
	assert.Contains(t, s, "timeout")
}

func TestE_Is_MatchesSameCode(t *testing.T) {
	e := New(context.Background(), codeNotFound, nil, errors.New("gone"))

	assert.True(t, errors.Is(e, codeNotFound))
}

func TestE_Is_DifferentCode(t *testing.T) {
	e := New(context.Background(), codeNotFound, nil, errors.New("gone"))

	assert.False(t, errors.Is(e, codeInternal))
}

func TestE_Unwrap(t *testing.T) {
	reason1 := errors.New("reason one")
	reason2 := errors.New("reason two")
	e := New(context.Background(), codeNotFound, nil, reason1, reason2)

	unwrapped := e.Unwrap()
	require.Len(t, unwrapped, 2)
	assert.Equal(t, reason1, unwrapped[0])
	assert.Equal(t, reason2, unwrapped[1])
}

func TestIsCode(t *testing.T) {
	e := New(context.Background(), codeNotFound, nil, errors.New("gone"))
	wrapped := errors.Join(errors.New("wrapper"), e)

	assert.True(t, IsCode(wrapped, codeNotFound))
	assert.False(t, IsCode(wrapped, codeInternal))
}

func TestCode_Error(t *testing.T) {
	var err error = codeNotFound
	assert.Equal(t, "not_found", err.Error())
}

func TestNew_PanicsWithNilReason(t *testing.T) {
	assert.Panics(t, func() {
		New(context.Background(), codeNotFound, nil, nil)
	})
}
