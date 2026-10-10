package idpsim

import (
	"net/http"
	"sync"
)

/**
 * The tenant page's half of the large-directory verbs: the control API's three
 * acts behind buttons, refusing in the page's terms. What the last act did is
 * kept as a note, so a reload still shows it — the reason `lastProvisioning`
 * exists too.
 */

// scaleNote is the one sentence the tenant page shows about the last generate,
// churn or sync.
type scaleNote struct {
	mu   sync.Mutex
	text string
}

// Set records what just happened.
func (n *scaleNote) Set(text string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.text = text
}

// Text is the note, or empty.
func (n *scaleNote) Text() string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.text
}

// scaleView is what the panel renders: the sizes its fields should show, and
// the note under them.
type scaleView struct {
	Users  int    `json:"users"`
	Groups int    `json:"groups"`
	Last   string `json:"last"`
}

// scaleViewOf fills the panel in from the tenant's current directory, so the
// number in the box is what the tenant already holds rather than a guess.
func scaleViewOf(t *Tenant) scaleView {
	groups := len(t.Groups())
	if groups == 0 {
		// A tenant that has never been generated gets a sensible starting
		// shape rather than a zero, which would generate a directory with no
		// groups and no membership to sync.
		groups = 6
	}
	return scaleView{
		Users:  max(len(t.Users()), 500),
		Groups: groups,
		Last:   t.scaleNote.Text(),
	}
}

// handlePopulationForm generates the directory from the panel's two fields.
func (s *Server) handlePopulationForm(w http.ResponseWriter, r *http.Request) {
	var spec PopulationSpec
	t, ok := s.apiTenantAndBody(w, r, &spec)
	if !ok {
		return
	}
	if notice, bad := refusePopulation(spec); bad {
		writeRefusal(w, refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "That is not a directory this simulator will generate",
			Detail: notice,
			Hint:   "Keep it to something a laptop can hold and a sync can finish.",
		})
		return
	}
	result := t.Populate(spec)
	summary := countOf(result.Users, "user") + " across " + countOf(result.Groups, "group")
	t.scaleNote.Set("generated " + summary)
	s.record(t, Event{Kind: "directory.populate", Outcome: OutcomeOK, Detail: "generated " + summary})
	writeJSON(w, http.StatusOK, scaleViewOf(t))
}

// handleChurnForm applies one round of change from the panel's six fields. A
// negative count means none, as an empty box did.
func (s *Server) handleChurnForm(w http.ResponseWriter, r *http.Request) {
	var typed ChurnSpec
	t, ok := s.apiTenantAndBody(w, r, &typed)
	if !ok {
		return
	}
	spec := ChurnSpec{
		Join: max(typed.Join, 0), Leave: max(typed.Leave, 0),
		Deactivate: max(typed.Deactivate, 0), Reactivate: max(typed.Reactivate, 0),
		Rename: max(typed.Rename, 0), Regroup: max(typed.Regroup, 0), Seed: typed.Seed,
	}
	if !spec.Any() {
		writeRefusal(w, refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "Nothing to change",
			Detail: "A churn round needs at least one of joining, leaving, deactivating, reactivating, renaming or regrouping.",
			Hint:   "Put a number in one of the boxes — fifty deactivations is a good first round.",
		})
		return
	}
	result := t.Churn(spec)
	t.scaleNote.Set(churnSummary(result))
	s.record(t, Event{Kind: "directory.churn", Outcome: OutcomeOK, Detail: churnSummary(result)})
	writeJSON(w, http.StatusOK, scaleViewOf(t))
}

/**
 * handleSyncProvisioning reconciles the directory into the connected target.
 *
 * Groups are included from the page — somebody pressing a button on a screen
 * wants the whole thing carried across, and the option to leave them out is
 * for a script measuring the user half on its own.
 */
func (s *Server) handleSyncProvisioning(w http.ResponseWriter, r *http.Request) {
	t, target, ok := s.provisioningAction(w, r)
	if !ok {
		return
	}
	result := syncDirectory(r.Context(), syncRun{tenant: t, target: target, opts: SyncOptions{Groups: true}})
	summary := syncSummary(result, target.BaseURL)
	outcome := ProvisioningOutcome{
		Kind:     "sync",
		At:       s.now(),
		Summary:  summary,
		Failures: result.Failures,
		Refused:  result.FailureCount > 0 && result.Created+result.Updated+result.Deactivated+result.Deleted == 0,
	}
	t.RecordProvisioning(outcome)
	t.scaleNote.Set(summary)
	s.record(t, Event{
		Kind:    "scim.sync",
		Outcome: outcomeOf(result.FailureCount == 0),
		Detail:  summary,
	})
	writeJSON(w, http.StatusOK, outcome)
}
