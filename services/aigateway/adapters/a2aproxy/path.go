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

// restMethod maps an HTTP+JSON path to its A2A method name.
func restMethod(httpMethod, rest string) string {
	switch {
	case rest == cardPath:
		return "GetAgentCard"
	case rest == "/message:send":
		return "SendMessage"
	case rest == "/message:stream":
		return "SendStreamingMessage"
	case strings.HasPrefix(rest, "/tasks/") && strings.HasSuffix(rest, ":cancel"):
		return "CancelTask"
	case strings.HasPrefix(rest, "/tasks/") && strings.HasSuffix(rest, ":subscribe"):
		return "SubscribeToTask"
	case strings.HasPrefix(rest, "/tasks/") && httpMethod == http.MethodGet:
		return "GetTask"
	case rest == "/tasks" && httpMethod == http.MethodGet:
		return "ListTasks"
	}
	return fmt.Sprintf("%s %s", httpMethod, rest)
}
