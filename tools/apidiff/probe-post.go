package apidiff

import (
	"strings"
)

// Post-pass probing, run after the main lockstep pass. Two concerns:
//
//  1. Collection verification: a 200 with [] on both sides proves nothing
//     about the list item shape. When a mutation created an entity this run,
//     re-probe matching collection GETs and check the entity is VISIBLE in
//     each side's list (mutation_not_visible otherwise), then compare the
//     now-non-empty list shapes. List GETs no mutation could cover report
//     unverified_shape (a coverage note, never a difference).
//  2. Permission probes: project-scoped reads are repeated with the
//     sibling-project key (B) and the foreign-org key (C). A 2xx answer
//     carrying the owning project's data is a permission_leak even when both
//     sides leak identically; a class disagreement is a permission_diff.

// mutationRecord is one entity created by a successful mutation probe,
// tracked per side because each instance mints its own IDs.
type mutationRecord struct {
	collectionPath string // canonical POST path
	idA            string // ID the candidate (A) instance returned
	idB            string // ID the base (B) instance returned
}

// collectionMatches reports whether a GET path plausibly lists what a POST
// path creates: identical paths, or the GET path is a strict ancestor of the
// POST path (POST /api/annotations/trace/{id} → GET /api/annotations).
func collectionMatches(getPath, postPath string) bool {
	return getPath == postPath || strings.HasPrefix(postPath, getPath+"/")
}

// verifyCollections re-probes every list GET that a successful mutation
// covered, in probe order (deterministic).
func (engine *probeEngine) verifyCollections(operations []Operation) []Finding {
	findings := make([]Finding, 0)
	verified := map[string]bool{}
	for _, record := range engine.mutations {
		matched := matchingReads(operations, record.collectionPath)
		for index := range matched {
			operation := matched[index]
			key := operation.Method + " " + operation.Path
			if verified[key] {
				continue
			}
			verified[key] = true
			findings = append(findings, engine.verifyCollection(operation, record)...)
		}
	}
	return findings
}

// matchingReads returns the read operations covering one collection path.
func matchingReads(operations []Operation, collectionPath string) []Operation {
	matched := make([]Operation, 0, 1)
	for index := range operations {
		operation := operations[index]
		if isReadMethod(operation.Method) && collectionMatches(operation.Path, collectionPath) {
			matched = append(matched, operation)
		}
	}
	return matched
}

// verifyCollection re-probes one collection GET and checks the created entity
// is visible on each side: both visible compares the now-non-empty lists, one
// visible is mutation_not_visible, neither is a probe note.
func (engine *probeEngine) verifyCollection(operation Operation, record mutationRecord) []Finding {
	params, unresolved := resolveParams(operation, engine.symbols, false)
	if unresolved != "" {
		return nil
	}
	pathA, pathB := operation.SidePaths()
	target := probeTarget{
		pathA:   substitutePath(pathA, params.pathValues),
		pathB:   substitutePath(pathB, params.pathValues),
		query:   params.query,
		headers: authHeaders(operation, engine.options.Schemes, engine.options.Keys),
	}
	read := probeCase{name: "collection"}
	transcript := engine.runCase(operation, read, target)
	engine.transcripts = append(engine.transcripts, transcript)

	visibleA := containsID(transcript.A.Body, record.idA)
	visibleB := containsID(transcript.B.Body, record.idB)
	if visibleA && visibleB {
		cmp := Comparison{Method: operation.Method, Path: operation.Path, Case: "collection", OperationID: operation.OperationID, ExactStatus: engine.options.ExactStatus}
		outcome := CompareResults(cmp, transcript.B, transcript.A)
		engine.suppressed.add(outcome.Suppressed)
		return outcome.Findings
	}
	if !visibleA && !visibleB {
		engine.progress("note %s %s: created entity not visible in either list\n", operation.Method, operation.Path)
		return nil
	}
	return []Finding{{
		Kind:        FindingMutationNotVisible,
		Method:      operation.Method,
		Path:        operation.Path,
		Case:        "collection",
		OperationID: operation.OperationID,
		Fields: map[string][2]any{
			"status":  {transcript.B.Status, transcript.A.Status},
			"visible": {visibleB, visibleA},
		},
	}}
}

