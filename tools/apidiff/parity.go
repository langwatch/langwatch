package apidiff

import (
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/openapidiff"
)

// trpcMethod is the Method a tRPC parity change carries into the report and
// ledger, so procedures group under causes the way REST operations do.
const trpcMethod = "trpc"

// unownedModule groups what no catalog module claims.
const unownedModule = "(unowned)"

// ProcedureGap is one procedure only one side declares.
type ProcedureGap struct {
	Path   string `json:"path"`
	Kind   string `json:"kind"`
	Source string `json:"source"`
	Module string `json:"module"`
}

// ProcedureDiff is one procedure both sides declare whose kind, input or
// declared output differs in a way that can break a caller of main.
type ProcedureDiff struct {
	Path         string                    `json:"path"`
	Module       string                    `json:"module"`
	MainSource   string                    `json:"mainSource"`
	BranchSource string                    `json:"branchSource"`
	Changes      []openapidiff.FieldChange `json:"changes"`
}

// ProcedurePair is a likely rename (same namespace, similar name) or move
// (same name under another namespace) with the same input shape.
type ProcedurePair struct {
	Main       string `json:"main"`
	Branch     string `json:"branch"`
	Module     string `json:"module"`
	MainModule string `json:"mainModule,omitempty"`
	Reason     string `json:"reason"`
}

// TrpcParity is main's procedures against the branch's contract declarations.
type TrpcParity struct {
	MainCount   int             `json:"mainCount"`
	BranchCount int             `json:"branchCount"`
	Missing     []ProcedureGap  `json:"missingOnBranch"`
	Extra       []ProcedureGap  `json:"extraOnBranch"`
	Breaking    []ProcedureDiff `json:"breaking"`
	Renamed     []ProcedurePair `json:"renameCandidates"`
	Moved       []ProcedurePair `json:"namespaceMoveCandidates"`
	OwnerMoves  []ProcedurePair `json:"ruledOwnerMoves"`
	Retired     []ProcedureGap  `json:"ruledRetired"`
}

// acceptedNamespaceMoves are the tRPC namespace moves ruled to match main
// (parity rulings, 2026-09-25): only tracesV2 became traces. A move into
// another module's namespace is settled by ownerMoves; a same-module rename
// stays missing until the branch serves main's name.
var acceptedNamespaceMoves = map[string]string{"tracesV2": "traces"}

// acceptedProcedureMoves are single procedures ruled onto a new path: record
// §3 (5bcdf4ee97) moved the coding-agent reads to their owner's namespace.
var acceptedProcedureMoves = map[string]string{
	"tracesV2.codingAgentSession":    "codingAgents.session",
	"tracesV2.codingAgentTranscript": "codingAgents.transcript",
}

// retiredProcedures are main procedures ruled out of the branch (Alex,
// 2026-09-25: the browser's public config is injected into the HTML).
var retiredProcedures = map[string]bool{"publicEnv": true}

// movedPath is where an accepted namespace move put a main procedure path.
func movedPath(path string) (string, bool) {
	namespace, rest, found := strings.Cut(path, ".")
	target, accepted := acceptedNamespaceMoves[namespace]
	if !found || !accepted {
		return "", false
	}
	return target + "." + rest, true
}

// procedureIndex maps a path to its procedure.
func procedureIndex(procedures []Procedure) map[string]Procedure {
	index := make(map[string]Procedure, len(procedures))
	for _, procedure := range procedures {
		index[procedure.Path] = procedure
	}
	return index
}

// DiffProcedures compares the two manifests. moduleOf names the module that
// owns a procedure path.
func DiffProcedures(main, branch []Procedure, moduleOf func(Procedure) string) TrpcParity {
	parity := TrpcParity{MainCount: len(main), BranchCount: len(branch), OwnerMoves: []ProcedurePair{}, Retired: []ProcedureGap{}}
	mainIndex, branchIndex := procedureIndex(main), procedureIndex(branch)
	matched := map[string]bool{}
	comparison := procedureComparison{branchIndex: branchIndex, moduleOf: moduleOf}
	for _, procedure := range main {
		if counterpart, ok := comparison.file(&parity, procedure); ok {
			matched[counterpart.Path] = true
		}
	}
	for _, procedure := range branch {
		if _, ok := mainIndex[procedure.Path]; !ok && !matched[procedure.Path] {
			parity.Extra = append(parity.Extra, gapOf(procedure, moduleOf))
		}
	}
	search := candidateSearch{mainIndex: mainIndex, branchIndex: branchIndex}
	parity.Renamed, parity.Moved = search.pairs(parity.Missing, parity.Extra)
	ownerMoves{mainIndex: mainIndex, branchIndex: branchIndex, moduleOf: moduleOf}.settle(&parity)
	attributeUnowned(parity.Missing, append(append([]ProcedurePair{}, parity.Renamed...), parity.Moved...))
	return parity
}

