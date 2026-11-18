package a2aproxy

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
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
// before it reaches the upstream.
func restMethod(httpMethod, rest string) (string, bool) {
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
		return taskMethod(httpMethod, task)
	}
	return fmt.Sprintf("%s %s", httpMethod, rest), false
}

// taskMethod maps the part after /tasks/ to its A2A method name.
func taskMethod(httpMethod, task string) (string, bool) {
	id, sub, hasSub := strings.Cut(task, "/")
	id, verb, hasVerb := strings.Cut(id, ":")
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
	if q := strings.Trim(baseQuery+"&"+query, "&"); q != "" {
		out += "?" + q
	}
	return out
}
