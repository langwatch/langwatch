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
	assert.Len(t, result, 0)
}

func TestMap_Nil(t *testing.T) {
	result := Map(nil, strconv.Itoa)

	assert.NotNil(t, result, "nil input should return empty slice, not nil")
	assert.Len(t, result, 0)
}
