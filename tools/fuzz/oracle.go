package fuzz

import (
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
	if observation.Mutation.Foreign && observation.SeparateOrg && success(observation.Status) && nonEmptyBody(observation.Body) {
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

func nonEmptyBody(body []byte) bool {
	trimmed := trimSpace(body)
	return len(trimmed) > 0 && string(trimmed) != "{}" && string(trimmed) != "[]" && string(trimmed) != "null"
}

func trimSpace(body []byte) []byte {
	start, end := 0, len(body)
	for start < end && isSpace(body[start]) {
		start++
	}
	for end > start && isSpace(body[end-1]) {
		end--
	}
	return body[start:end]
}

func isSpace(character byte) bool {
	return character == ' ' || character == '\n' || character == '\t' || character == '\r'
}

func excerpt(body []byte) string {
	if len(body) > 200 {
		return string(body[:200])
	}
	return string(body)
}
