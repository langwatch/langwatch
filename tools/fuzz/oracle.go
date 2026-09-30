package fuzz

import (
	"bytes"
	"encoding/json"
	"fmt"
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
	if observation.Mutation.Foreign && observation.SeparateOrg && success(observation.Status) && leaksForeign(observation.Body, observation.ForeignIDs) {
		hits = append(hits, Hit{Oracle: "cross-tenant", Message: fmt.Sprintf("another tenant's resource read with the fuzzer's key: %d", observation.Status)})
	}
	if observation.JSONExpected && success(observation.Status) && observation.Mutation.Name == "valid" && !json.Valid(observation.Body) {
		hits = append(hits, Hit{Oracle: "schema-mismatch", Message: "documented JSON response was not valid JSON"})
	}
	if observation.Elapsed > cap {
		hits = append(hits, Hit{Oracle: "latency", Message: fmt.Sprintf("%s over the %s cap", observation.Elapsed.Round(time.Millisecond), cap)})
	}
	return hits
}

func success(status int) bool { return status >= 200 && status < 300 }

// leaksForeign is a 2xx body that names an id of the other tenant the request
// addressed and is not an empty list. ponytail: a leak that never echoes one of
// those ids is missed; tag seeded rows with a marker if that ever matters.
func leaksForeign(body []byte, foreignIDs []string) bool {
	if emptyList(body) {
		return false
	}
	for _, id := range foreignIDs {
		if id != "" && bytes.Contains(body, []byte(`"`+id+`"`)) {
			return true
		}
	}
	return false
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