// permissionProbes repeats every project-key read with the sibling-project
// (B) and foreign-org (C) keys, comparing denial behavior across sides.
func (engine *probeEngine) permissionProbes(operations []Operation) []Finding {
	keys := engine.options.Keys
	if keys.ProjectKeyB == "" || keys.ProjectKeyC == "" {
		return nil
	}
	findings := make([]Finding, 0)
	for index := range operations {
		operation := operations[index]
		if !isReadMethod(operation.Method) || !usesProjectKey(operation, engine.options.Schemes, keys) {
			continue
		}
		findings = append(findings, engine.permissionProbe(operation)...)
	}
	return findings
}

// permissionProbe runs one operation's read with both foreign keys.
func (engine *probeEngine) permissionProbe(operation Operation) []Finding {
	params, unresolved := resolveParams(operation, engine.symbols, false)
	if unresolved != "" {
		return nil
	}
	pathA, pathB := operation.SidePaths()
	target := probeTarget{
		pathA: substitutePath(pathA, params.pathValues),
		pathB: substitutePath(pathB, params.pathValues),
		query: params.query,
	}
	findings := make([]Finding, 0)
	for _, foreign := range []struct {
		label string
		key   string
	}{
		{"key-b", engine.options.Keys.ProjectKeyB},
		{"key-c", engine.options.Keys.ProjectKeyC},
	} {
		target.headers = authHeaders(operation, engine.options.Schemes, engine.options.Keys)
		target.headers["X-Auth-Token"] = foreign.key
		findings = append(findings, engine.permissionCase(operation, foreign.label, target)...)
	}
	return findings
}

// permissionCase probes both sides with one foreign key and classifies the
// outcome: leak (2xx carrying the owning project's data), diff (denial
// classes disagree), or nothing.
func (engine *probeEngine) permissionCase(operation Operation, label string, target probeTarget) []Finding {
	read := probeCase{name: "permission-" + label}
	transcript := engine.runCase(operation, read, target)
	engine.transcripts = append(engine.transcripts, transcript)

	leakA := transcript.A.Status >= 200 && transcript.A.Status < 300 && containsAnyID(transcript.A.Body, engine.leakSet(engine.idsA))
	leakB := transcript.B.Status >= 200 && transcript.B.Status < 300 && containsAnyID(transcript.B.Body, engine.leakSet(engine.idsB))
	if leakA || leakB {
		return []Finding{{
			Kind:        FindingPermissionLeak,
			Method:      operation.Method,
			Path:        operation.Path,
			Case:        read.name,
			OperationID: operation.OperationID,
			Fields: map[string][2]any{
				"key":    {label, label},
				"status": {transcript.B.Status, transcript.A.Status},
			},
		}}
	}
	if statusClass(transcript.A.Status) != statusClass(transcript.B.Status) {
		return []Finding{{
			Kind:        FindingPermissionDiff,
			Method:      operation.Method,
			Path:        operation.Path,
			Case:        read.name,
			OperationID: operation.OperationID,
			Fields: map[string][2]any{
				"key":    {label, label},
				"status": {transcript.B.Status, transcript.A.Status},
			},
		}}
	}
	return nil
}

// leakSet filters a side's captured IDs down to owner data: the fixture
// identities are legitimately present in a foreign key's OWN scope response
// (GET /api/me/project with key B answers B's project), and system_* IDs are
// global identities identical in every project, not tenant data.
func (engine *probeEngine) leakSet(ids map[string]bool) map[string]bool {
	set := make(map[string]bool, len(ids))
	for id := range ids {
		if leakExemptID(id) {
			continue
		}
		set[id] = true
	}
	return set
}

func leakExemptID(id string) bool {
	switch id {
	case fixtureProjectBID, fixtureProjectCID, fixtureOrg2ID, fixtureTeam2ID,
		// The seeded team/organization are shared org context: the same-org
		// sibling key B legitimately resolves to them. The owner's PROJECT id
		// (local-dev-project) stays in the leak set — a foreign key seeing it
		// is the sharpest leak signal.
		"local-dev-organization", "local-dev-team":
		return true
	}
	return strings.HasPrefix(id, "system_")
}

