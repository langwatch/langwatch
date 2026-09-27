package apidiff

import (
	"fmt"
	"path"
	"regexp"
	"sort"
	"strings"
)

// Reasons for the triaged body differences below. Each cites where the triage lives.
const (
	rulingScoreOptions  = "main writes {} itself on its tRPC create and update (routers/annotation.ts:552, :632); the branch normalises REST rows alike (r43 triage)"
	rulingMappings      = "main's tRPC path writes the canonical empty mappings (coerceMonitorMappings, routers/monitors.ts:243); the branch applies it to REST creates too (r43 triage)"
	rulingCheckup       = "checkup answers verdicts only: detail, code, fix, docsPath and the install usageReport are not branch wire (Alex, 2026-09-26)"
	rulingRolesSuperset = "the branch permission catalog is a strict superset: manageExperiments on every resource and the featureFlags resource (r43 triage)"
	rulingFacetCounts   = "facet item counts follow each side's seeded volume; keys and types agree (r43 triage)"
	rulingSeedValue     = "seed value: each side seeds its own admin email, invite code and expiry, database name, api-key role ids and descriptions (r43 triage)"
	rulingTiming        = "timing: fold, run and delivery clocks differ per side (r43 triage)"
	rulingRecordFields  = "branch superset: a created dataset record also carries datasetId, projectId and updatedAt (r49 triage)"
	rulingTestFireError = "deliberate: a test fire the receiver refused also carries error beside response_body (r43 triage)"
)

// probeRuling rules one triaged body difference. It is keyed by operation, JSON
// pointer and the change seen there, never a whole operation, so a new
// difference on the same operation still reports. In a pointer "*" is any one
// segment and a trailing "/**" the whole subtree; change globs one delta's change.
type probeRuling struct {
	operation string
	pointer   string
	change    string
	values    *regexp.Regexp
	reason    string
}

var (
	seededAdminEmail  = regexp.MustCompile(`^admin@(haven|mail\.langwatch)\.localhost$`)
	apidiffDatabase   = regexp.MustCompile(`apidiff_apidiff_run\d+_(main|branch)`)
	apiKeyRoleName    = regexp.MustCompile(`^apikey:`)
	seededKeyNote     = regexp.MustCompile(`^Static local-dev .* seeded by `)
	anyInstant        = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$`)
	inviteCodeOrMask  = regexp.MustCompile(`^([A-Za-z0-9_-]{16,}|<masked:string>)$`)
	inviteAcceptURL   = regexp.MustCompile(`^http://localhost:\d+/invite/accept\?inviteCode=`)
	nonNegativeNumber = regexp.MustCompile(`^\d+(\.\d+)?$`)
)

