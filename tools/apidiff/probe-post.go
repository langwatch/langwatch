package apidiff

import (
	"sort"
	"strings"
	"time"
)

// Settle bounds for the collection-visibility wait.
const (
	defaultSettleTimeout = 10 * time.Second
	settlePollInterval   = 500 * time.Millisecond
	settleCollectionCase = "collection"
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
// visible is mutation_not_visible, neither is a probe note. The re-probe is
// an event-driven settle (settleForVisibility), never a fixed sleep.
func (engine *probeEngine) verifyCollection(operation Operation, record mutationRecord) []Finding {
	target, ok := engine.ownerTarget(operation)
	if !ok {
		return nil
	}
	settled := engine.settleForVisibility(operation, record, target)
	engine.transcripts = append(engine.transcripts, settled.transcript)

	if settled.visibleA && settled.visibleB {
		cmp := Comparison{Method: operation.Method, Path: operation.Path, Case: settleCollectionCase, OperationID: operation.OperationID, ExactStatus: engine.options.ExactStatus}
		outcome := CompareResults(cmp, settled.transcript.B, settled.transcript.A)
		engine.suppressed.add(outcome.Suppressed)
		return outcome.Findings
	}
	if !settled.visibleA && !settled.visibleB {
		engine.progress("note %s %s: created entity not visible in either list after %s\n", operation.Method, operation.Path, settled.waited)
		return nil
	}
	return []Finding{{
		Kind:        FindingMutationNotVisible,
		Method:      operation.Method,
		Path:        operation.Path,
		Case:        settleCollectionCase,
		OperationID: operation.OperationID,
		Fields: map[string][2]any{
			"status":   {settled.transcript.B.Status, settled.transcript.A.Status},
			"visible":  {settled.visibleB, settled.visibleA},
			"waitedMs": {settled.waited.Milliseconds(), settled.waited.Milliseconds()},
		},
		Reason: "waited " + settled.waited.String() + " for the created entity to appear in both lists",
	}}
}

// ownerTarget resolves one operation's request target per side with the owner
// credentials, or reports that a parameter could not be resolved.
func (engine *probeEngine) ownerTarget(operation Operation) (probeTarget, bool) {
	paramsA, unresolvedA := resolveParams(operation, engine.symbolsA, false)
	paramsB, unresolvedB := resolveParams(operation, engine.symbolsB, false)
	if unresolvedA != "" || unresolvedB != "" {
		return probeTarget{}, false
	}
	pathA, pathB := operation.SidePaths()
	return probeTarget{
		pathA:   substitutePath(pathA, paramsA.pathValues),
		pathB:   substitutePath(pathB, paramsB.pathValues),
		queryA:  paramsA.query,
		queryB:  paramsB.query,
		headers: authHeaders(operation, engine.options.Schemes, engine.options.Keys),
	}, true
}

// settleOutcome is one visibility wait's result: the last transcript, what
// each side showed, and how long the wait took.
type settleOutcome struct {
	transcript Transcript
	visibleA   bool
	visibleB   bool
	attempts   int
	waited     time.Duration
}

// settleForVisibility re-reads the collection until the created entity is
// visible on BOTH sides or the settle deadline passes. A projection or queue
// that has not run yet is a wait, not a difference; the deadline is what
// turns "not yet" into a finding, and both the progress line and the finding
// name what was waited for. There is no fixed sleep anywhere in this path.
//
// Two deadlines, because they answer different questions. One side visible
// and the other not is exactly the lag worth waiting out, so it gets the
// whole settle timeout. NEITHER side visible is usually a collection this
// creation does not populate at all, and paying the full timeout for every
// one of those costs minutes a run, so it gets the shorter first-sight
// budget.
func (engine *probeEngine) settleForVisibility(operation Operation, record mutationRecord, target probeTarget) settleOutcome {
	timeout := engine.settleTimeout()
	started := time.Now()
	deadline := started.Add(timeout)
	firstSight := started.Add(firstSightBudget(timeout))
	outcome := settleOutcome{}
	for {
		outcome.attempts++
		outcome.transcript = engine.runCase(operation, probeCase{name: settleCollectionCase}, target)
		outcome.visibleA = containsID(outcome.transcript.A.Body, record.idA)
		outcome.visibleB = containsID(outcome.transcript.B.Body, record.idB)
		outcome.waited = time.Since(started)
		if outcome.visibleA && outcome.visibleB {
			return outcome
		}
		if outcome.expired(deadline, firstSight) {
			engine.progress("settle %s %s: gave up after %s / %d reads waiting for the created entity in both lists (candidate=%v base=%v)\n",
				operation.Method, operation.Path, outcome.waited, outcome.attempts, outcome.visibleA, outcome.visibleB)
			return outcome
		}
		select {
		case <-engine.ctx.Done():
			return outcome
		case <-time.After(settlePollInterval):
		}
	}
}

// expired reports whether this wait is over: the full deadline always, and
// the shorter first-sight budget when neither side has shown the entity.
func (outcome settleOutcome) expired(deadline, firstSight time.Time) bool {
	now := time.Now()
	if now.After(deadline) {
		return true
	}
	return !outcome.visibleA && !outcome.visibleB && now.After(firstSight)
}

// firstSightBudget is how long a creation nothing has listed yet is waited
// for before the collection is called uncovered.
func firstSightBudget(timeout time.Duration) time.Duration {
	budget := timeout / 4
	if budget < settlePollInterval {
		return settlePollInterval
	}
	return budget
}

// settleTimeout is the visibility deadline; a negative -settle-timeout turns
// the wait off (one read, no polling).
func (engine *probeEngine) settleTimeout() time.Duration {
	if engine.options.SettleTimeout != 0 {
		if engine.options.SettleTimeout < 0 {
			return 0
		}
		return engine.options.SettleTimeout
	}
	return defaultSettleTimeout
}

// permissionProbes repeats every project-key read with the sibling-project
// (B) and foreign-org (C) keys, comparing denial behavior across sides. An
// operation that already reported a status difference is skipped: replaying
// it with two foreign keys re-reports the same root cause twice more.
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
		if engine.statusDiffs[operationKeyOf(operation)] {
			engine.progress("skip permission pass %s %s (already differs on the owner key)\n", operation.Method, operation.Path)
			continue
		}
		findings = append(findings, engine.permissionProbe(operation)...)
	}
	return findings
}

