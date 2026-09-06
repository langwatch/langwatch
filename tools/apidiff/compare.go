package apidiff

import (
	"encoding/json"
	"reflect"
	"sort"
	"strconv"
	"strings"
)

// Finding kinds.
const (
	FindingStatusDiff         = "status_diff"
	FindingBodyShapeDiff      = "body_shape_diff"
	FindingBodyValueDiff      = "body_value_diff"
	FindingErrorShapeDiff     = "error_shape_diff"
	FindingOperationMissing   = "operation_missing"
	FindingPermissionDiff     = "permission_diff"
	FindingPermissionLeak     = "permission_leak"
	FindingMutationNotVisible = "mutation_not_visible"
	FindingUnverifiedShape    = "unverified_shape"
	FindingProbeFailed        = "probe_failed"
	FindingSkipped            = "skipped"
)

// Finding is one behavioral difference, in the spirit of
// openapidiff.Change: Fields carries explicit before/after values per changed
// field, where "before" is side B (base) and "after" is side A (candidate).
type Finding struct {
	Kind        string            `json:"kind"`
	Method      string            `json:"method"`
	Path        string            `json:"path"`
	Case        string            `json:"case,omitempty"`
	OperationID string            `json:"operationId,omitempty"`
	Fields      map[string][2]any `json:"fields,omitempty"`
	Reason      string            `json:"reason,omitempty"`
}

// Comparison carries one probe case's identity through the comparison
// helpers, so each finding is attributed without threading four parameters.
// ExactStatus enables the strict mode (-exact-status): exact status codes and
// error bodies are compared too.
type Comparison struct {
	Method      string
	Path        string
	Case        string
	OperationID string
	ExactStatus bool
}

func (cmp Comparison) finding(kind string, fields map[string][2]any) Finding {
	return Finding{Kind: kind, Method: cmp.Method, Path: cmp.Path, Case: cmp.Case, OperationID: cmp.OperationID, Fields: fields}
}

// statusClass buckets a status code for coarse comparison.
func statusClass(status int) string {
	switch {
	case status >= 200 && status < 300:
		return "success"
	case status >= 300 && status < 400:
		return "redirect"
	case status >= 400 && status < 500:
		return "client-error"
	case status >= 500 && status < 600:
		return "server-error"
	default:
		return "other"
	}
}

// ComparisonOutcome is one probe case's findings plus the count of
// comparisons the default semantics suppressed.
type ComparisonOutcome struct {
	Findings   []Finding
	Suppressed SuppressedCounts
}

// CompareResults compares one probe case's per-side outcomes. before is side
// B (base), after is side A (candidate). Default semantics: status CLASSES
// are compared (exact same-class differences like 400 vs 422 are suppressed —
// the error envelope is handlederror's domain), and error bodies are never
// compared; success bodies get full shape and value comparison.
func CompareResults(cmp Comparison, before, after SideResult) ComparisonOutcome {
	if before.Error != "" || after.Error != "" {
		return ComparisonOutcome{Findings: []Finding{cmp.finding(FindingProbeFailed, map[string][2]any{
			"error": {before.Error, after.Error},
		})}}
	}

	outcome := ComparisonOutcome{}
	if finding, suppressed, ok := cmp.compareStatus(before, after); ok {
		outcome.Findings = append(outcome.Findings, finding)
	} else if suppressed {
		outcome.Suppressed.SameClassStatus++
	}
	bodyFindings, errorBodySuppressed := cmp.compareBodies(before, after)
	outcome.Findings = append(outcome.Findings, bodyFindings...)
	if errorBodySuppressed {
		outcome.Suppressed.ErrorBody++
	}
	return outcome
}

// compareStatus reports a status_diff when the status CLASSES differ
// (success↔error flips, 5xx regressions). Exact-code differences within a
// class are suppressed unless ExactStatus is set.
func (cmp Comparison) compareStatus(before, after SideResult) (Finding, bool, bool) {
	beforeClass, afterClass := statusClass(before.Status), statusClass(after.Status)
	if beforeClass != afterClass {
		return cmp.finding(FindingStatusDiff, map[string][2]any{
			"status": {before.Status, after.Status},
			"class":  {beforeClass, afterClass},
		}), false, true
	}
	if before.Status != after.Status {
		if cmp.ExactStatus {
			return cmp.finding(FindingStatusDiff, map[string][2]any{
				"status": {before.Status, after.Status},
			}), false, true
		}
		return Finding{}, true, false
	}
	return Finding{}, false, false
}