var probeRulings = []probeRuling{
	{operation: "GET /api/annotations", pointer: "/data/*/scoreOptions", change: "null->object", reason: rulingScoreOptions},
	{operation: "GET /api/annotations/trace/{id}", pointer: "/data/*/scoreOptions", change: "null->object", reason: rulingScoreOptions},
	{operation: "POST /api/annotations/trace/{id}", pointer: "/data/scoreOptions", change: "null->object", reason: rulingScoreOptions},
	{operation: "GET /api/annotations/{id}", pointer: "/data/scoreOptions", change: "null->object", reason: rulingScoreOptions},
	{operation: "PATCH /api/annotations/{id}", pointer: "/data/scoreOptions", change: "null->object", reason: rulingScoreOptions},
	{operation: "GET /api/monitors", pointer: "/*/mappings", change: "null->object", reason: rulingMappings},
	{operation: "POST /api/monitors", pointer: "/mappings", change: "null->object", reason: rulingMappings},
	{operation: "GET /api/monitors/{id}", pointer: "/mappings", change: "null->object", reason: rulingMappings},
	{operation: "PATCH /api/monitors/{id}", pointer: "/mappings", change: "null->object", reason: rulingMappings},
	{operation: "GET /api/checkup", pointer: "/rows/*/verdict/*", change: "*->absent", reason: rulingCheckup},
	{operation: "GET /api/checkup", pointer: "/usageReport/**", change: "*", reason: rulingCheckup},
	{operation: "POST /api/checkup/run", pointer: "/rows/*/verdict/*", change: "*->absent", reason: rulingCheckup},
	{operation: "GET /api/roles/permissions", pointer: "/actions", change: "count:more", reason: rulingRolesSuperset},
	{operation: "GET /api/roles/permissions", pointer: "/resources", change: "count:more", reason: rulingRolesSuperset},
	{operation: "GET /api/roles/permissions", pointer: "/resources/*/actions", change: "count:more", reason: rulingRolesSuperset},
	{operation: "GET /api/roles/permissions", pointer: "/resources/*/permissions", change: "count:more", reason: rulingRolesSuperset},
	{operation: "GET /api/traces/facets", pointer: "/facets/*/discrete/values", change: "count:*", reason: rulingFacetCounts},
	{operation: "GET /api/traces/facets", pointer: "/facets/*/topKeys", change: "count:*", reason: rulingFacetCounts},
	{operation: "GET /api/traces/facets", pointer: "/facets/*/topValues", change: "count:*", reason: rulingFacetCounts},
	{operation: "GET /api/organization/members", pointer: "/members/*/user/email", change: "value", values: seededAdminEmail, reason: rulingSeedValue},
	{operation: "GET /api/teams/{teamId}/members", pointer: "/data/*/email", change: "value", values: seededAdminEmail, reason: rulingSeedValue},
	{operation: "GET /api/scim/v2/Users", pointer: "/Resources/*/emails/*/value", change: "value", values: seededAdminEmail, reason: rulingSeedValue},
	{operation: "GET /api/scim/v2/Users", pointer: "/Resources/*/userName", change: "value", values: seededAdminEmail, reason: rulingSeedValue},
	{operation: "GET /api/scim/v2/Users/{id}", pointer: "/emails/*/value", change: "value", values: seededAdminEmail, reason: rulingSeedValue},
	{operation: "GET /api/scim/v2/Users/{id}", pointer: "/userName", change: "value", values: seededAdminEmail, reason: rulingSeedValue},
	{operation: "GET /api/organization/invites", pointer: "/invites/*/expiration", change: "value", values: anyInstant, reason: rulingSeedValue},
	{operation: "GET /api/organization/invites", pointer: "/invites/*/inviteCode", change: "value", values: inviteCodeOrMask, reason: rulingSeedValue},
	{operation: "GET /api/organization/invites", pointer: "/invites/*/inviteUrl", change: "value", values: inviteAcceptURL, reason: rulingSeedValue},
	{operation: "POST /api/organization/invites", pointer: "/invites/*/expiration", change: "value", values: anyInstant, reason: rulingSeedValue},
	{operation: "POST /api/organization/invites", pointer: "/invites/*/inviteCode", change: "value", values: inviteCodeOrMask, reason: rulingSeedValue},
	{operation: "POST /api/organization/invites", pointer: "/invites/*/inviteUrl", change: "value", values: inviteAcceptURL, reason: rulingSeedValue},
	{operation: "GET /api/role-bindings", pointer: "/bindings/*/customRoleName", change: "value", values: apiKeyRoleName, reason: rulingSeedValue},
	{operation: "GET /api/api-keys", pointer: "/data/*/description", change: "value", values: seededKeyNote, reason: rulingSeedValue},
	{operation: "GET /api/query/schema", pointer: "", change: "value", values: apidiffDatabase, reason: rulingSeedValue},
	{operation: "GET /api/query/reference", pointer: "", change: "value", values: apidiffDatabase, reason: rulingSeedValue},
	{operation: "GET /api/query/schema", pointer: "/database", change: "value", values: apidiffDatabase, reason: rulingSeedValue},
	{operation: "GET /api/query/reference", pointer: "/lwql/schema/database", change: "value", values: apidiffDatabase, reason: rulingSeedValue},
	{operation: "POST /api/dataset/{slugOrId}/records", pointer: "/data/*/datasetId", change: "absent->string", reason: rulingRecordFields},
	{operation: "POST /api/dataset/{slugOrId}/records", pointer: "/data/*/projectId", change: "absent->string", reason: rulingRecordFields},
	{operation: "POST /api/dataset/{slugOrId}/records", pointer: "/data/*/updatedAt", change: "absent->string", reason: rulingRecordFields},
	{operation: "POST /api/webhooks/v1/endpoints/{id}/test", pointer: "/data/error", change: "absent->string", reason: rulingTestFireError},
	{operation: "GET /api/simulation-runs/{scenarioRunId}", pointer: "/durationInMs", change: "value", values: nonNegativeNumber, reason: rulingTiming},
	{operation: "GET /api/simulation-runs", pointer: "/runs/*/results", change: "null->object", reason: rulingTiming},
	{operation: "GET /api/simulation-runs", pointer: "/runs/*/durationInMs", change: "value", values: nonNegativeNumber, reason: rulingTiming},
	{operation: "GET /api/webhooks/v1/endpoints", pointer: "/data/*/failing_since", change: "value", values: anyInstant, reason: rulingTiming},
	{operation: "GET /api/webhooks/v1/endpoints/{id}", pointer: "/data/failing_since", change: "value", values: anyInstant, reason: rulingTiming},
	{operation: "POST /api/webhooks/v1/endpoints/{id}/roll-secret", pointer: "/data/failing_since", change: "value", values: anyInstant, reason: rulingTiming},
	{operation: "GET /api/webhooks/v1/endpoints/{id}/health", pointer: "/data/failing_since", change: "value", values: anyInstant, reason: rulingTiming},
	{operation: "GET /api/webhooks/v1/endpoints/{id}/health", pointer: "/data/p95_latency_ms", change: "value", values: nonNegativeNumber, reason: rulingTiming},
	{operation: "GET /api/webhooks/v1/endpoints/{id}/deliveries", pointer: "/data/*/latency_ms", change: "value", values: nonNegativeNumber, reason: rulingTiming},
}