// foreignKey is one non-owner credential and the identities that credential
// legitimately owns — its own project, and the organization and team it sits
// in. Seeing one of those is that key reading its own scope, not a leak.
type foreignKey struct {
	label string
	key   string
	scope map[string]bool
}

func (engine *probeEngine) foreignKeys() []foreignKey {
	return []foreignKey{
		{label: "key-b", key: engine.options.Keys.ProjectKeyB, scope: map[string]bool{
			fixtureProjectBID: true, "local-dev-organization": true, "local-dev-team": true,
		}},
		{label: "key-c", key: engine.options.Keys.ProjectKeyC, scope: map[string]bool{
			fixtureProjectCID: true, fixtureOrg2ID: true, fixtureTeam2ID: true,
		}},
	}
}

// permissionProbe runs one operation's read with both foreign keys and
// classifies each answer against what the OWNER key saw on this same
// operation.
func (engine *probeEngine) permissionProbe(operation Operation) []Finding {
	paramsA, unresolvedA := resolveParams(operation, engine.symbolsA, false)
	paramsB, unresolvedB := resolveParams(operation, engine.symbolsB, false)
	if unresolvedA != "" || unresolvedB != "" {
		return nil
	}
	pathA, pathB := operation.SidePaths()
	target := probeTarget{
		pathA:  substitutePath(pathA, paramsA.pathValues),
		pathB:  substitutePath(pathB, paramsB.pathValues),
		queryA: paramsA.query,
		queryB: paramsB.query,
	}

	keys := engine.foreignKeys()
	transcripts := make([]Transcript, 0, len(keys))
	for _, foreign := range keys {
		headers, ok := foreignProjectHeaders(operation, engine.options.Schemes, foreign.key)
		if !ok {
			engine.progress("skip permission pass %s %s (a non-project credential cannot be swapped for a foreign one)\n", operation.Method, operation.Path)
			return nil
		}
		target.headers = headers
		transcript := engine.runCase(operation, probeCase{name: "permission-" + foreign.label}, target)
		engine.transcripts = append(engine.transcripts, transcript)
		transcripts = append(transcripts, transcript)
	}

	findings := make([]Finding, 0)
	for index, foreign := range keys {
		findings = append(findings, engine.classifyPermission(operation, foreign, transcripts[index])...)
	}
	return findings
}

