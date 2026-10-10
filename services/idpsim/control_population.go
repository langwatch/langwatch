package idpsim

import (
	"encoding/json"
	"fmt"
	"net/http"
)

/**
 * The control surface for a directory big enough to be worth syncing.
 *
 * Three verbs, in the order a session uses them: `population` decides how many
 * people there are, `churn` decides what happened to them since last time, and
 * `scim-sync` reconciles the difference into the receiving side. Each answers
 * in JSON with counts and timings, so a script can assert on the run rather
 * than on a screenshot.
 */

// maxGeneratedUsers caps a generate. Fifty thousand synthetic people is around
// 20 MB of process memory and several minutes of syncing, which is past the
// point where the answer is about the receiving side rather than about this
// simulator.
const maxGeneratedUsers = 50000

// maxGeneratedGroups caps the group count for the same reason, and because a
// membership spread over more groups than there are people stops meaning
// anything.
const maxGeneratedGroups = 500

/**
 * handleControlPopulate generates the tenant's directory to a requested size.
 *
 * The seeded admin and member survive a generate — see `Tenant.Populate` — so
 * a developer who has just built a five-thousand-person organization can still
 * sign in to look at it.
 */
func (s *Server) handleControlPopulate(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	var spec PopulationSpec
	if err := json.NewDecoder(r.Body).Decode(&spec); err != nil {
		http.Error(w, "unreadable population spec", http.StatusBadRequest)
		return
	}
	if notice, bad := refusePopulation(spec); bad {
		http.Error(w, notice, http.StatusBadRequest)
		return
	}
	result := t.Populate(spec)
	s.record(t, Event{
		Kind:    "directory.populate",
		Outcome: OutcomeOK,
		Detail: fmt.Sprintf("generated %s across %s",
			countOf(result.Users, "user"), countOf(result.Groups, "group")),
	})
	writeJSON(w, http.StatusOK, result)
}

// refusePopulation names the two ways a requested size is not one this
// simulator will produce.
func refusePopulation(spec PopulationSpec) (string, bool) {
	switch {
	case spec.Users < 0 || spec.Users > maxGeneratedUsers:
		return fmt.Sprintf("users must be between 0 and %d", maxGeneratedUsers), true
	case spec.Groups < 0 || spec.Groups > maxGeneratedGroups:
		return fmt.Sprintf("groups must be between 0 and %d", maxGeneratedGroups), true
	}
	return "", false
}

/**
 * handleControlChurn applies one round of directory change.
 *
 * Separate from populate on purpose: a run is "populate once, then churn and
 * sync repeatedly", and each sync then carries only that round's difference —
 * which is the number the whole exercise is about.
 */
func (s *Server) handleControlChurn(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	var spec ChurnSpec
	if err := json.NewDecoder(r.Body).Decode(&spec); err != nil {
		http.Error(w, "unreadable churn spec", http.StatusBadRequest)
		return
	}
	if !spec.Any() {
		http.Error(w, "a churn needs at least one of join, leave, deactivate, reactivate, rename or regroup", http.StatusBadRequest)
		return
	}
	result := t.Churn(spec)
	s.record(t, Event{
		Kind:    "directory.churn",
		Outcome: OutcomeOK,
		Detail:  churnSummary(result),
	})
	writeJSON(w, http.StatusOK, result)
}

/**
 * churnSummary is the one sentence the activity feed shows.
 *
 * Only what actually happened is named. A round that asked for fifty
 * deactivations in a directory of ten did ten, and a summary listing the zeros
 * beside it would bury the one number that moved.
 */
func churnSummary(result ChurnResult) string {
	parts := namedCounts([]namedCount{
		{result.Joined, "joined"},
		{result.Left, "left"},
		{result.Deactivated, "deactivated"},
		{result.Reactivated, "reactivated"},
		{result.Renamed, "renamed"},
		{result.Regrouped, "moved group"},
	})
	if len(parts) == 0 {
		return "nothing changed"
	}
	return joinWithCommas(parts) + fmt.Sprintf(" — %s now", countOf(result.Users, "user"))
}

// namedCount is one non-zero tally and the word for it.
type namedCount struct {
	n    int
	word string
}

// namedCounts renders the tallies that actually moved.
func namedCounts(counts []namedCount) []string {
	parts := make([]string, 0, len(counts))
	for _, c := range counts {
		if c.n > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", c.n, c.word))
		}
	}
	return parts
}

// joinWithCommas writes a list the way a sentence does.
func joinWithCommas(parts []string) string {
	switch len(parts) {
	case 0:
		return ""
	case 1:
		return parts[0]
	}
	out := parts[0]
	for _, part := range parts[1 : len(parts)-1] {
		out += ", " + part
	}
	return out + " and " + parts[len(parts)-1]
}

/**
 * handleControlSCIMSync reconciles the tenant's directory into the target.
 *
 * Unlike `scim-push`, which replays everything as creates, this reads what the
 * receiving side holds and sends only the difference — so it is safe to run
 * repeatedly, and every run after the first measures the churn rather than the
 * directory.
 */
func (s *Server) handleControlSCIMSync(w http.ResponseWriter, r *http.Request) {
	t, target, ok := s.controlTarget(w, r)
	if !ok {
		return
	}
	opts := syncOptionsFrom(r)
	result := syncDirectory(r.Context(), syncRun{tenant: t, target: target, opts: opts})
	s.record(t, Event{
		Kind:    "scim.sync",
		Outcome: outcomeOf(result.FailureCount == 0),
		Detail:  syncSummary(result, target.BaseURL),
	})
	writeJSON(w, http.StatusOK, result)
}

/**
 * syncOptionsFrom reads the run's options off the request.
 *
 * The body is already spoken for by `controlTarget`, which may find the target
 * there, so the options ride in the query string — and a caller that names
 * none gets a deactivating, eight-at-a-time run, which is the shape a real
 * identity provider sends.
 */
func syncOptionsFrom(r *http.Request) SyncOptions {
	query := r.URL.Query()
	opts := SyncOptions{
		Mode:   SyncMode(query.Get("mode")),
		Groups: query.Get("groups") == "1" || query.Get("groups") == "true",
		DryRun: query.Get("dryRun") == "1" || query.Get("dryRun") == "true",
	}
	if raw := query.Get("concurrency"); raw != "" {
		var parsed int
		if _, err := fmt.Sscanf(raw, "%d", &parsed); err == nil {
			opts.Concurrency = parsed
		}
	}
	return opts
}

// syncSummary is the one sentence the feed and the tenant page both show.
func syncSummary(result SyncResult, base string) string {
	parts := namedCounts([]namedCount{
		{result.Created, "created"},
		{result.Updated, "updated"},
		{result.Deactivated, "deactivated"},
		{result.Deleted, "deleted"},
		{result.GroupsWritten, "groups written"},
	})
	lead := "nothing to send"
	if len(parts) > 0 {
		lead = joinWithCommas(parts)
	}
	summary := fmt.Sprintf("%s at %s in %s", lead, base, result.Elapsed)
	if result.DryRun {
		summary = "would have " + summary
	}
	if result.FailureCount > 0 {
		summary += fmt.Sprintf(", and %s refused", countOf(result.FailureCount, "resource"))
	}
	return summary
}
