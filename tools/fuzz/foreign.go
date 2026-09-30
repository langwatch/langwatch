package fuzz

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// foreignPath fills a foreign-id job's path with real ids of the seeded
// organisation, the other tenant: its project and organisation by name, every
// other id by listing that parameter's collection with the tenant's own keys.
// False when some id has no real resource behind it, so the job is not sent.
func (run *apiRun) foreignPath(ctx context.Context, item job) (string, []string, bool) {
	path, ids := item.op.Path, []string(nil)
	for _, param := range item.op.Params {
		if param.In != "path" {
			continue
		}
		value := run.idFor(param.Name, item.mutation)
		if value == syntheticID {
			value = run.foreignID(ctx, collectionOf(path, param.Name))
		}
		if value == "" {
			return "", nil, false
		}
		ids = append(ids, value)
		path = strings.ReplaceAll(path, "{"+param.Name+"}", url.PathEscape(value))
	}
	return path, ids, true
}

// collectionOf is the path up to a parameter's segment: /api/prompts/{id} ->
// /api/prompts. Empty when an earlier parameter is still unfilled.
func collectionOf(path, name string) string {
	at := strings.Index(path, "/{"+name+"}")
	if at <= 0 || strings.Contains(path[:at], "{") {
		return ""
	}
	return path[:at]
}

// foreignID lists a collection as the other tenant, once per collection, and
// returns the first id listed, or "" when it lists nothing.
func (run *apiRun) foreignID(ctx context.Context, collection string) string {
	if collection == "" {
		return ""
	}
	if cached, ok := run.foreign.Load(collection); ok {
		return cached.(string)
	}
	id := ""
	for _, headers := range []map[string]string{
		{"X-Auth-Token": diffkit.SeededProjectKey},
		{"Authorization": "Bearer " + diffkit.SeededOrgKey},
	} {
		status, _, body := run.do(ctx, builtRequest{method: http.MethodGet, url: run.apiURL + collection, headers: headers})
		if id = firstID(body); success(status) && id != "" {
			break
		}
		id = ""
	}
	run.foreign.Store(collection, id)
	return id
}

// firstID is the id of the first element of a list body: a bare array, or the
// first non-empty array field of a wrapper object (fields in sorted order).
func firstID(body []byte) string {
	var value any
	if json.Unmarshal(body, &value) != nil {
		return ""
	}
	if wrapper, ok := value.(map[string]any); ok {
		keys := make([]string, 0, len(wrapper))
		for key := range wrapper {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if id := firstID(mustJSON(wrapper[key])); id != "" {
				return id
			}
		}
		return ""
	}
	list, _ := value.([]any)
	if len(list) == 0 {
		return ""
	}
	element, _ := list[0].(map[string]any)
	id, _ := element["id"].(string)
	return id
}

func mustJSON(value any) []byte {
	if _, isList := value.([]any); !isList {
		return nil
	}
	encoded, _ := json.Marshal(value)
	return encoded
}
