package seedgen

import (
	"crypto/sha256"
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"
)

// items is every span, log record and metric of a request, each as its raw JSON: ids, timestamps
// and attributes, so equal sets mean nothing generated changed.
func items(t *testing.T, action Action) []string {
	t.Helper()
	var doc struct {
		ResourceSpans []struct {
			ScopeSpans []struct{ Spans []json.RawMessage }
		}
		ResourceLogs []struct {
			ScopeLogs []struct{ LogRecords []json.RawMessage }
		}
		ResourceMetrics []struct {
			ScopeMetrics []struct{ Metrics []json.RawMessage }
		}
	}
	if err := json.Unmarshal(action.Input, &doc); err != nil {
		t.Fatalf("%s: %v", action.ID, err)
	}
	var all []string
	add := func(raw []json.RawMessage) {
		for _, r := range raw {
			all = append(all, action.Project+" "+action.Kind+" "+string(r))
		}
	}
	for _, rs := range doc.ResourceSpans {
		for _, ss := range rs.ScopeSpans {
			add(ss.Spans)
		}
	}
	for _, rl := range doc.ResourceLogs {
		for _, sl := range rl.ScopeLogs {
			add(sl.LogRecords)
		}
	}
	for _, rm := range doc.ResourceMetrics {
		for _, sm := range rm.ScopeMetrics {
			add(sm.Metrics)
		}
	}
	return all
}

// digests is items hashed, so a whole plan's worth stays small.
func digests(t *testing.T, action Action) []string {
	t.Helper()
	all := items(t, action)
	for i, item := range all {
		sum := sha256.Sum256([]byte(item))
		all[i] = string(sum[:])
	}
	return all
}

// packAll walks the plan's cell chunks through a Packer, handing over each chunk and each request
// as it goes: nothing is held, so the 256 MB walk test that shares this process stays honest.
func packAll(t *testing.T, plan *Plan, now time.Time, chunk, request func(Action)) {
	t.Helper()
	packer := &Packer{Now: now}
	for step := range plan.Steps() {
		for c, err := range plan.Chunks(step) {
			if err != nil {
				t.Fatal(err)
			}
			chunk(c)
			closed, err := packer.Add(c)
			if err != nil {
				t.Fatal(err)
			}
			for i := range closed {
				request(closed[i])
			}
		}
	}
	flushed := packer.Flush()
	for i := range flushed {
		request(flushed[i])
	}
}

// @scenario "A heavy seed packs cells into requests up to the chunk bounds without changing a single id or timestamp"
func TestPackingKeepsEveryIDAndTimestampWithinTheBounds(t *testing.T) {
	plan := mustPlan(t, "--size", "tiny", "--days", "40", "--spans", "20000")
	now := anchor
	var before, after []string
	chunks, requests, backdated := 0, 0, 0
	packAll(t, plan, now, func(chunk Action) {
		chunks++
		before = append(before, digests(t, chunk)...)
	}, func(request Action) {
		requests++
		got := digests(t, request)
		after = append(after, got...)
		limit := MaxChunkRecords
		if request.Kind == KindTraceOTLP {
			limit = MaxChunkSpans
		}
		if len(got) != request.Count || request.Count > limit || len(request.Input) > MaxChunkBytes {
			t.Fatalf("%s: %d items (count %d), %d bytes", request.ID, len(got), request.Count, len(request.Input))
		}
		if Backdated(request, now) {
			backdated++
		}
	})
	slices.Sort(before)
	slices.Sort(after)
	if !slices.Equal(before, after) {
		t.Fatalf("packing changed what was generated: %d items before, %d after", len(before), len(after))
	}
	if requests*5 > chunks || backdated == 0 {
		t.Fatalf("%d chunks packed into %d requests, %d backdated", chunks, requests, backdated)
	}
	t.Logf("%d chunks packed into %d requests", chunks, requests)
}

func TestPackerNeverMixesBackdatedAndNormalChunks(t *testing.T) {
	chunk := func(id string, age time.Duration) Action {
		return Action{ID: id, Kind: KindTraceOTLP, Project: "p", Key: id, Count: 1,
			At: anchor.Add(-age).Format(time.RFC3339), Input: []byte(`{"resourceSpans":[{"id":"` + id + `"}]}`)}
	}
	packer := &Packer{Now: anchor}
	for _, c := range []Action{chunk("old.0", 40*24*time.Hour), chunk("new.0", time.Hour), chunk("old.1", 35*24*time.Hour)} {
		if closed, err := packer.Add(c); err != nil || len(closed) != 0 {
			t.Fatalf("%s closed %v: %v", c.ID, closed, err)
		}
	}
	requests := packer.Flush()
	if len(requests) != 2 {
		t.Fatalf("got %d requests, want one backdated and one normal", len(requests))
	}
	for _, request := range requests {
		old := strings.HasPrefix(request.ID, "old")
		if Backdated(request, anchor) != old || old && string(request.Input) != `{"resourceSpans":[{"id":"old.0"},{"id":"old.1"}]}` {
			t.Errorf("%s: %s", request.ID, request.Input)
		}
	}
}

// TestTierMRequestCount counts the heavy seed's OTLP requests for a tier M plan, unpacked and packed.
func TestTierMRequestCount(t *testing.T) {
	if testing.Short() {
		t.Skip("walks the medium plan")
	}
	plan := mustPlan(t, "--size", "medium", "--private", "0", "--seed", "1")
	chunks := map[string]int{}
	requests := map[string]int{}
	packAll(t, plan, anchor, func(chunk Action) { chunks[chunk.Kind]++ }, func(request Action) { requests[request.Kind]++ })
	t.Logf("tier M chunks %v, packed requests %v", chunks, requests)
	if requests[KindTraceOTLP]*20 > chunks[KindTraceOTLP] {
		t.Fatalf("trace requests fell only from %d to %d", chunks[KindTraceOTLP], requests[KindTraceOTLP])
	}
}