// procedureComparison files main procedures against the branch's.
type procedureComparison struct {
	branchIndex map[string]Procedure
	moduleOf    func(Procedure) string
}

// file records one main procedure as retired, missing or breaking, and
// answers the branch procedure serving it.
func (comparison procedureComparison) file(parity *TrpcParity, procedure Procedure) (Procedure, bool) {
	branchIndex, moduleOf := comparison.branchIndex, comparison.moduleOf
	counterpart, ok := counterpartOf(procedure.Path, branchIndex)
	switch {
	case !ok && retiredProcedures[procedure.Path]:
		parity.Retired = append(parity.Retired, gapOf(procedure, moduleOf))
		return Procedure{}, false
	case !ok:
		parity.Missing = append(parity.Missing, gapOf(procedure, moduleOf))
		return Procedure{}, false
	}
	if changes := procedureChanges(procedure, counterpart); len(changes) > 0 {
		parity.Breaking = append(parity.Breaking, ProcedureDiff{
			Path: procedure.Path, Module: moduleOf(counterpart),
			MainSource: procedure.Source, BranchSource: counterpart.Source, Changes: changes,
		})
	}
	return counterpart, true
}

// attributeUnowned hands a missing procedure no catalog module claims to the
// module its namespace's rename or move candidates landed in (main's tracesV2
// became the trace module's traces).
func attributeUnowned(missing []ProcedureGap, pairs []ProcedurePair) {
	landed := map[string]string{}
	for _, pair := range pairs {
		namespace, _ := splitProcedurePath(pair.Main)
		if _, seen := landed[namespace]; !seen && pair.Module != unownedModule {
			landed[namespace] = pair.Module
		}
	}
	for index := range missing {
		namespace, _ := splitProcedurePath(missing[index].Path)
		if module, ok := landed[namespace]; ok && missing[index].Module == unownedModule {
			missing[index].Module = module
		}
	}
}

// counterpartOf is the branch procedure serving a main path: the same path,
// else the path an accepted namespace move gave it.
func counterpartOf(path string, branchIndex map[string]Procedure) (Procedure, bool) {
	if counterpart, ok := branchIndex[path]; ok {
		return counterpart, true
	}
	if ruled, isRuled := acceptedProcedureMoves[path]; isRuled {
		counterpart, ok := branchIndex[ruled]
		return counterpart, ok
	}
	moved, isMoved := movedPath(path)
	if !isMoved {
		return Procedure{}, false
	}
	counterpart, ok := branchIndex[moved]
	return counterpart, ok
}

func gapOf(procedure Procedure, moduleOf func(Procedure) string) ProcedureGap {
	return ProcedureGap{Path: procedure.Path, Kind: procedure.Kind, Source: procedure.Source, Module: moduleOf(procedure)}
}

// procedureChanges keeps only the breaking differences: an input the branch
// accepts less of, an output it answers less of, or a changed kind.
func procedureChanges(main, branch Procedure) []openapidiff.FieldChange {
	changes := []openapidiff.FieldChange{}
	if main.Kind != branch.Kind {
		changes = append(changes, openapidiff.FieldChange{Kind: "kind_changed", Class: openapidiff.ClassBreaking, Field: "kind", Before: main.Kind, After: branch.Kind})
	}
	changes = append(changes, breakingSchemaChanges(main.Input, branch.Input, openapidiff.Comparison{Direction: openapidiff.Request, Prefix: "input"})...)
	if main.Output != nil && branch.Output != nil {
		changes = append(changes, breakingSchemaChanges(main.Output, branch.Output, openapidiff.Comparison{Direction: openapidiff.Response, Prefix: "output"})...)
	}
	return changes
}

func breakingSchemaChanges(main, branch map[string]any, comparison openapidiff.Comparison) []openapidiff.FieldChange {
	if unconverted(main) || unconverted(branch) {
		return nil
	}
	compared := comparison.Compare(flattenProcedureSchema(main), flattenProcedureSchema(branch))
	kept := []openapidiff.FieldChange{}
	for _, change := range compared {
		if change.Class == openapidiff.ClassBreaking {
			change.Kind = comparison.Prefix + "_" + change.Kind
			kept = append(kept, change)
		}
	}
	return kept
}

// flattenProcedureSchema flattens a procedure schema against itself (its refs
// point into its own $defs). A procedure with no input accepts anything.
func flattenProcedureSchema(schema map[string]any) map[string]openapidiff.SchemaField {
	if schema == nil {
		return map[string]openapidiff.SchemaField{"$": {Required: true}}
	}
	return openapidiff.FlattenSchema(schema, schema)
}

