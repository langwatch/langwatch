package fuzz

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"time"
)

// LatencyCap is the default per-request latency oracle threshold.
const LatencyCap = 5 * time.Second

// Observation is what the oracles judge: one request and its response.
type Observation struct {
	Mutation     Mutation
	Status       int
	Elapsed      time.Duration
	Body         []byte
	JSONExpected bool // the operation documents an application/json 2xx response
	SeparateOrg  bool // the cross-tenant oracle only holds against a real other tenant
	LatencyCap   time.Duration
	ForeignIDs   []string // the other tenant's ids the request addressed
	OwnIDs       []string // the fuzzer's own project and organisation ids
}

// Hit is one oracle firing.
type Hit struct {
	Oracle  string
	Message string
}

// Evaluate applies every oracle to one observation and returns the hits, worst
// first. No AI: each oracle is a fixed rule.
func Evaluate(observation Observation) []Hit {
	cap := observation.LatencyCap
	if cap == 0 {
		cap = LatencyCap
	}
	hits := make([]Hit, 0)
	if observation.Status >= 500 {
		hits = append(hits, Hit{Oracle: "5xx", Message: fmt.Sprintf("server error %d: %s", observation.Status, excerpt(observation.Body))})
	}
	if observation.Mutation.SchemaInvalid && success(observation.Status) {
		hits = append(hits, Hit{Oracle: "accepting-forbidden", Message: fmt.Sprintf("%s body accepted with %d", observation.Mutation.Name, observation.Status)})
	}
	if observation.Mutation.Foreign && observation.SeparateOrg && success(observation.Status) && leaksForeign(observation.Body, observation.ForeignIDs, observation.OwnIDs) {
		hits = append(hits, Hit{Oracle: "cross-tenant", Message: fmt.Sprintf("another tenant's resource read with the fuzzer's key: %d", observation.Status)})
	}
	if observation.JSONExpected && success(observation.Status) && observation.Mutation.Name == "valid" && !json.Valid(observation.Body) && !eventFrame(observation.Body) {
		hits = append(hits, Hit{Oracle: "schema-mismatch", Message: "documented JSON response was not valid JSON"})
	}
	if observation.Elapsed > cap {
		hits = append(hits, Hit{Oracle: "latency", Message: fmt.Sprintf("%s over the %s cap", observation.Elapsed.Round(time.Millisecond), cap)})
	}
	return hits
}

// eventFrame is a server-sent event frame: a stream route answers one where JSON is not the
// wire (the device-login approval stream), so it is not a schema mismatch.
func eventFrame(body []byte) bool {
	frame := bytes.TrimSpace(body)
	return bytes.HasPrefix(frame, []byte("data:")) || bytes.HasPrefix(frame, []byte("event:")) || bytes.HasPrefix(frame, []byte(":"))
}

func success(status int) bool { return status >= 200 && status < 300 }

// leaksForeign is a 2xx body that names an id of the other tenant the request
// addressed and is not an empty list. ponytail: a leak that never echoes one of
// those ids is missed; tag seeded rows with a marker if that ever matters.
func leaksForeign(body []byte, foreignIDs, ownIDs []string) bool {
	if emptyList(body) || carriesOnlyOwnTenant(body, ownIDs) {
		return false
	}
	for _, id := range foreignIDs {
		if id != "" && bytes.Contains(body, []byte(`"`+id+`"`)) {
			return true
		}
	}
	return false
}

// carriesOnlyOwnTenant is a body that names a projectId or organizationId and
// every one it names is the caller's own: an object resolved inside the
// caller's tenant, however its id was addressed (a prompt read by handle).
func carriesOnlyOwnTenant(body []byte, ownIDs []string) bool {
	var value any
	if json.Unmarshal(body, &value) != nil {
		return false
	}
	carried := tenantIDs(value, nil)
	for _, id := range carried {
		if !slices.Contains(ownIDs, id) {
			return false
		}
	}
	return len(carried) > 0
}

// tenantIDs collects every string under a projectId or organizationId key.
func tenantIDs(value any, found []string) []string {
	switch typed := value.(type) {
	case []any:
		for _, element := range typed {
			found = tenantIDs(element, found)
		}
	case map[string]any:
		for key, field := range typed {
			if id, isString := field.(string); isString && (key == "projectId" || key == "organizationId") {
				found = append(found, id)
				continue
			}
			found = tenantIDs(field, found)
		}
	}
	return found
}

// emptyList is `[]`, or a wrapper object (no id of its own) whose every
// top-level array is empty, like {"events":[],"nextCursor":null}.
func emptyList(body []byte) bool {
	var value any
	if json.Unmarshal(body, &value) != nil {
		return false
	}
	switch typed := value.(type) {
	case []any:
		return len(typed) == 0
	case map[string]any:
		if _, hasID := typed["id"]; hasID {
			return false
		}
		arrays := 0
		for _, field := range typed {
			if list, isList := field.([]any); isList {
				if len(list) > 0 {
					return false
				}
				arrays++
			}
		}
		return arrays > 0
	}
	return false
}

func excerpt(body []byte) string {
	if len(body) > 200 {
		return string(body[:200])
	}
	return string(body)
}
