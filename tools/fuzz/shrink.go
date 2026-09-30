package fuzz

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
)

// rawFinding is one oracle hit kept with enough to shrink and reproduce it.
type rawFinding struct {
	item       job
	request    builtRequest
	status     int
	hit        Hit
	capturedAt string
}

// shrinkGroups groups the raw findings by signature and shrinks each group's
// example to a minimal reproducing request, concurrently. The counts come from
// the full raw set; only one example per signature is shrunk, so the server
// sees at most one extra pass per distinct cause.
func (run *apiRun) shrinkGroups(ctx context.Context) []Group {
	run.mu.Lock()
	raw := append([]rawFinding(nil), run.raw...)
	run.mu.Unlock()

	byGroup := map[string][]rawFinding{}
	order := make([]string, 0)
	for _, finding := range raw {
		key := signatureOf(finding.hit.Oracle, finding.item.op.Method, finding.item.op.Path, finding.status)
		if _, seen := byGroup[key]; !seen {
			order = append(order, key)
		}
		byGroup[key] = append(byGroup[key], finding)
	}

	groups := make([]Group, len(order))
	var wait sync.WaitGroup
	for index, key := range order {
		wait.Add(1)
		go func(index int, key string) {
			defer wait.Done()
			members := byGroup[key]
			example := run.shrink(ctx, members[0])
			groups[index] = Group{Signature: key, Count: len(members), Example: example.asFinding()}
		}(index, key)
	}
	wait.Wait()
	sort.SliceStable(groups, func(a, b int) bool { return groups[a].Count > groups[b].Count })
	return groups
}

// shrink removes body keys one at a time while the same oracle still fires,
// returning the minimal reproducing request. A finding with no body, or one the
// server no longer reproduces, is returned unchanged.
func (run *apiRun) shrink(ctx context.Context, finding rawFinding) rawFinding {
	body := map[string]any{}
	if finding.request.body == nil || json.Unmarshal(finding.request.body, &body) != nil {
		return finding
	}
	minimal := ShrinkBody(body, func(trial map[string]any) bool {
		candidate := finding
		candidate.request.body = marshalBody(trial)
		return run.reproduces(ctx, candidate)
	})
	finding.request.body = marshalBody(minimal)
	return finding
}

// ShrinkBody drops keys one at a time (sorted, for determinism) while reproduces
// still holds, returning the minimal body. Pure: the reproduces oracle is the
// only side effect, so this is unit-testable without a server.
func ShrinkBody(body map[string]any, reproduces func(map[string]any) bool) map[string]any {
	current := body
	for changed := true; changed; {
		changed = false
		for _, key := range sortedMapKeys(current) {
			trial := withoutKey(current, key)
			if reproduces(trial) {
				current = trial
				changed = true
				break
			}
		}
	}
	return current
}

// reproduces reruns one request and reports whether the same oracle fires.
func (run *apiRun) reproduces(ctx context.Context, finding rawFinding) bool {
	status, elapsed, responseBody, _ := run.do(ctx, finding.request)
	hits := Evaluate(Observation{
		Mutation: finding.item.mutation, Status: status, Elapsed: elapsed, Body: responseBody,
		JSONExpected: true, SeparateOrg: run.org.Separate, LatencyCap: LatencyCap, ForeignIDs: finding.request.foreign,
	})
	for _, hit := range hits {
		if hit.Oracle == finding.hit.Oracle && status == finding.status {
			return true
		}
	}
	return false
}

func sortedMapKeys(body map[string]any) []string {
	keys := make([]string, 0, len(body))
	for key := range body {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func withoutKey(body map[string]any, drop string) map[string]any {
	trial := make(map[string]any, len(body))
	for key, value := range body {
		if key != drop {
			trial[key] = value
		}
	}
	return trial
}