// classifyPermission reports a leak (an owner-only ID reached a foreign key)
// or a denial-class disagreement between the sides.
func (engine *probeEngine) classifyPermission(operation Operation, foreign foreignKey, transcript Transcript) []Finding {
	owner := engine.ownerIDs[operationKeyOf(operation)]
	leakedA, okA := leakedID(ownerSet(owner, true), transcript.A, foreign.scope)
	leakedB, okB := leakedID(ownerSet(owner, false), transcript.B, foreign.scope)
	if okA || okB {
		return []Finding{{
			Kind:        FindingPermissionLeak,
			Method:      operation.Method,
			Path:        operation.Path,
			Case:        "permission-" + foreign.label,
			OperationID: operation.OperationID,
			Fields: map[string][2]any{
				"key":    {foreign.label, foreign.label},
				"status": {transcript.B.Status, transcript.A.Status},
				"id":     {leakedB, leakedA},
			},
		}}
	}
	if statusClass(transcript.A.Status) != statusClass(transcript.B.Status) {
		return []Finding{{
			Kind:        FindingPermissionDiff,
			Method:      operation.Method,
			Path:        operation.Path,
			Case:        "permission-" + foreign.label,
			OperationID: operation.OperationID,
			Fields: map[string][2]any{
				"key":    {foreign.label, foreign.label},
				"status": {transcript.B.Status, transcript.A.Status},
			},
		}}
	}
	return nil
}

func ownerSet(owner *sideIDs, sideA bool) map[string]bool {
	if owner == nil {
		return nil
	}
	if sideA {
		return owner.a
	}
	return owner.b
}

// leakedID names the first owner-scoped ID a foreign key saw, and is what
// the finding records — a leak nobody can adjudicate from the report is a
// puzzle, not a finding. The candidate set is the IDs the OWNER key saw on
// THIS operation, not every ID the run ever captured, minus the identities
// the foreign key legitimately owns (its own project, and the organization
// and team it sits in — shared and cascading scope is not a leak).
//
// One class survives this rule: an endpoint that serves the same
// instance-wide document to every key (model defaults, providers) is
// indistinguishable, from its responses alone, from one that leaks to every
// key. Those are reported, and the recorded ID is what tells them apart on
// sight.
func leakedID(ownerIDs map[string]bool, foreign SideResult, scope map[string]bool) (string, bool) {
	if foreign.Status < 200 || foreign.Status >= 300 || len(ownerIDs) == 0 {
		return "", false
	}
	candidates := make([]string, 0, len(ownerIDs))
	for id := range ownerIDs {
		candidates = append(candidates, id)
	}
	sort.Strings(candidates)
	for _, id := range candidates {
		if scope[id] || !containsID(foreign.Body, id) {
			continue
		}
		return id, true
	}
	return "", false
}

// foreignProjectHeaders builds the header set for a foreign-key probe from
// scratch: the project-key header carries the foreign key and NOTHING else is
// sent. An operation that also admits an organization bearer or an admin key
// cannot be probed this way — keeping the owner's second credential would
// make a legitimate success read as a leak — so it is skipped instead.
func foreignProjectHeaders(operation Operation, schemes map[string]map[string]any, foreignKeyValue string) (map[string]string, bool) {
	headers := map[string]string{}
	for _, name := range operation.Security {
		cred := schemeHeader(name, schemes[name], Keys{ProjectKey: foreignKeyValue})
		if cred.header == "X-Auth-Token" {
			headers[cred.header] = foreignKeyValue
			continue
		}
		if schemeAdmitsNonProjectCredential(name, schemes[name]) {
			return nil, false
		}
	}
	return headers, len(headers) > 0
}

// schemeAdmitsNonProjectCredential reports whether a security scheme names a
// credential other than the project key.
func schemeAdmitsNonProjectCredential(name string, scheme map[string]any) bool {
	probe := schemeHeader(name, scheme, Keys{ProjectKey: "p", OrgKey: "o", AdminKey: "a", ScimKey: "s"})
	return probe.header != "" && probe.header != "X-Auth-Token"
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
