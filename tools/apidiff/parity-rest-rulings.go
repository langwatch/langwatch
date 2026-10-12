package apidiff

import (
	"slices"
	"strings"
)

const (
	rulingConnectRedesign = "deliberate: the connect protocol was redesigned on the branch (r39 triage)"
	rulingFlattening      = "artifact: the branch documents a union main flattened; the wire shape matches (r39 triage)"
	rulingPhantomField    = "phantom: main documents a field its handler never answers or accepts (r39 triage)"
	rulingRootPrompts     = "documentation only: main's document published prompts at the root path"
	rulingInstanceToken   = "documentation correction: the wire still uses the instance token, as on main"
	rulingRetiredRoute    = "ruled retired: the operation's path is ruled out of the branch (RetiredRestOperation)"
)

// ruledSpecKindOnly rules one spec change kind on one operation, for a
// difference that is documentation only. It sits beside ruledBreakingRest
// because an operation may carry a kind ruling and a ruling of its own.
var ruledSpecKindOnly = map[string]map[string]string{
	"GET /":  {"removed": rulingRootPrompts},
	"POST /": {"removed": rulingRootPrompts},

	"POST /api/langy/control/connect/frames":   {"security_changed": rulingInstanceToken},
	"GET /api/langy/control/connect/poll":      {"security_changed": rulingInstanceToken},
	"POST /api/langy/control/connect/register": {"security_changed": rulingInstanceToken},
}

// ruledBreakingRest names the operations whose breaking rows were triaged
// and ruled not defects; they still render, under their ruling.
var ruledBreakingRest = map[string]string{
	"POST /api/agents/connect/frames":          rulingConnectRedesign,
	"GET /api/agents/connect/poll":             rulingConnectRedesign,
	"POST /api/agents/connect/register":        rulingConnectRedesign,
	"POST /api/langy/control/connect/frames":   rulingConnectRedesign,
	"GET /api/langy/control/connect/poll":      rulingConnectRedesign,
	"POST /api/langy/control/connect/register": rulingConnectRedesign,
	"GET /api/checkup":                         rulingFlattening,
	"POST /api/checkup/run":                    rulingFlattening,
	"GET /api/traces/facets":                   rulingFlattening,
	"GET /api/projects":                        rulingPhantomField,
	"POST /api/projects":                       rulingPhantomField,
	"GET /api/projects/{id}":                   rulingPhantomField,
	"PATCH /api/projects/{id}":                 rulingPhantomField,
	"GET /api/query/reference":                 rulingPhantomField,
	"GET /api/query/schema":                    rulingPhantomField,
	"POST /api/trace/search":                   rulingPhantomField,
	"GET /api/trace/{id}":                      rulingPhantomField,
	"POST /api/trace/{id}/unshare":             rulingPhantomField,
	"POST /api/evaluations/batch/log_results":  rulingPhantomField,
}

// rulingSpecKinds narrows a ruling to the spec change kinds it was given for:
// a ruled operation that later gains a different kind of change (a security
// change under a phantom-field ruling) is a new difference, not a ruled one.
// The connect ruling leaves security_changed counted: the agent-connect door
// is an open question (Q10), not a settled redesign.
var rulingSpecKinds = map[string][]string{
	rulingConnectRedesign: {"request_body_required_changed", "response_required_changed"},
	rulingFlattening:      {"response_required_changed"},
	rulingPhantomField:    {"response_property_removed", "response_type_changed", "request_type_changed"},
}

// ruledSpecChange answers the ruling that covers one spec change, or "". The
// operation is matched with its parameter names erased, so the ruling holds
// whichever side's spelling the diff reports.
func ruledSpecChange(method, path, kind string) string {
	field, found := strings.CutPrefix(kind, "operation_")
	if !found {
		return ""
	}
	if field == "removed" && RetiredRestOperation(path) {
		return rulingRetiredRoute
	}
	key := strings.ToUpper(method) + " " + path
	pairing := strings.ToUpper(method) + " " + PairingPath(path)
	ruling := ruledBreakingRest[key]
	if ruling == "" {
		ruling = ruledBreakingByPairing()[pairing]
	}
	if slices.Contains(rulingSpecKinds[ruling], field) {
		return ruling
	}
	if reason := ruledSpecKindOnly[key][field]; reason != "" {
		return reason
	}
	return ruledSpecKindByPairing()[pairing][field]
}

func ruledSpecKindByPairing() map[string]map[string]string {
	paired := make(map[string]map[string]string, len(ruledSpecKindOnly))
	for key, kinds := range ruledSpecKindOnly {
		method, path, _ := strings.Cut(key, " ")
		paired[method+" "+PairingPath(path)] = kinds
	}
	return paired
}

func ruledBreakingByPairing() map[string]string {
	paired := make(map[string]string, len(ruledBreakingRest))
	for key, ruling := range ruledBreakingRest {
		method, path, _ := strings.Cut(key, " ")
		paired[method+" "+PairingPath(path)] = ruling
	}
	return paired
}
