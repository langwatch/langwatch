package idpsim

import (
	"net/http"
	"strings"
)

// handleRegisterApplication registers a relying party from the tenant page and
// answers with the credentials, which the page shows once, at the top.
func (s *Server) handleRegisterApplication(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name         string   `json:"name"`
		RedirectURIs []string `json:"redirectUris"`
		EntityID     string   `json:"entityId"`
		ACSURL       string   `json:"acsUrl"`
	}
	t, ok := s.apiTenantAndBody(w, r, &body)
	if !ok {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeRefusal(w, refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "That application needs a name",
			Detail: "Every registration is listed by name, so it needs one.",
			Hint:   "Give it whatever the application calls itself — LangWatch, say.",
		})
		return
	}
	app := t.RegisterApplication(Registration{
		Name:         name,
		RedirectURIs: splitLines(strings.Join(body.RedirectURIs, "\n")),
		EntityID:     strings.TrimSpace(body.EntityID),
		ACSURL:       strings.TrimSpace(body.ACSURL),
	}, s.now())
	s.record(t, Event{
		Kind:    "app.register",
		Outcome: OutcomeOK,
		Client:  app.ClientID,
		Detail:  "registered the application " + app.Name,
	})
	writeJSON(w, http.StatusCreated, app)
}

// handleRemoveApplication un-registers an application.
func (s *Server) handleRemoveApplication(w http.ResponseWriter, r *http.Request) {
	t, ok := s.apiTenant(w, r)
	if !ok {
		return
	}
	clientID := r.PathValue("client")
	if t.RemoveApplication(clientID) {
		s.record(t, Event{
			Kind:    "app.remove",
			Outcome: OutcomeOK,
			Client:  clientID,
			Detail:  "un-registered an application",
		})
	}
	w.WriteHeader(http.StatusNoContent)
}