// bodyDelta is one difference at one JSON pointer: a kind change such as
// "null->object" or "absent->string", "count:more"/"count:fewer" for an array
// length, or "value" for a leaf. main and branch carry what each side showed.
type bodyDelta struct {
	pointer string
	change  string
	main    any
	branch  any
}

func (ruling probeRuling) matches(operation string, delta bodyDelta) bool {
	if ruling.operation != operation || !pointerMatches(ruling.pointer, delta.pointer) {
		return false
	}
	if changed, err := path.Match(ruling.change, delta.change); err != nil || !changed {
		return false
	}
	if ruling.values == nil {
		return true
	}
	return ruling.values.MatchString(fmt.Sprint(delta.main)) && ruling.values.MatchString(fmt.Sprint(delta.branch))
}

func pointerMatches(pattern, pointer string) bool {
	if subtree, ok := strings.CutSuffix(pattern, "/**"); ok {
		prefix := strings.Split(subtree, "/")
		segments := strings.Split(pointer, "/")
		return len(segments) > len(prefix) && segmentsMatch(prefix, segments[:len(prefix)])
	}
	return segmentsMatch(strings.Split(pattern, "/"), strings.Split(pointer, "/"))
}

func segmentsMatch(pattern, segments []string) bool {
	if len(pattern) != len(segments) {
		return false
	}
	for index, segment := range pattern {
		if segment != "*" && segment != segments[index] {
			return false
		}
	}
	return true
}

// rulingFor answers the reason ruling a delta, or "" when none does.
func rulingFor(operation string, delta bodyDelta) string {
	for _, ruling := range probeRulings {
		if ruling.matches(operation, delta) {
			return ruling.reason
		}
	}
	return ""
}

// ruleShape rules a success body's shape finding only when every delta
// between the two bodies is ruled; otherwise the finding stands whole.
func (cmp Comparison) ruleShape(finding Finding, beforeBody, afterBody any) []Finding {
	deltas := shapeDeltas(beforeBody, afterBody)
	operation := cmp.Method + " " + cmp.Path
	fields := map[string][2]any{}
	reasons := map[string]bool{}
	for _, delta := range deltas {
		reason := rulingFor(operation, delta)
		if reason == "" {
			return []Finding{finding}
		}
		reasons[reason] = true
		fields[delta.pointer] = [2]any{delta.main, delta.branch}
	}
	if len(deltas) == 0 {
		return []Finding{finding}
	}
	return []Finding{cmp.ruled(finding.Kind, fields, reasons)}
}

// ruleValues moves each ruled pointer of a value finding into a ruled
// finding; the unruled pointers stay a body_value_diff.
func (cmp Comparison) ruleValues(finding Finding) []Finding {
	operation := cmp.Method + " " + cmp.Path
	kept := map[string][2]any{}
	ruled := map[string][2]any{}
	reasons := map[string]bool{}
	for pointer, pair := range finding.Fields {
		reason := rulingFor(operation, bodyDelta{pointer: pointer, change: "value", main: pair[0], branch: pair[1]})
		if reason == "" {
			kept[pointer] = pair
			continue
		}
		ruled[pointer] = pair
		reasons[reason] = true
	}
	findings := []Finding{}
	if len(kept) > 0 {
		finding.Fields = kept
		findings = append(findings, finding)
	}
	if len(ruled) > 0 {
		findings = append(findings, cmp.ruled(FindingBodyValueDiff, ruled, reasons))
	}
	return findings
}

