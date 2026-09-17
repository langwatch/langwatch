package idpsim

import (
	"net/http"
	"net/url"
	"strings"
	"time"
)

/**
 * Provisioning INTO a real service provider — the Okta/Entra half of SCIM.
 *
 * WHY THE TOKEN IS PASTED IN RATHER THAN MINTED. SCIM only ever runs one way:
 * the identity provider sends its directory to the application, so the
 * application is the side that issues the credential. LangWatch mints the
 * token — or takes one the administrator already had — and whoever provisions
 * presents it. A token this simulator generated would open nothing, so this is
 * a box to fill in and not a value to copy.
 *
 * The tenant's own SCIMToken is the opposite direction and stays where it is:
 * it guards the simulator's own SCIM endpoints, for exercising the client side
 * of provisioning. The two are the pair most easily confused — same protocol,
 * opposite ends of it — so the page names which is which and this form refuses
 * the tenant's own token outright.
 */

// ProvisioningTarget is a real SCIM service provider this tenant pushes at:
// the base address its Users and Groups collections hang off, and the bearer
// token that provider issued.
type ProvisioningTarget struct {
	BaseURL string `json:"baseUrl"`
	Token   string `json:"token"`
}

// Configured reports whether there is enough here to reach the target.
func (p ProvisioningTarget) Configured() bool { return p.BaseURL != "" && p.Token != "" }

// ProvisioningOutcome is what the last push or read-back did. It is kept on
// the tenant because a form post ends in a redirect, and the answer to "did
// that land?" has to survive it.
type ProvisioningOutcome struct {
	// Kind is "push" or "pull".
	Kind string    `json:"kind"`
	At   time.Time `json:"at"`
	// Summary is one plain sentence: what landed, or what came back.
	Summary string `json:"summary"`
	// Users and Groups are what a read-back found the target holding.
	Users  []string `json:"users,omitempty"`
	Groups []string `json:"groups,omitempty"`
	// Failures are the resources the target refused, one line each.
	Failures []string `json:"failures,omitempty"`
	// Refused is true when the whole operation failed rather than parts of it.
	Refused bool `json:"refused,omitempty"`
}

// Provisioning is where this tenant currently pushes its directory.
func (t *Tenant) Provisioning() ProvisioningTarget {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.provisioning
}

// SetProvisioning points the tenant at a service provider, clearing whatever
// the last push or read-back reported: an outcome from the previous target
// says nothing about this one.
func (t *Tenant) SetProvisioning(target ProvisioningTarget) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.provisioning = target
	t.lastProvisioning = nil
}

// ClearProvisioning forgets the target.
func (t *Tenant) ClearProvisioning() {
	t.SetProvisioning(ProvisioningTarget{})
}

// RecordProvisioning files the outcome of a push or read-back.
func (t *Tenant) RecordProvisioning(outcome ProvisioningOutcome) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.lastProvisioning = &outcome
}

// LastProvisioning is the most recent push or read-back, or nil.
func (t *Tenant) LastProvisioning() *ProvisioningOutcome {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.lastProvisioning
}

/**
 * The base the collections hang off, from whatever was pasted.
 *
 * LangWatch shows the base — `…/api/scim/v2` — but the value on somebody's
 * clipboard is as often the endpoint they were last looking at, and posting a
 * user to `…/Users/Users` fails in a way that reads like the token is wrong.
 * So a trailing collection is trimmed rather than taken literally.
 */
func normalizeSCIMBase(typed string) string {
	base := strings.TrimSuffix(strings.TrimSpace(typed), "/")
	for _, collection := range []string{"/Users", "/Groups"} {
		base = strings.TrimSuffix(base, collection)
	}
	return base
}

// reachableSCIMBase reports whether the address is one an HTTP client can
// actually be pointed at, which is the only thing worth checking here: the
// path shape is the target's business, not ours.
func reachableSCIMBase(base string) bool {
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" {
		return false
	}
	return parsed.Scheme == "http" || parsed.Scheme == "https"
}

// maskedToken shows enough of a credential to tell whether the right thing was
// pasted, and not enough to use it. Short values are hidden outright — the
// first six characters of a twelve-character token is half the token.
func maskedToken(token string) string {
	if len(token) < 20 {
		return strings.Repeat("•", 8)
	}
	return token[:6] + "…" + token[len(token)-4:]
}

// handleSaveProvisioning takes the address and token from the tenant page and
// remembers them, so pushing afterwards is one press rather than a form.
func (s *Server) handleSaveProvisioning(w http.ResponseWriter, r *http.Request) {
	t, ok := s.provisioningForm(w, r)
	if !ok {
		return
	}
	base := normalizeSCIMBase(r.PostForm.Get("target"))
	token := strings.TrimSpace(r.PostForm.Get("token"))
	if notice, bad := s.refuseTarget(t, ProvisioningTarget{BaseURL: base, Token: token}); bad {
		s.refusalPage(w, t, notice)
		return
	}
	t.SetProvisioning(ProvisioningTarget{BaseURL: base, Token: token})
	s.record(t, Event{
		Kind:    "scim.target",
		Outcome: OutcomeOK,
		Detail:  "will provision into " + base,
	})
	http.Redirect(w, r, t.BaseURL+"/?connected="+url.QueryEscape(base), http.StatusSeeOther)
}