func unconverted(schema map[string]any) bool {
	_, failed := schema["unconverted"]
	return failed
}

// shapeKey is an input's field set, for matching a missing procedure to the
// branch procedure that may have replaced it.
func shapeKey(procedure Procedure) string {
	if procedure.Input == nil || unconverted(procedure.Input) {
		return ""
	}
	fields := flattenProcedureSchema(procedure.Input)
	paths := make([]string, 0, len(fields))
	for path, field := range fields {
		if path != "$" {
			paths = append(paths, path+":"+strings.Join(field.Types, "|"))
		}
	}
	sort.Strings(paths)
	return strings.Join(paths, ",")
}

// candidateSearch proposes renames (same namespace, similar name, same input
// shape) and namespace moves (same name, same non-empty input shape).
type candidateSearch struct {
	mainIndex   map[string]Procedure
	branchIndex map[string]Procedure
}

func (search candidateSearch) pairs(missing, extra []ProcedureGap) ([]ProcedurePair, []ProcedurePair) {
	lists := &pairLists{renamed: []ProcedurePair{}, moved: []ProcedurePair{}}
	extraShapes := make(map[string]string, len(extra))
	for _, added := range extra {
		extraShapes[added.Path] = shapeKey(search.branchIndex[added.Path])
	}
	for _, gone := range missing {
		goneShape := shapeKey(search.mainIndex[gone.Path])
		for _, added := range extra {
			if extraShapes[added.Path] == goneShape {
				lists.add(gone.Path, added, goneShape)
			}
		}
	}
	return lists.renamed, lists.moved
}

type pairLists struct {
	renamed []ProcedurePair
	moved   []ProcedurePair
}

func (lists *pairLists) add(gonePath string, added ProcedureGap, shape string) {
	pair, isRename, ok := pairOf(gonePath, added, shape)
	switch {
	case ok && isRename:
		lists.renamed = append(lists.renamed, pair)
	case ok:
		lists.moved = append(lists.moved, pair)
	}
}

// pairOf decides whether a same-shape branch procedure is a rename or a move
// of a missing main procedure.
func pairOf(gonePath string, added ProcedureGap, shape string) (ProcedurePair, bool, bool) {
	goneNamespace, goneName := splitProcedurePath(gonePath)
	addedNamespace, addedName := splitProcedurePath(added.Path)
	pair := ProcedurePair{Main: gonePath, Branch: added.Path, Module: added.Module}
	switch {
	case addedNamespace == goneNamespace && similarNames(goneName, addedName):
		pair.Reason = "same namespace, similar name, same input"
		return pair, true, true
	case addedNamespace != goneNamespace && addedName == goneName && shape != "":
		pair.Reason = "same name and input under another namespace"
		return pair, false, true
	}
	return pair, false, false
}

func splitProcedurePath(path string) (string, string) {
	position := strings.LastIndex(path, ".")
	if position < 0 {
		return "", path
	}
	return path[:position], path[position+1:]
}

// similarNames is containment either way, or an edit distance within a third
// of the longer name.
func similarNames(left, right string) bool {
	left, right = strings.ToLower(left), strings.ToLower(right)
	if strings.Contains(left, right) || strings.Contains(right, left) {
		return true
	}
	longest := max(len(left), len(right))
	return editDistance(left, right)*3 <= longest
}

func editDistance(left, right string) int {
	previous := make([]int, len(right)+1)
	for index := range previous {
		previous[index] = index
	}
	for i := 1; i <= len(left); i++ {
		current := make([]int, len(right)+1)
		current[0] = i
		for j := 1; j <= len(right); j++ {
			cost := 1
			if left[i-1] == right[j-1] {
				cost = 0
			}
			current[j] = min(previous[j]+1, current[j-1]+1, previous[j-1]+cost)
		}
		previous = current
	}
	return previous[len(right)]
}

// TrpcChanges turns the tRPC parity into report changes: every missing
// procedure and every breaking field is a cause, exactly as a removed or
// changed REST operation is. Extra procedures are not defects.
func (parity TrpcParity) TrpcChanges() []openapidiff.Change {
	changes := []openapidiff.Change{}
	for _, gap := range parity.Missing {
		changes = append(changes, openapidiff.Change{Kind: "missing", Path: gap.Path, Method: trpcMethod, Fields: map[string][2]any{"procedure": {gap.Source, nil}}})
	}
	for _, diff := range parity.Breaking {
		for _, change := range diff.Changes {
			changes = append(changes, openapidiff.Change{Kind: change.Kind, Path: diff.Path, Method: trpcMethod, Fields: map[string][2]any{change.Field: {change.Before, change.After}}})
		}
	}
	return changes
}
