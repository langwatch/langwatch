package rules

import (
	"slices"
	"testing"

	"github.com/stretchr/testify/assert"
)

// pyShuffleReference is random.Random(seed).shuffle(list(range(n))) under
// CPython 3, for int seeds: small, multi-word and negative.
var pyShuffleReference = map[int]map[int][]int{
	0: {
		2:  {0, 1},
		3:  {0, 2, 1},
		5:  {2, 1, 0, 4, 3},
		10: {7, 8, 1, 5, 3, 4, 2, 0, 9, 6},
		30: {3, 10, 18, 17, 5, 0, 7, 26, 29, 14, 20, 25, 21, 2, 19, 4, 23, 6, 11, 22, 9, 28, 15, 16, 8, 1, 13, 24, 12, 27},
	},
	1: {
		2:  {1, 0},
		3:  {1, 2, 0},
		5:  {2, 3, 4, 0, 1},
		10: {6, 8, 9, 7, 5, 3, 0, 4, 1, 2},
		30: {26, 16, 11, 10, 23, 1, 5, 29, 7, 20, 9, 28, 17, 13, 0, 19, 22, 6, 12, 21, 14, 15, 3, 8, 2, 24, 25, 27, 18, 4},
	},
	42: {
		2:  {1, 0},
		3:  {1, 0, 2},
		5:  {3, 1, 2, 4, 0},
		10: {7, 3, 2, 8, 5, 6, 9, 4, 0, 1},
		30: {19, 14, 10, 26, 22, 6, 5, 12, 11, 15, 9, 25, 29, 21, 16, 27, 1, 13, 18, 2, 17, 28, 4, 24, 7, 8, 23, 0, 3, 20},
	},
	12345: {
		2:  {0, 1},
		3:  {2, 0, 1},
		5:  {4, 2, 1, 0, 3},
		10: {8, 7, 3, 5, 1, 2, 9, 4, 0, 6},
		30: {1, 14, 12, 16, 27, 22, 7, 20, 17, 15, 24, 2, 10, 21, 4, 19, 3, 28, 5, 29, 18, 8, 6, 11, 9, 25, 26, 0, 23, 13},
	},
	4294967303: {
		2:  {1, 0},
		3:  {2, 1, 0},
		5:  {3, 0, 4, 2, 1},
		10: {2, 1, 4, 7, 9, 0, 6, 8, 5, 3},
		30: {15, 21, 14, 26, 5, 0, 3, 9, 18, 16, 6, 29, 17, 23, 4, 8, 13, 22, 27, 19, 2, 28, 20, 12, 1, 25, 10, 11, 24, 7},
	},
	-5: {
		2:  {0, 1},
		3:  {0, 1, 2},
		5:  {0, 1, 3, 2, 4},
		10: {2, 3, 1, 0, 8, 7, 6, 5, 4, 9},
		30: {4, 26, 13, 2, 10, 9, 29, 24, 12, 17, 28, 6, 15, 18, 21, 3, 5, 1, 7, 14, 0, 16, 20, 27, 22, 25, 11, 23, 8, 19},
	},
}

func TestPyShuffleMatchesPythonsRandomShuffle(t *testing.T) {
	for seed, byLength := range pyShuffleReference {
		for length, want := range byLength {
			items := make([]int, length)
			for i := range items {
				items[i] = i
			}

			PyShuffle(seed, items)

			assert.Equal(t, want, items, "seed %d length %d", seed, length)
		}
	}
}

func TestPyShuffleKeepsEveryItem(t *testing.T) {
	items := []string{"a", "b", "c", "d"}

	PyShuffle(7, items)

	sorted := slices.Clone(items)
	slices.Sort(sorted)
	assert.Equal(t, []string{"a", "b", "c", "d"}, sorted)
}
