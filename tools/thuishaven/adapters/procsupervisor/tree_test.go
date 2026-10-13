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

func TestOrphanTargetsReachTheRestartLoopInItsOwnGroup(t *testing.T) {
	rows := parsePS(`  100     1   100 bash -lc cd /w && pnpm --filter @langwatch/dev-runtime dev
  101   100   100 node /opt/homebrew/bin/pnpm --filter @langwatch/dev-runtime dev
  102   101   100 pnpm-native --filter @langwatch/dev-runtime dev
  103   102   103 sh -c while true; do node src/app.entrypoint.ts; done
  104   103   103 node src/app.entrypoint.ts
  200     1   200 node /elsewhere/server.js
`)
	groups, pids := orphanTargets(rows, []string{"/w"}, 999)
	slices.Sort(pids)
	if !slices.Equal(groups, []int{100}) || !slices.Equal(pids, []int{101, 102, 103, 104}) {
		t.Fatalf("groups = %v pids = %v, want group 100 and every descendant down to the loop's node", groups, pids)
	}
}
