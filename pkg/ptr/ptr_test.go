package ptr

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestP(t *testing.T) {
	tests := []struct {
		name string
		val  int
	}{
		{name: "positive", val: 42},
		{name: "zero", val: 0},
		{name: "negative", val: -7},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := P(tc.val)
			require.NotNil(t, p)
			assert.Equal(t, tc.val, *p)
		})
	}
}

func TestValueOrNil_NonZero(t *testing.T) {
	result := ValueOrNil(42)
	require.NotNil(t, result)
	assert.Equal(t, 42, *result)
}

func TestValueOrNil_Zero(t *testing.T) {
	result := ValueOrNil(0)
	assert.Nil(t, result)
}

func TestValueOrZero_NonNil(t *testing.T) {
	v := 42
	assert.Equal(t, 42, ValueOrZero(&v))
}

func TestValueOrZero_Nil(t *testing.T) {
	var p *int
	assert.Equal(t, 0, ValueOrZero(p))
}

func TestShallowCopy(t *testing.T) {
	original := 42
	copied := ShallowCopy(&original)

	require.NotNil(t, copied)
	assert.Equal(t, 42, *copied)

	// Mutate copy; original unchanged.
	*copied = 99
	assert.Equal(t, 42, original)
	assert.Equal(t, 99, *copied)
}

func TestShallowCopy_Nil(t *testing.T) {
	var p *int
	assert.Nil(t, ShallowCopy(p))
}
