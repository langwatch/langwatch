package procsupervisor

import (
	"slices"
	"testing"
)

func TestDescendantsOfFollowsGrandchildrenInOtherGroups(t *testing.T) {
	parents := map[int]int{10: 1, 11: 10, 12: 11, 13: 12, 20: 1, 21: 20}
	got := descendantsOf(10, parents)
	slices.Sort(got)
	if !slices.Equal(got, []int{11, 12, 13}) {
		t.Fatalf("descendantsOf(10) = %v, want [11 12 13]: every level, nothing from a sibling tree", got)
	}
}
