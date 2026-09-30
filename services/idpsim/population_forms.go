package idpsim

import (
	"net/http"
	"strconv"
	"strings"
	"sync"
)

/**
 * The tenant page's half of the large-directory verbs.
 *
 * The control API answers in JSON for a script; these are the same three acts
 * behind buttons, because the question "what does five thousand people do to
 * the members screen" is one somebody asks while looking at the screen.
 *
 * A form post ends in a redirect, so what the act did has to survive it. That
 * is what `lastScale` is for — the same reason `lastProvisioning` exists.
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
	Users  int
	Groups int
	Last   string
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
	t, ok := s.provisioningForm(w, r)
	if !ok {
		return
	}
	spec := PopulationSpec{
		Users:  formInt(r, "users"),
		Groups: formInt(r, "groups"),
	}
	if notice, bad := refusePopulation(spec); bad {
		s.refusalPage(w, t, refusalNotice{
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
	http.Redirect(w, r, t.BaseURL+"/", http.StatusSeeOther)
}

// handleChurnForm applies one round of change from the panel's six fields.
func (s *Server) handleChurnForm(w http.ResponseWriter, r *http.Request) {
	t, ok := s.provisioningForm(w, r)
	if !ok {
		return
	}
	spec := ChurnSpec{
		Join:       formInt(r, "join"),
		Leave:      formInt(r, "leave"),
		Deactivate: formInt(r, "deactivate"),
		Reactivate: formInt(r, "reactivate"),
		Rename:     formInt(r, "rename"),
		Regroup:    formInt(r, "regroup"),
	}
	if !spec.Any() {
		s.refusalPage(w, t, refusalNotice{
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
	http.Redirect(w, r, t.BaseURL+"/", http.StatusSeeOther)
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
	t.RecordProvisioning(ProvisioningOutcome{
		Kind:     "sync",
		At:       s.now(),
		Summary:  summary,
		Failures: result.Failures,
		Refused:  result.FailureCount > 0 && result.Created+result.Updated+result.Deactivated+result.Deleted == 0,
	})
	t.scaleNote.Set(summary)
	s.record(t, Event{
		Kind:    "scim.sync",
		Outcome: outcomeOf(result.FailureCount == 0),
		Detail:  summary,
	})
	http.Redirect(w, r, t.BaseURL+"/", http.StatusSeeOther)
}

// formInt reads one non-negative number off the posted form, treating blank
// and unparseable alike as zero: an empty box means "none of these".
func formInt(r *http.Request, field string) int {
	value, err := strconv.Atoi(strings.TrimSpace(r.PostForm.Get(field)))
	if err != nil || value < 0 {
		return 0
	}
	return value
}