// ruleRaw rules two unparseable bodies that agree once a ruled seed value is
// masked, over their common length: both were cut at the capture cap, and a
// longer seed on one side moves where that side's cut falls.
func (cmp Comparison) ruleRaw(finding Finding, before, after string) []Finding {
	operation := cmp.Method + " " + cmp.Path
	for _, ruling := range probeRulings {
		if ruling.operation != operation || ruling.pointer != "" || ruling.values == nil {
			continue
		}
		masked := [2]string{ruling.values.ReplaceAllString(before, "<seed>"), ruling.values.ReplaceAllString(after, "<seed>")}
		common := min(len(masked[0]), len(masked[1]))
		bothCut := len(before) == bodyCaptureCap && len(after) == bodyCaptureCap
		if masked[0][:common] == masked[1][:common] && (len(masked[0]) == len(masked[1]) || bothCut) {
			return []Finding{cmp.ruled(finding.Kind, finding.Fields, map[string]bool{ruling.reason: true})}
		}
	}
	return []Finding{finding}
}

func (cmp Comparison) ruled(kind string, fields map[string][2]any, reasons map[string]bool) Finding {
	names := make([]string, 0, len(reasons))
	for reason := range reasons {
		names = append(names, reason)
	}
	sort.Strings(names)
	ruled := cmp.finding(FindingRuled, fields)
	ruled.Reason = kind + ": " + strings.Join(names, "; ")
	return ruled
}

// shapeDeltas lists where two decoded bodies differ in kind, key presence or
// array length. Array elements pair by index and report under "*".
func shapeDeltas(before, after any) []bodyDelta {
	walker := &deltaWalker{seen: map[string]bool{}}
	walker.walk("", before, after)
	sort.Slice(walker.deltas, func(i, j int) bool { return walker.deltas[i].pointer < walker.deltas[j].pointer })
	return walker.deltas
}

type deltaWalker struct {
	deltas []bodyDelta
	seen   map[string]bool
}

func (walker *deltaWalker) add(delta bodyDelta) {
	if key := delta.pointer + " " + delta.change; !walker.seen[key] {
		walker.seen[key] = true
		walker.deltas = append(walker.deltas, delta)
	}
}

func (walker *deltaWalker) walk(pointer string, before, after any) {
	beforeKind, afterKind := ShapeOf(before).Kind, ShapeOf(after).Kind
	if beforeKind != afterKind {
		walker.add(kindDelta(pointer, beforeKind, afterKind))
		return
	}
	switch typedBefore := before.(type) {
	case map[string]any:
		typedAfter, _ := after.(map[string]any)
		walker.walkObject(pointer, typedBefore, typedAfter)
	case []any:
		typedAfter, _ := after.([]any)
		if len(typedBefore) != len(typedAfter) {
			walker.add(bodyDelta{pointer: pointer, change: countChange(len(typedBefore), len(typedAfter)), main: len(typedBefore), branch: len(typedAfter)})
		}
		for index := range min(len(typedBefore), len(typedAfter)) {
			walker.walk(pointer+"/*", typedBefore[index], typedAfter[index])
		}
	}
}

func (walker *deltaWalker) walkObject(pointer string, before, after map[string]any) {
	for key, value := range before {
		if _, ok := after[key]; !ok {
			walker.add(kindDelta(pointer+"/"+escapeSegment(key), ShapeOf(value).Kind, "absent"))
		}
	}
	for key, value := range after {
		child := pointer + "/" + escapeSegment(key)
		if beforeValue, ok := before[key]; ok {
			walker.walk(child, beforeValue, value)
			continue
		}
		walker.add(kindDelta(child, "absent", ShapeOf(value).Kind))
	}
}

func kindDelta(pointer, main, branch string) bodyDelta {
	return bodyDelta{pointer: pointer, change: main + "->" + branch, main: main, branch: branch}
}

func countChange(before, after int) string {
	if after > before {
		return "count:more"
	}
	return "count:fewer"
}

// unruledFindings drops the ruled findings, which the ledger never counts.
func unruledFindings(findings []Finding) []Finding {
	kept := make([]Finding, 0, len(findings))
	for _, finding := range findings {
		if finding.Kind != FindingRuled {
			kept = append(kept, finding)
		}
	}
	return kept
}
