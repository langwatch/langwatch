package slicefuncs

import (
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestMap(t *testing.T) {
	ints := []int{1, 2, 3}
	result := Map(ints, strconv.Itoa)

	assert.Equal(t, []string{"1", "2", "3"}, result)
}

func TestMap_Empty(t *testing.T) {
	result := Map([]int{}, strconv.Itoa)

	assert.Equal(t, []string{}, result)
	assert.Empty(t, result)
}

func TestMap_Nil(t *testing.T) {
	result := Map(nil, strconv.Itoa)

	assert.NotNil(t, result, "nil input should return empty slice, not nil")
	assert.Empty(t, result)
}
