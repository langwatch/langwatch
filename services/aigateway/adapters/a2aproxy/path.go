package a2aproxy

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

var errUnsafePath = errors.New("the A2A path is not allowed")

// splitPath reads /a2a/{target}{rest} from the request's escaped path. rest
// stays escaped, as the caller sent it, so it is appended to the upstream base
// unchanged. decoded is rest unescaped, for naming the A2A method. A segment
// that is a dot segment, or that decodes to a slash, backslash, ? or #, could
// leave the upstream base path or change its query, so it is refused.
func splitPath(r *http.Request) (name, rest, decoded string, err error) {
	rawName, rawRest, _ := strings.Cut(strings.TrimPrefix(r.URL.EscapedPath(), PathPrefix), "/")
	name, err = url.PathUnescape(rawName)
	if err != nil || name == "" || strings.ContainsAny(name, "/\\?#") || name == "." || name == ".." {
		return name, "", "", errUnsafePath
	}
	if rawRest == "" {
		return name, "", "", nil
	}
	segments := strings.Split(rawRest, "/")
	plain := make([]string, len(segments))
	for i, seg := range segments {
		p, err := url.PathUnescape(seg)
		if err != nil || p == "." || p == ".." || strings.ContainsAny(p, "/\\?#") || hasControl(p) {
			return name, "", "", errUnsafePath
		}
		plain[i] = p
	}
	return name, "/" + rawRest, "/" + strings.Join(plain, "/"), nil
}

func hasControl(s string) bool {
	for _, r := range s {
		if r < 0x20 || r == 0x7f {
			return true
		}
	}
	return false
}

// restMethod maps an HTTP+JSON method and path to its A2A method name, and
// reports whether the pair is an A2A operation. Anything else is refused
// before it reaches the upstream. escaped is rest as the caller sent it.
func restMethod(httpMethod, rest, escaped string) (string, bool) {
	get, post := httpMethod == http.MethodGet, httpMethod == http.MethodPost
	task, isTask := strings.CutPrefix(rest, "/tasks/")
	switch {
	case get && (rest == cardPath || rest == legacyCardPath):
		return "GetAgentCard", true
	case get && rest == "/extendedAgentCard":
		return "GetExtendedAgentCard", true
	case post && rest == "/message:send":
		return "SendMessage", true
	case post && rest == "/message:stream":
		return "SendStreamingMessage", true
	case get && rest == "/tasks":
		return "ListTasks", true
	case isTask:
		// Segments map one to one, so the escaped text after the first is the task's.
		_, escapedTask, _ := strings.Cut(strings.TrimPrefix(escaped, "/"), "/")
		return taskMethod(httpMethod, task, escapedTask)
	}
	return fmt.Sprintf("%s %s", httpMethod, rest), false
}

// taskMethod maps the part after /tasks/ to its A2A method name. The action
// suffix is read from the escaped id, so an escaped colon (team%3A42) stays
// part of the task id and only a literal one starts an action.
func taskMethod(httpMethod, task, escapedTask string) (string, bool) {
	_, sub, hasSub := strings.Cut(task, "/")
	escapedID, _, _ := strings.Cut(escapedTask, "/")
	id, verb, hasVerb := strings.Cut(escapedID, ":")
	if id == "" || (hasVerb && hasSub) {
		return httpMethod + " /tasks/" + task, false
	}
	switch {
	case hasVerb && !hasSub:
		return taskVerbMethod(httpMethod, verb)
	case !hasSub:
		return "GetTask", httpMethod == http.MethodGet
	}
	return pushConfigMethod(httpMethod, sub)
}

func taskVerbMethod(httpMethod, verb string) (string, bool) {
	switch {
	case verb == "cancel" && httpMethod == http.MethodPost:
		return "CancelTask", true
	case verb == "subscribe" && (httpMethod == http.MethodGet || httpMethod == http.MethodPost):
		return "SubscribeToTask", true
	}
	return httpMethod + " :" + verb, false
}

