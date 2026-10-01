package fuzz

import (
	"context"
	"fmt"
	"net/url"
	"strings"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// builtRequest is one concrete HTTP request the fuzzer sends.
type builtRequest struct {
	method  string
	url     string
	headers map[string]string
	body    []byte
	foreign []string // the other tenant's ids the request addresses, for the cross-tenant oracle
}

// build turns a job into a concrete request: the path filled with ids, the
// query with valid values, the body synthesized then mutated, and the auth
// header for the credential. False means a foreign-id job found no real
// resource of another tenant to address, so it is not sent.
func (run *apiRun) build(ctx context.Context, item job) (builtRequest, bool) {
	path, foreign := run.fillPath(item), []string(nil)
	if item.mutation.Foreign {
		var ok bool
		if path, foreign, ok = run.foreignPath(ctx, item); !ok {
			return builtRequest{}, false
		}
	}
	query, ok := run.fillQuery(item)
	if !ok {
		return builtRequest{}, false
	}
	target := run.apiURL + path
	if query != "" {
		target += "?" + query
	}
	return builtRequest{method: item.op.Method, url: target, headers: run.authHeader(item.auth), body: run.buildBody(item), foreign: foreign}, true
}

func (run *apiRun) fillPath(item job) string {
	path := item.op.Path
	for _, param := range item.op.Params {
		if param.In != "path" {
			continue
		}
		value := run.idFor(param.Name, item.mutation)
		path = strings.ReplaceAll(path, "{"+param.Name+"}", url.PathEscape(value))
	}
	return path
}

func (run *apiRun) fillQuery(item job) (string, bool) {
	values := url.Values{}
	for _, param := range item.op.Params {
		if param.In != "query" || !param.Required {
			continue
		}
		if param.HasValue {
			values.Set(param.Name, fmt.Sprint(param.Example))
			continue
		}
		value := run.idFor(param.Name, item.mutation)
		if item.mutation.Foreign && value == syntheticID {
			return "", false
		}
		values.Set(param.Name, value)
	}
	return values.Encode(), true
}

// idFor picks a value for a path or id-shaped query parameter: the fuzzer's own
// ids by name, a foreign tenant's ids for the cross-tenant mutation, a bad
// value for the invalid-id mutation, else a synthesized value.
func (run *apiRun) idFor(name string, mutation Mutation) string {
	if mutation.InvalidID {
		return "fuzz-invalid-id"
	}
	lower := strings.ToLower(name)
	switch {
	case strings.Contains(lower, "project"):
		if mutation.Foreign {
			return diffkit.SeededProjectID
		}
		return first(run.org.Projects).ID
	case strings.Contains(lower, "organization") || lower == "orgid" || strings.Contains(lower, "org"):
		if mutation.Foreign {
			return diffkit.SeededOrganizationID
		}
		return run.org.OrgID
	case strings.Contains(lower, "team") && !mutation.Foreign:
		return run.org.TeamID
	default:
		return syntheticID
	}
}

// syntheticID fills an id the fuzzer has no real value for; the foreign-id
// mutation never sends it, since it would read nothing of anybody's.
const syntheticID = "fuzzer"

func (run *apiRun) buildBody(item job) []byte {
	if item.op.BodySchema == nil {
		return nil
	}
	valid := diffkit.SynthesizePayload(item.op.BodySchema, 0)
	return marshalBody(MutateBody(item.op.BodySchema, valid, item.mutation))
}

// authHeader is the credential permutation's header. Restricted and project use
// the project token header; org uses the bearer.
func (run *apiRun) authHeader(kind string) map[string]string {
	switch kind {
	case "project":
		return map[string]string{"X-Auth-Token": first(run.org.Projects).Key}
	case "org":
		return map[string]string{"Authorization": "Bearer " + run.org.OrgKey}
	case "restricted":
		if run.org.Restricted != "" {
			return map[string]string{"X-Auth-Token": run.org.Restricted}
		}
		return map[string]string{"X-Auth-Token": first(run.org.Projects).Key}
	default:
		return map[string]string{}
	}
}

// curlOf renders a request as a copy-pasteable curl line; the keys are the
// fuzzer's own throwaway keys, safe to print.
func curlOf(request builtRequest) string {
	var out strings.Builder
	fmt.Fprintf(&out, "curl -sk -X %s %q", request.method, request.url)
	for key, value := range request.headers {
		fmt.Fprintf(&out, " -H %q", key+": "+value)
	}
	if request.body != nil {
		fmt.Fprintf(&out, " -H %q --data %q", "Content-Type: application/json", string(request.body))
	}
	return out.String()
}
