package apidiff

import (
	"encoding/json"
	"reflect"
	"sort"

	"github.com/langwatch/langwatch/tools/openapidiff"
)

// pairRenamedOperations respells the BASE document's paths and path-parameter
// names to the candidate's wherever one operation is the same route under a
// renamed parameter, so the spec diff compares the pair instead of reporting
// a removal and an addition. The candidate's spelling wins because the union,
// the ledger rows and the report all name an operation by it.
//
// A pairing is refused unless the route is the same method on a path that
// differs only in parameter names (PairingPath), has exactly one such partner
// on each side, and carries identical effective security. A refused pair stays
// a removal plus an addition: the loud reading is the safe one.
func pairRenamedOperations(baseBytes, candidateBytes []byte) ([]byte, error) {
	base, err := decodeObject(baseBytes)
	if err != nil {
		return nil, err
	}
	candidate, err := decodeObject(candidateBytes)
	if err != nil {
		return nil, err
	}
	basePaths, baseOK := base["paths"].(map[string]any)
	candidatePaths, candidateOK := candidate["paths"].(map[string]any)
	if !baseOK || !candidateOK {
		return baseBytes, nil
	}
	pairing := renamePairing{base: base, candidate: candidate, basePaths: basePaths, candidatePaths: candidatePaths}
	if !pairing.run() {
		return baseBytes, nil
	}
	return json.Marshal(base)
}

type renamePairing struct {
	base, candidate           map[string]any
	basePaths, candidatePaths map[string]any
}

// run moves every paired operation and reports whether anything moved.
func (pairing renamePairing) run() bool {
	baseOnly := unpairedPaths(pairing.basePaths, pairing.candidatePaths)
	candidateOnly := unpairedPaths(pairing.candidatePaths, pairing.basePaths)
	moved := false
	keys := make([]string, 0, len(baseOnly))
	for key := range baseOnly {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if len(baseOnly[key]) != 1 || len(candidateOnly[key]) != 1 {
			continue
		}
		if pairing.movePath(baseOnly[key][0], candidateOnly[key][0]) {
			moved = true
		}
	}
	return moved
}

// unpairedPaths groups the paths only `own` documents by their pairing form.
func unpairedPaths(own, other map[string]any) map[string][]string {
	groups := map[string][]string{}
	for path := range own {
		if _, shared := other[path]; !shared {
			key := PairingPath(path)
			groups[key] = append(groups[key], path)
		}
	}
	return groups
}

// movePath moves each operation of one base path that its candidate partner
// also documents, with the same security, to the candidate's path.
func (pairing renamePairing) movePath(basePath, candidatePath string) bool {
	baseItem, baseOK := pairing.basePaths[basePath].(map[string]any)
	candidateItem, candidateOK := pairing.candidatePaths[candidatePath].(map[string]any)
	if !baseOK || !candidateOK || baseItem["$ref"] != nil || candidateItem["$ref"] != nil {
		return false
	}
	renames, ok := parameterRenames(basePath, candidatePath)
	if !ok {
		return false
	}
	target := pairing.takePairedOperations(baseItem, candidateItem, renames)
	if len(target) == 0 {
		return false
	}
	for key, value := range baseItem {
		if !openapidiff.IsHTTPMethod(key) {
			target[key] = value
		}
	}
	if parameters, ok := target["parameters"]; ok {
		target["parameters"] = renamedParameters(pairing.base, parameters, renames)
	}
	pairing.basePaths[candidatePath] = target
	if !hasOperation(baseItem) {
		delete(pairing.basePaths, basePath)
	}
	return true
}

// takePairedOperations removes from baseItem, and returns renamed, every
// operation the candidate item documents under the same method and security.
func (pairing renamePairing) takePairedOperations(baseItem, candidateItem map[string]any, renames map[string]string) map[string]any {
	taken := map[string]any{}
	for _, method := range sortedKeys(baseItem) {
		baseOperation, isOperation := baseItem[method].(map[string]any)
		candidateOperation, partnered := candidateItem[method].(map[string]any)
		if !isOperation || !partnered || !openapidiff.IsHTTPMethod(method) {
			continue
		}
		baseSecurity := effectiveSecurity(pairing.base, baseItem, baseOperation)
		candidateSecurity := effectiveSecurity(pairing.candidate, candidateItem, candidateOperation)
		if reflect.DeepEqual(baseSecurity, candidateSecurity) {
			taken[method] = renamedOperation(pairing.base, baseOperation, renames)
			delete(baseItem, method)
		}
	}
	return taken
}

func hasOperation(pathItem map[string]any) bool {
	for key := range pathItem {
		if openapidiff.IsHTTPMethod(key) {
			return true
		}
	}
	return false
}

// parameterRenames maps each base placeholder name to the candidate's, by
// position. A base name that would map to two candidate names refuses the pair.
func parameterRenames(basePath, candidatePath string) (map[string]string, bool) {
	baseNames, candidateNames := pathPlaceholders(basePath), pathPlaceholders(candidatePath)
	if len(baseNames) != len(candidateNames) {
		return nil, false
	}
	renames := map[string]string{}
	for index, name := range baseNames {
		if prior, seen := renames[name]; seen && prior != candidateNames[index] {
			return nil, false
		}
		renames[name] = candidateNames[index]
	}
	return renames, true
}

// effectiveSecurity is the security an operation answers under: its own, else
// its path item's, else the document's.
func effectiveSecurity(document, pathItem, operation map[string]any) any {
	for _, level := range []map[string]any{operation, pathItem, document} {
		if security, declared := level["security"]; declared {
			return security
		}
	}
	return nil
}

func renamedOperation(document, operation map[string]any, renames map[string]string) map[string]any {
	copied := make(map[string]any, len(operation))
	for key, value := range operation {
		copied[key] = value
	}
	if parameters, ok := operation["parameters"]; ok {
		copied["parameters"] = renamedParameters(document, parameters, renames)
	}
	return copied
}

// renamedParameters respells the path parameters of one parameter list. A
// referenced parameter is inlined first, because the shared component keeps
// the name every other user of it relies on.
func renamedParameters(document map[string]any, parameters any, renames map[string]string) any {
	items, ok := parameters.([]any)
	if !ok {
		return parameters
	}
	renamed := make([]any, len(items))
	for index, item := range items {
		renamed[index] = renamedParameter(document, item, renames)
	}
	return renamed
}

func renamedParameter(document map[string]any, item any, renames map[string]string) any {
	resolved, ok := resolveRefs(document, item, map[string]bool{}).(map[string]any)
	if !ok {
		return item
	}
	name, _ := resolved["name"].(string)
	location, _ := resolved["in"].(string)
	replacement, rename := renames[name]
	if location != "path" || !rename || replacement == name {
		return item
	}
	copied := make(map[string]any, len(resolved))
	for key, value := range resolved {
		copied[key] = value
	}
	copied["name"] = replacement
	return copied
}