// markUnverifiedLists notes list GETs that answered 2xx with empty lists on
// both sides and had no mutation coverage — the item shape went unexercised.
func (engine *probeEngine) markUnverifiedLists(operations []Operation) []Finding {
	covered := engine.coveredReads(operations)
	readTranscripts := engine.readTranscripts()
	findings := make([]Finding, 0)
	for index := range operations {
		operation := operations[index]
		key := operation.Method + " " + operation.Path
		if !isReadMethod(operation.Method) || covered[key] {
			continue
		}
		transcript, ok := readTranscripts[key]
		if !ok || !emptyListOutcome(transcript) {
			continue
		}
		findings = append(findings, Finding{
			Kind:        FindingUnverifiedShape,
			Method:      operation.Method,
			Path:        operation.Path,
			Case:        "read",
			OperationID: operation.OperationID,
			Reason:      "empty list on both sides; item shape not exercised",
		})
	}
	return findings
}

// coveredReads returns the read operations matched by at least one mutation.
func (engine *probeEngine) coveredReads(operations []Operation) map[string]bool {
	covered := map[string]bool{}
	for _, record := range engine.mutations {
		matched := matchingReads(operations, record.collectionPath)
		for index := range matched {
			covered[matched[index].Method+" "+matched[index].Path] = true
		}
	}
	return covered
}

// readTranscripts indexes the read-case transcripts by operation.
func (engine *probeEngine) readTranscripts() map[string]Transcript {
	indexed := map[string]Transcript{}
	for index := range engine.transcripts {
		transcript := engine.transcripts[index]
		if transcript.Case == "read" {
			indexed[transcript.Method+" "+transcript.Path] = transcript
		}
	}
	return indexed
}

// emptyListOutcome reports whether both sides answered 2xx with bodies that
// contain at least one empty array and no non-empty array.
func emptyListOutcome(transcript Transcript) bool {
	if transcript.A.Status < 200 || transcript.A.Status >= 300 || transcript.B.Status < 200 || transcript.B.Status >= 300 {
		return false
	}
	return emptyListBody(transcript.A.Body) && emptyListBody(transcript.B.Body)
}

// emptyListBody reports whether a JSON body holds arrays that are ALL empty
// (and at least one exists), i.e. a list response with no items.
func emptyListBody(body string) bool {
	decoded, ok := decodeJSONBody(body)
	if !ok || decoded == nil {
		return false
	}
	arrays, nonEmpty := countArrays(decoded)
	return arrays > 0 && nonEmpty == 0
}

// countArrays counts arrays and non-empty arrays recursively.
func countArrays(value any) (arrays, nonEmpty int) {
	switch typed := value.(type) {
	case []any:
		arrays++
		if len(typed) > 0 {
			nonEmpty++
		}
		for _, element := range typed {
			childArrays, childNonEmpty := countArrays(element)
			arrays += childArrays
			nonEmpty += childNonEmpty
		}
	case map[string]any:
		for _, key := range sortedKeys(typed) {
			childArrays, childNonEmpty := countArrays(typed[key])
			arrays += childArrays
			nonEmpty += childNonEmpty
		}
	}
	return arrays, nonEmpty
}

// containsID reports whether the ID appears anywhere in a decoded JSON body.
func containsID(body, id string) bool {
	if id == "" {
		return false
	}
	decoded, ok := decodeJSONBody(body)
	if !ok {
		return false
	}
	return containsString(decoded, id)
}

// containsAnyID reports whether any of the IDs appears in the body.
func containsAnyID(body string, ids map[string]bool) bool {
	decoded, ok := decodeJSONBody(body)
	if !ok {
		return false
	}
	for id := range ids {
		if containsString(decoded, id) {
			return true
		}
	}
	return false
}

func containsString(value any, want string) bool {
	switch typed := value.(type) {
	case string:
		return typed == want
	case []any:
		return sliceContainsString(typed, want)
	case map[string]any:
		return mapContainsString(typed, want)
	default:
		return false
	}
}

func sliceContainsString(values []any, want string) bool {
	for _, element := range values {
		if containsString(element, want) {
			return true
		}
	}
	return false
}

func mapContainsString(object map[string]any, want string) bool {
	for _, key := range sortedKeys(object) {
		if containsString(object[key], want) {
			return true
		}
	}
	return false
}

// usesProjectKey reports whether the operation authenticates with the
// project-key credential (X-Auth-Token).
func usesProjectKey(operation Operation, schemes map[string]map[string]any, keys Keys) bool {
	for _, name := range operation.Security {
		if cred := schemeHeader(name, schemes[name], keys); cred.header == "X-Auth-Token" {
			return true
		}
	}
	return false
}

func isReadMethod(method string) bool {
	return method == "GET" || method == "HEAD"
}