// pushConfigMethod maps /tasks/{id}/pushNotificationConfigs[/{configId}].
func pushConfigMethod(httpMethod, sub string) (string, bool) {
	config, hasConfig := strings.CutPrefix(sub, "pushNotificationConfigs/")
	switch {
	case sub == "pushNotificationConfigs" && httpMethod == http.MethodPost:
		return "CreateTaskPushNotificationConfig", true
	case sub == "pushNotificationConfigs" && httpMethod == http.MethodGet:
		return "ListTaskPushNotificationConfig", true
	case !hasConfig || config == "" || strings.Contains(config, "/"):
		return httpMethod + " " + sub, false
	case httpMethod == http.MethodGet:
		return "GetTaskPushNotificationConfig", true
	case httpMethod == http.MethodDelete:
		return "DeleteTaskPushNotificationConfig", true
	}
	return httpMethod + " " + sub, false
}

// jsonRPCMethods are the A2A JSON-RPC methods: the v1.0 names and the v0.3
// names. Any other method is refused before it reaches the upstream.
var jsonRPCMethods = map[string]bool{
	"SendMessage": true, "SendStreamingMessage": true, "GetTask": true, "ListTasks": true,
	"CancelTask": true, "SubscribeToTask": true, "CreateTaskPushNotificationConfig": true,
	"GetTaskPushNotificationConfig": true, "ListTaskPushNotificationConfig": true,
	"DeleteTaskPushNotificationConfig": true, "GetExtendedAgentCard": true,
	"message/send": true, "message/stream": true, "tasks/get": true, "tasks/list": true,
	"tasks/cancel": true, "tasks/resubscribe": true, "tasks/pushNotificationConfig/set": true,
	"tasks/pushNotificationConfig/get": true, "tasks/pushNotificationConfig/list": true,
	"tasks/pushNotificationConfig/delete": true, "agent/getAuthenticatedExtendedCard": true,
}

// upstreamEndpoint appends the escaped rest of the path to the upstream URL's
// path, keeping the upstream's own query and adding the caller's after it. With
// no rest (a root JSON-RPC call) the registered path stays as it is, slash included.
// A caller parameter the upstream URL already sets is dropped: the target's wins.
func upstreamEndpoint(base, rest, query string) string {
	base, _, _ = strings.Cut(base, "#")
	base, baseQuery, _ := strings.Cut(base, "?")
	out := base
	if rest != "" {
		out = strings.TrimSuffix(base, "/") + rest
	}
	if out == "" || !strings.Contains(strings.TrimPrefix(strings.TrimPrefix(out, "https://"), "http://"), "/") {
		out += "/"
	}
	if q := strings.Trim(baseQuery+"&"+callerQuery(baseQuery, query), "&"); q != "" {
		out += "?" + q
	}
	return out
}

// callerQuery is the caller's query without the parameters the target's own
// query sets. A piece whose names cannot be decoded is dropped too, and names
// are read across ";" as well as "&", the way some servers split them.
func callerQuery(targetQuery, query string) string {
	if targetQuery == "" || query == "" {
		return query
	}
	pinned := map[string]bool{}
	for _, piece := range strings.Split(targetQuery, "&") {
		names, _ := queryNames(piece)
		for _, name := range names {
			pinned[name] = true
		}
	}
	kept := make([]string, 0, strings.Count(query, "&")+1)
	for _, piece := range strings.Split(query, "&") {
		names, ok := queryNames(piece)
		if ok && !slices.ContainsFunc(names, func(name string) bool { return pinned[name] }) {
			kept = append(kept, piece)
		}
	}
	return strings.Join(kept, "&")
}

// queryNames decodes the parameter names in one "&" piece of a query.
func queryNames(piece string) ([]string, bool) {
	var names []string
	for _, part := range strings.Split(piece, ";") {
		name, _, _ := strings.Cut(part, "=")
		decoded, err := url.QueryUnescape(name)
		if err != nil {
			return nil, false
		}
		names = append(names, decoded)
	}
	return names, true
}
