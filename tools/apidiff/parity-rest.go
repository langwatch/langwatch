package apidiff

import (
	"encoding/json"
	"strings"

	"github.com/langwatch/langwatch/tools/openapidiff"
)

// RestGap is one REST operation only one side documents.
type RestGap struct {
	Method      string `json:"method"`
	Path        string `json:"path"`
	OperationID string `json:"operationId,omitempty"`
	Module      string `json:"module"`
}

// RestDiff is one operation both sides document, with its field-level
// changes; Breaking says whether any of them is breaking.
type RestDiff struct {
	Method   string             `json:"method"`
	Path     string             `json:"path"`
	Module   string             `json:"module"`
	Breaking bool               `json:"breaking"`
	Changes  []ClassifiedChange `json:"changes"`
}

// RestParity is main's served document against the branch's.
type RestParity struct {
	MainCount   int        `json:"mainCount"`
	BranchCount int        `json:"branchCount"`
	Missing     []RestGap  `json:"missingOnBranch"`
	Extra       []RestGap  `json:"extraOnBranch"`
	Changed     []RestDiff `json:"changed"`
	Retired     []RestGap  `json:"ruledRetired"`
}

// RetiredRestOperation is a main path ruled out of the branch: main's root
// page is not an API, and ADR-158's amendment removes the dataset
// direct-upload byte routes rather than refusing them.
func RetiredRestOperation(path string) bool {
	return path == "/" || path == "/api/dataset/direct-upload" || strings.HasPrefix(path, "/api/dataset/direct-upload/")
}

// DiffRest compares two served documents operation by operation, ignoring
// URL version mounts and the /api ↔ /api/v1 alias, and pairing operations
// whose paths differ only in parameter names.
func DiffRest(base, candidate map[string]any, moduleOf func(method, path string) string) (RestParity, error) {
	base, err := aliasNormalized(base)
	if err != nil {
		return RestParity{}, err
	}
	candidate, err = aliasNormalized(candidate)
	if err != nil {
		return RestParity{}, err
	}
	changes, err := openapidiff.Diff(base, candidate, "", "")
	if err != nil {
		return RestParity{}, err
	}
	parity := RestParity{MainCount: countOperations(base), BranchCount: countOperations(candidate)}
	parity.collect(ClassifyChanges(base, candidate, changes), moduleOf)
	return parity, nil
}

// restCollector sorts classified changes into missing, extra and changed
// operations, dropping the removed+added pairs that differ only in path
// parameter names.
type restCollector struct {
	moduleOf func(method, path string) string
	paired   map[string]map[string]bool
	changed  map[string]*RestDiff
	order    []string
	parity   RestParity
}

func (parity *RestParity) collect(classified []ClassifiedChange, moduleOf func(method, path string) string) {
	collector := &restCollector{moduleOf: moduleOf, paired: pairedOperations(classified), changed: map[string]*RestDiff{}, parity: *parity}
	for index := range classified {
		if !VersionMountPath(classified[index].Path) {
			collector.add(classified[index])
		}
	}
	for _, key := range collector.order {
		collector.parity.Changed = append(collector.parity.Changed, *collector.changed[key])
	}
	*parity = collector.parity
}

func pairedOperations(classified []ClassifiedChange) map[string]map[string]bool {
	paired := map[string]map[string]bool{"added": {}, "removed": {}}
	for index := range classified {
		change := classified[index]
		if sides, ok := paired[change.Kind]; ok {
			sides[strings.ToUpper(change.Method)+" "+PairingPath(change.Path)] = true
		}
	}
	return paired
}

func (collector *restCollector) add(change ClassifiedChange) {
	method := strings.ToUpper(change.Method)
	pairing := method + " " + PairingPath(change.Path)
	gap := RestGap{Method: method, Path: change.Path, OperationID: operationIDOf(change), Module: collector.moduleOf(method, change.Path)}
	switch change.Kind {
	case "removed":
		switch {
		case collector.paired["added"][pairing]:
		case RetiredRestOperation(change.Path):
			collector.parity.Retired = append(collector.parity.Retired, gap)
		default:
			collector.parity.Missing = append(collector.parity.Missing, gap)
		}
	case "added":
		if !collector.paired["removed"][pairing] {
			collector.parity.Extra = append(collector.parity.Extra, gap)
		}
	default:
		collector.addChanged(gap, change)
	}
}

func (collector *restCollector) addChanged(gap RestGap, change ClassifiedChange) {
	key := gap.Method + " " + gap.Path
	diff := collector.changed[key]
	if diff == nil {
		diff = &RestDiff{Method: gap.Method, Path: gap.Path, Module: gap.Module}
		collector.changed[key] = diff
		collector.order = append(collector.order, key)
	}
	diff.Changes = append(diff.Changes, change)
	diff.Breaking = diff.Breaking || change.Class == openapidiff.ClassBreaking
}

func operationIDOf(change ClassifiedChange) string {
	pair := change.Fields["operation"]
	for _, side := range pair {
		if snapshot, ok := side.(map[string]any); ok {
			if id, ok := snapshot["operationId"].(string); ok {
				return id
			}
		}
	}
	return ""
}

func aliasNormalized(document map[string]any) (map[string]any, error) {
	data, err := json.Marshal(document)
	if err != nil {
		return nil, err
	}
	normalized, err := normalizeAliasSpec(data)
	if err != nil {
		return nil, err
	}
	return decodeObject(normalized)
}

func countOperations(document map[string]any) int {
	operations, err := Operations(document)
	if err != nil {
		return 0
	}
	count := 0
	for index := range operations {
		if !VersionMountPath(operations[index].Path) {
			count++
		}
	}
	return count
}

// RestBreaking counts the changed operations that carry a breaking change.
func (parity *RestParity) RestBreaking() int {
	count := 0
	for _, diff := range parity.Changed {
		if diff.Breaking {
			count++
		}
	}
	return count
}
