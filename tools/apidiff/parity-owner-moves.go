package apidiff

import "slices"

// ownerMoveReason marks a move ruled to match main (ARCHITECTURE.md §3).
const ownerMoveReason = "ruled owner move: the procedure's owning module serves it under its own namespace"

// ownerMoves settles the namespace-move candidates that ARCHITECTURE.md §3
// rules intended: a procedure main hosted under another subject's namespace,
// now served under a different, owning module's namespace. An accepted move is
// neither missing nor extra, and its input is still compared field by field.
type ownerMoves struct {
	mainIndex   map[string]Procedure
	branchIndex map[string]Procedure
	moduleOf    func(Procedure) string
}

// settle moves each unambiguous cross-module candidate out of Missing, Extra
// and Moved into OwnerMoves, adding its breaking differences.
func (moves ownerMoves) settle(parity *TrpcParity) {
	accepted := moves.accepted(parity.Moved)
	if len(accepted) == 0 {
		return
	}
	mainPaths, branchPaths := map[string]bool{}, map[string]bool{}
	for _, pair := range accepted {
		mainPaths[pair.Main], branchPaths[pair.Branch] = true, true
		main, branch := moves.mainIndex[pair.Main], moves.branchIndex[pair.Branch]
		if changes := procedureChanges(main, branch); len(changes) > 0 {
			parity.Breaking = append(parity.Breaking, ProcedureDiff{
				Path: pair.Main, Module: pair.Module,
				MainSource: main.Source, BranchSource: branch.Source, Changes: changes,
			})
		}
	}
	parity.OwnerMoves = append(parity.OwnerMoves, accepted...)
	parity.Missing = slices.DeleteFunc(parity.Missing, func(gap ProcedureGap) bool { return mainPaths[gap.Path] })
	parity.Extra = slices.DeleteFunc(parity.Extra, func(gap ProcedureGap) bool { return branchPaths[gap.Path] })
	parity.Moved = slices.DeleteFunc(parity.Moved, func(pair ProcedurePair) bool {
		return mainPaths[pair.Main] || branchPaths[pair.Branch]
	})
}

// accepted keeps the cross-module candidates of the same kind whose main and
// branch paths each have exactly one such candidate.
func (moves ownerMoves) accepted(candidates []ProcedurePair) []ProcedurePair {
	crossModule := []ProcedurePair{}
	mainSeen, branchSeen := map[string]int{}, map[string]int{}
	for _, pair := range candidates {
		main, branch := moves.mainIndex[pair.Main], moves.branchIndex[pair.Branch]
		mainModule := moves.moduleOf(main)
		if main.Kind != branch.Kind || mainModule == unownedModule || pair.Module == unownedModule || mainModule == pair.Module {
			continue
		}
		pair.MainModule, pair.Reason = mainModule, ownerMoveReason
		crossModule = append(crossModule, pair)
		mainSeen[pair.Main]++
		branchSeen[pair.Branch]++
	}
	return slices.DeleteFunc(crossModule, func(pair ProcedurePair) bool {
		return mainSeen[pair.Main] != 1 || branchSeen[pair.Branch] != 1
	})
}
