package idpsim

import (
	"encoding/json"
	"net/http"
	"strconv"
)

// routeAPI is the JSON the console reads and the acts behind its buttons
// (ADR-160). The control API stays the scriptable twin; these answer in the
// console's terms, and every refusal carries what to go and fix.
func (s *Server) routeAPI(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/tenants", s.handleAPITenants)
	mux.HandleFunc("GET /api/t/{tenant}", s.handleAPITenant)
	mux.HandleFunc("GET /api/t/{tenant}/sign-in", s.handleAPISignIn)
	mux.HandleFunc("POST /api/t/{tenant}/apps", s.handleRegisterApplication)
	mux.HandleFunc("DELETE /api/t/{tenant}/apps/{client}", s.handleRemoveApplication)
	// The DNS registry: this machine standing in for the registrar a reserved
	// name has none of, so a domain proof is walked the way a customer walks it.
	mux.HandleFunc("POST /api/t/{tenant}/dns", s.handlePublishVerification)
	mux.HandleFunc("DELETE /api/t/{tenant}/dns/{name}", s.handleUnpublishVerification)
	// Provisioning into a real service provider: the address and token that
	// provider issued, then the presses that use them.
	mux.HandleFunc("PUT /api/t/{tenant}/provisioning", s.handleSaveProvisioning)
	mux.HandleFunc("DELETE /api/t/{tenant}/provisioning", s.handleForgetProvisioning)
	mux.HandleFunc("POST /api/t/{tenant}/provisioning/push", s.handlePushProvisioning)
	mux.HandleFunc("POST /api/t/{tenant}/provisioning/pull", s.handlePullProvisioning)
	mux.HandleFunc("POST /api/t/{tenant}/provisioning/sync", s.handleSyncProvisioning)
	mux.HandleFunc("POST /api/t/{tenant}/population", s.handlePopulationForm)
	mux.HandleFunc("POST /api/t/{tenant}/churn", s.handleChurnForm)
}

// refusalNotice is what a refusal says: what happened, and what to go and
// change about it. The person reading it is mid-way through wiring two systems
// together and needs to know which one to fix.
type refusalNotice struct {
	Status int    `json:"-"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
	Hint   string `json:"hint"`
}

func writeRefusal(w http.ResponseWriter, n refusalNotice) {
	writeJSON(w, n.Status, n)
}

// apiTenant resolves the {tenant} segment, answering a 404 the console can
// show when there is no such tenant.
func (s *Server) apiTenant(w http.ResponseWriter, r *http.Request) (*Tenant, bool) {
	t, ok := s.tenantFor(r)
	if !ok {
		writeRefusal(w, refusalNotice{
			Status: http.StatusNotFound,
			Title:  "There is no tenant " + r.PathValue("tenant"),
			Detail: "This simulator serves tenants 1 to " + strconv.Itoa(len(s.tenants)) + ".",
			Hint:   "Pick one from the landing page; IDPSIM_TENANTS sets how many there are.",
		})
	}
	return t, ok
}

// readBody decodes the console's JSON body into v, refusing anything else.
func readBody(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		writeRefusal(w, refusalNotice{
			Status: http.StatusBadRequest,
			Title:  "That request could not be read",
			Detail: "The console sends a JSON body; this one was not: " + err.Error() + ".",
			Hint:   "Reload the page and try again, or use the control API from a script.",
		})
		return false
	}
	return true
}

// apiTenantAndBody is apiTenant then readBody, the start of every act that
// takes fields.
func (s *Server) apiTenantAndBody(w http.ResponseWriter, r *http.Request, v any) (*Tenant, bool) {
	t, ok := s.apiTenant(w, r)
	if !ok || !readBody(w, r, v) {
		return nil, false
	}
	return t, true
}
