package telemetrysim

import (
	"math"
	"net/http"
	"slices"
	"time"
)

// maxSamples bounds the attempt latencies a run keeps; a longer run keeps the newest.
const maxSamples = 4096

// Latency is a run's attempt latency in milliseconds over its newest samples.
type Latency struct {
	Samples int     `json:"samples"`
	P50     float64 `json:"p50"`
	P90     float64 `json:"p90"`
	P99     float64 `json:"p99"`
	Max     float64 `json:"max"`
}

// record counts one attempt: how long it took, the status it got and any Retry-After.
func (r *run) record(a answer, took time.Duration) {
	r.mu.Lock()
	defer r.mu.Unlock()
	ms := float64(took.Microseconds()) / 1000
	if len(r.samples) < maxSamples {
		r.samples = append(r.samples, ms)
	} else {
		r.samples[r.next] = ms
		r.next = (r.next + 1) % maxSamples
	}
	if a.status == 0 {
		return
	}
	if r.status.Answers == nil {
		r.status.Answers = map[int]int64{}
	}
	r.status.Answers[a.status]++
	if a.retryAfter != "" {
		r.status.RetryAfterSeen++
		r.status.LastRetryAfter = a.retryAfter
	}
}

// latencyOf reads nearest-rank percentiles off the samples; nil before the first attempt.
func latencyOf(samples []float64) *Latency {
	if len(samples) == 0 {
		return nil
	}
	sorted := slices.Sorted(slices.Values(samples))
	at := func(q float64) float64 { return sorted[max(0, int(math.Ceil(q*float64(len(sorted))))-1)] }
	return &Latency{Samples: len(sorted), P50: at(0.5), P90: at(0.9), P99: at(0.99), Max: sorted[len(sorted)-1]}
}

// keyHint shows a key's first six and last four characters, never enough to use it.
func keyHint(key string) string {
	if key == "" {
		return ""
	}
	if len(key) < 16 {
		return "set"
	}
	return key[:6] + "…" + key[len(key)-4:]
}

// runsNow is the current run and the finished runs before it, newest first.
func (s *Server) runsNow() (*RunStatus, []RunStatus) {
	s.mu.Lock()
	rn := s.run
	recent := slices.Clone(s.recent)
	s.mu.Unlock()
	if rn == nil {
		return nil, recent
	}
	snap := rn.snapshot()
	return &snap, recent
}

// withoutMutations copies runs bar their mutations; never nil, so the wire reads [].
func withoutMutations(runs []RunStatus) []RunStatus {
	out := append(make([]RunStatus, 0, len(runs)), runs...)
	for i := range out {
		out[i].Mutations = nil
	}
	return out
}

// handleRuns is GET /_sim/api/runs: the current run, then the recent ones, without mutations.
func (s *Server) handleRuns(w http.ResponseWriter, _ *http.Request) {
	current, recent := s.runsNow()
	if current != nil {
		recent = append([]RunStatus{*current}, recent...)
	}
	writeJSON(w, http.StatusOK, map[string][]RunStatus{"runs": withoutMutations(recent)})
}

// handleRun is GET /_sim/api/runs/{id}: one run with its mutations; "current" names the newest.
func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	current, recent := s.runsNow()
	if current != nil {
		recent = append([]RunStatus{*current}, recent...)
	}
	for i := range recent {
		if recent[i].ID == id || (id == "current" && current != nil) {
			writeJSON(w, http.StatusOK, recent[i])
			return
		}
	}
	writeError(w, http.StatusNotFound, "no run "+id+"; the sim keeps the current run and the last ten")
}