// compareBodies compares bodies only when both sides succeeded (or the run is
// in ExactStatus mode). When both sides errored, the comparison is skipped
// and reported as suppressed; a one-sided error is already covered by the
// status_diff finding.
func (cmp Comparison) compareBodies(before, after SideResult) ([]Finding, bool) {
	if before.Status >= 400 || after.Status >= 400 {
		bothErrored := before.Status >= 400 && after.Status >= 400
		if !cmp.ExactStatus {
			return nil, bothErrored
		}
	}
	beforeBody, beforeOK := decodeJSONBody(before.Body)
	afterBody, afterOK := decodeJSONBody(after.Body)
	if !beforeOK || !afterOK {
		return cmp.compareRawBodies(before, after, beforeOK == afterOK), false
	}
	bothErrored := before.Status >= 400 && after.Status >= 400
	return cmp.compareJSONBodies(beforeBody, afterBody, bothErrored), false
}

// compareJSONBodies compares two decoded JSON bodies by shape, then by
// masked values.
func (cmp Comparison) compareJSONBodies(beforeBody, afterBody any, bothErrored bool) []Finding {
	beforeShape, afterShape := ShapeOf(beforeBody), ShapeOf(afterBody)
	if beforeShape.Signature() != afterShape.Signature() {
		kind := FindingBodyShapeDiff
		if bothErrored {
			kind = FindingErrorShapeDiff
		}
		return []Finding{cmp.finding(kind, map[string][2]any{
			"shape": {beforeShape.Signature(), afterShape.Signature()},
		})}
	}

	if fields := valueDiffFields(MaskValue(beforeBody), MaskValue(afterBody)); len(fields) > 0 {
		return []Finding{cmp.finding(FindingBodyValueDiff, fields)}
	}
	return nil
}

// compareRawBodies handles non-JSON bodies: there is no shape to reduce, so
// raw text compares directly.
func (cmp Comparison) compareRawBodies(before, after SideResult, sameKind bool) []Finding {
	if sameKind && before.Body == after.Body {
		return nil
	}
	if !sameKind {
		return []Finding{cmp.finding(FindingBodyShapeDiff, map[string][2]any{
			"content": {"non-JSON", "JSON"},
		})}
	}
	return []Finding{cmp.finding(FindingBodyValueDiff, map[string][2]any{
		"body": {truncateForFinding(before.Body), truncateForFinding(after.Body)},
	})}
}

// valueDiffFields walks both masked trees in lockstep and collects one
// before/after entry per differing leaf. Shapes are already known equal, so
// only exact values are compared here.
func valueDiffFields(before, after any) map[string][2]any {
	walker := &diffWalker{fields: map[string][2]any{}}
	walker.walk("", before, after)
	return walker.fields
}

type diffWalker struct {
	fields map[string][2]any
}

func (walker *diffWalker) walk(path string, left, right any) {
	switch typedLeft := left.(type) {
	case map[string]any:
		walker.walkObject(path, typedLeft, right)
	case []any:
		walker.walkArray(path, typedLeft, right)
	default:
		if !reflect.DeepEqual(left, right) {
			walker.fields[path] = [2]any{left, right}
		}
	}
}

func (walker *diffWalker) walkObject(path string, left map[string]any, right any) {
	typedRight, ok := right.(map[string]any)
	if !ok {
		walker.fields[path] = [2]any{left, right}
		return
	}
	keys := map[string]bool{}
	for key := range left {
		keys[key] = true
	}
	for key := range typedRight {
		keys[key] = true
	}
	sorted := make([]string, 0, len(keys))
	for key := range keys {
		sorted = append(sorted, key)
	}
	sort.Strings(sorted)
	for _, key := range sorted {
		walker.walk(path+"/"+escapeSegment(key), left[key], typedRight[key])
	}
}

func (walker *diffWalker) walkArray(path string, left []any, right any) {
	typedRight, ok := right.([]any)
	if !ok || len(typedRight) != len(left) {
		walker.fields[path] = [2]any{left, right}
		return
	}
	for index := range left {
		walker.walk(path+"/"+strconv.Itoa(index), left[index], typedRight[index])
	}
}

// decodeJSONBody parses a captured response body. A second pass with
// json.Number keeps large integers exact for value comparison.
func decodeJSONBody(body string) (any, bool) {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return nil, true
	}
	var value any
	decoder := json.NewDecoder(strings.NewReader(trimmed))
	decoder.UseNumber()
	if err := decoder.Decode(&value); err != nil {
		return nil, false
	}
	return value, true
}

func escapeSegment(segment string) string {
	segment = strings.ReplaceAll(segment, "~", "~0")
	return strings.ReplaceAll(segment, "/", "~1")
}

func truncateForFinding(body string) string {
	const bodyCap = 256
	if len(body) <= bodyCap {
		return body
	}
	return body[:bodyCap] + "…"
}