// refuseTarget names the three ways a pasted target is wrong, in the words of
// what the reader is looking at rather than of the field that failed.
func (s *Server) refuseTarget(t *Tenant, target ProvisioningTarget) (refusalNotice, bool) {
	switch {
	case target.BaseURL == "" || !reachableSCIMBase(target.BaseURL):
		return refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "That is not an address this tenant can reach",
			Detail: "Provisioning sends users over HTTP, so the SCIM address needs a scheme and a host.",
			Hint:   "LangWatch shows it under its SCIM setup — something like https://app.your-worktree.langwatch.localhost/api/scim/v2.",
		}, true
	case target.Token == "":
		return refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "That connection needs LangWatch's token",
			Detail: "The token is what proves this tenant is allowed to provision, and only LangWatch can issue it.",
			Hint:   "It is the value LangWatch showed you when you turned SCIM on — or the one you set yourself there.",
		}, true
	// Pasting the tenant's own SCIM token is the one mistake the page invites,
	// because it is the only token on it. Say which end each one belongs to,
	// rather than letting every push come back unauthorized.
	case target.Token == t.SCIMToken:
		return refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "That is this tenant's token, not LangWatch's",
			Detail: "The token above guards the simulator's own directory, for provisioning into it. Pushing the other way needs the token the receiving side issued.",
			Hint:   "Take the value from LangWatch's SCIM setup instead — it mints one, or accepts one you already have.",
		}, true
	}
	return refusalNotice{}, false
}

// handleForgetProvisioning drops the connection.
func (s *Server) handleForgetProvisioning(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	t.ClearProvisioning()
	s.record(t, Event{
		Kind:    "scim.target",
		Outcome: OutcomeOK,
		Detail:  "forgot where it was provisioning",
	})
	http.Redirect(w, r, t.BaseURL+"/", http.StatusSeeOther)
}

// handlePushProvisioning sends the tenant's directory at the stored target —
// the press that stands in for an identity provider's scheduled push.
func (s *Server) handlePushProvisioning(w http.ResponseWriter, r *http.Request) {
	t, target, ok := s.provisioningAction(w, r)
	if !ok {
		return
	}
	result := pushDirectory(r.Context(), t, target)
	outcome := ProvisioningOutcome{
		Kind:     "push",
		At:       s.now(),
		Summary:  pushSummary(result, target.BaseURL),
		Failures: result.Failures,
		Refused:  result.UsersCreated == 0 && result.GroupsCreated == 0 && len(result.Failures) > 0,
	}
	t.RecordProvisioning(outcome)
	s.record(t, Event{
		Kind:    "scim.push",
		Outcome: outcomeOf(!outcome.Refused),
		Detail:  outcome.Summary,
	})
	http.Redirect(w, r, t.BaseURL+"/", http.StatusSeeOther)
}

// handlePullProvisioning reads the target's directory back, which is how you
// see what the push actually made of the users rather than trusting a count.
func (s *Server) handlePullProvisioning(w http.ResponseWriter, r *http.Request) {
	t, target, ok := s.provisioningAction(w, r)
	if !ok {
		return
	}
	snapshot, err := pullDirectory(r.Context(), target)
	outcome := ProvisioningOutcome{Kind: "pull", At: s.now()}
	if err != nil {
		outcome.Refused = true
		outcome.Summary = "could not read " + target.BaseURL + " back: " + err.Error()
	} else {
		outcome.Summary = pullSummary(snapshot, target.BaseURL)
		outcome.Users, outcome.Groups = snapshot.Users, snapshot.Groups
	}
	t.RecordProvisioning(outcome)
	s.record(t, Event{
		Kind:    "scim.pull",
		Outcome: outcomeOf(!outcome.Refused),
		Detail:  outcome.Summary,
	})
	http.Redirect(w, r, t.BaseURL+"/", http.StatusSeeOther)
}

// provisioningForm resolves the tenant and parses the posted form.
func (s *Server) provisioningForm(w http.ResponseWriter, r *http.Request) (*Tenant, bool) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return nil, false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := r.ParseForm(); err != nil {
		http.Error(w, "unparseable form", http.StatusBadRequest)
		return nil, false
	}
	return t, true
}

// provisioningAction resolves the tenant and the target a push or read-back
// needs, refusing on the page when nothing has been connected yet.
func (s *Server) provisioningAction(w http.ResponseWriter, r *http.Request) (*Tenant, ProvisioningTarget, bool) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return nil, ProvisioningTarget{}, false
	}
	target := t.Provisioning()
	if !target.Configured() {
		s.refusalPage(w, t, refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "This tenant is not provisioning anywhere yet",
			Detail: "There is nowhere to send the directory until LangWatch's SCIM address and token are filled in.",
			Hint:   "Both are on LangWatch's SCIM setup screen; the token is the one it minted or you set there.",
		})
		return nil, ProvisioningTarget{}, false
	}
	return t, target, true
}

func outcomeOf(ok bool) string {
	if ok {
		return OutcomeOK
	}
	return OutcomeRefused
}
