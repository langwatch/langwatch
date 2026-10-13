package targets

import (
	"encoding/base64"
	"sort"
	"strings"
)

// orderedHeaders is a header object that keeps insertion order, like the
// plain object the Node child builds its request headers in.
type orderedHeaders struct {
	keys   []string
	values map[string]string
}

func newOrderedHeaders() *orderedHeaders { return &orderedHeaders{values: map[string]string{}} }

func (h *orderedHeaders) set(key, value string) {
	if _, ok := h.values[key]; !ok {
		h.keys = append(h.keys, key)
	}
	h.values[key] = value
}

func (h *orderedHeaders) hasFold(key string) bool {
	for _, k := range h.keys {
		if strings.EqualFold(k, key) {
			return true
		}
	}
	return false
}

// Map returns the headers as a map.
func (h *orderedHeaders) Map() map[string]string {
	out := make(map[string]string, len(h.keys))
	for _, k := range h.keys {
		out[k] = h.values[k]
	}
	return out
}

func sortedKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// authHeaders are the headers an auth config adds (http-auth.rules.ts).
func authHeaders(auth *AuthConfig) map[string]string {
	if auth == nil {
		return nil
	}
	switch auth.Type {
	case "bearer":
		return map[string]string{"Authorization": "Bearer " + auth.Token}
	case "api_key":
		return map[string]string{auth.Header: auth.Value}
	case "basic":
		password := ""
		if auth.Password != nil {
			password = *auth.Password
		}
		token := base64.StdEncoding.EncodeToString([]byte(auth.Username + ":" + password))
		return map[string]string{"Authorization": "Basic " + token}
	}
	return nil
}

// sensitiveHeaders are masked by name in logs.
var sensitiveHeaders = map[string]bool{"authorization": true, "x-api-key": true}

// redactHeaders masks credential headers by name.
func redactHeaders(headers map[string]string) map[string]string {
	out := make(map[string]string, len(headers))
	for k, v := range headers {
		if sensitiveHeaders[strings.ToLower(k)] {
			v = "[REDACTED]"
		}
		out[k] = v
	}
	return out
}
