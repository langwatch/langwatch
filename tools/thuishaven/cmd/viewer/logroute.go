package viewer

import (
	"encoding/json"
	"strings"
)

// A lane is not an application. Locally the api lane runs the api and the
// worker in one process and the go lane runs the gateway and the NLP engine in
// one, so a tab per lane answers "which process wrote this" when the question a
// person actually has is "which application wrote this". The structured line
// already says which one. This is that rule, in one place: `haven logs` reads
// it through RouteLine too, so a tab and a filtered command never disagree
// about which application a line came from.

// LogApps are the log tab's sub-tabs, in order. "all" is always present; the
// rest appear once their application has written a line.
var LogApps = []string{
	"all", "ui", "api", "worker", "gateway", "nlp", "langy",
	"idp", "mail", "design-system", "mail-room", "tasks", "obs",
}

// AllApps is the sub-tab holding every application's lines interleaved.
const AllApps = "all"

// laneDefaults is the application a lane's line belongs to when the line itself
// does not say. For a lane hosting one application it is that application; for
// the two that host a pair it is the one a person means by the lane's name  -
// the front door, whose absence is what they would notice.
var laneDefaults = map[string]string{
	"app": "ui",
	"api": "api", "go": "gateway", "ui": "ui", "langy": "langy",
	"langyagent": "langy", "idp": "idp", "design-system": "design-system",
	"mail-room": "mail-room", "tasks": "tasks", "obs": "obs",
	// Earlier lane names, still on disk in older captures.
	"backend": "api", "workers": "worker", "gateway": "gateway", "nlp": "nlp",
}

// LaneDefaultApp is the application a lane's unstructured output belongs to.
func LaneDefaultApp(lane string) string {
	if app, ok := laneDefaults[lane]; ok {
		return app
	}
	return lane
}

// ownerFields is the pair of keys a line names its writer with. A Node
// application's own records carry a logger `name`; the Go services carry a
// `service`. A Node *process* failure carries `service` too — the shared
// failure record (processFailureLine) has no logger to name — which is how a
// half that died before its first log line still says which half it was.
type ownerFields struct {
	Name    string `json:"name"`
	Service string `json:"service"`
}

// RouteLine resolves which application a captured line belongs to. previous is
// the application the last structured line on this lane resolved to, which is
// what an unstructured line - a stack frame, a tool banner - follows: those
// lines are continuations of the record above them, and filing them under the
// lane's default would tear a stack trace off its own error.
func RouteLine(lane, text, previous string) string {
	if app, ok := structuredApp(lane, text); ok {
		return app
	}
	if previous != "" {
		return previous
	}
	return LaneDefaultApp(lane)
}

// structuredApp reads a structured line's own claim about which application
// wrote it. ok is false for a line that is not structured, or that names
// nothing this lane splits on.
func structuredApp(lane, text string) (string, bool) {
	trimmed := strings.TrimSpace(text)
	if !strings.HasPrefix(trimmed, "{") {
		return "", false
	}
	var fields ownerFields
	if json.Unmarshal([]byte(trimmed), &fields) != nil {
		return "", false
	}
	if app, ok := appFromLoggerName(fields.Name); ok {
		return app, true
	}
	if app, ok := appFromServiceName(fields.Service); ok {
		return app, true
	}
	return LaneDefaultApp(lane), fields.Name != "" || fields.Service != ""
}

// appFromLoggerName reads the Node applications' logger namespace. The
// namespace is hierarchical ("langwatch:worker:clickhouse"), so the first two
// segments are the application and everything past them is its own business.
func appFromLoggerName(name string) (string, bool) {
	switch {
	case name == "":
		return "", false
	case strings.HasPrefix(name, "langwatch:worker"):
		return "worker", true
	case strings.HasPrefix(name, "langwatch:api"), strings.HasPrefix(name, "langwatch-api"):
		return "api", true
	}
	return "", false
}

// appFromServiceName reads a service identity: the Go services' OpenTelemetry
// name, or the process name a Node half's failure record carries. The two Node
// halves are matched exactly — a substring test would read "langwatch-backend",
// the launcher hosting both, as one of them.
func appFromServiceName(service string) (string, bool) {
	switch {
	case service == "":
		return "", false
	case service == "langwatch-worker":
		return "worker", true
	case service == "langwatch-api":
		return "api", true
	case strings.Contains(service, "nlpgo"), strings.Contains(service, "-nlp"):
		return "nlp", true
	case strings.Contains(service, "aigateway"), strings.Contains(service, "gateway"):
		return "gateway", true
	case strings.Contains(service, "langyagent"):
		return "langy", true
	}
	return "", false
}
