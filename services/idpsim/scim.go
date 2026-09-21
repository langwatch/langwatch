package idpsim

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

const (
	scimUserSchema  = "urn:ietf:params:scim:schemas:core:2.0:User"
	scimGroupSchema = "urn:ietf:params:scim:schemas:core:2.0:Group"
	scimListSchema  = "urn:ietf:params:scim:api:messages:2.0:ListResponse"
	scimErrorSchema = "urn:ietf:params:scim:api:messages:2.0:Error"
	scimPatchSchema = "urn:ietf:params:scim:api:messages:2.0:PatchOp"
)

// scimAuthorized enforces the tenant's bearer token on every SCIM route.
func (s *Server) scimAuthorized(t *Tenant, w http.ResponseWriter, r *http.Request) bool {
	token, ok := bearerToken(r)
	if !ok || subtle.ConstantTimeCompare([]byte(token), []byte(t.SCIMToken)) != 1 {
		s.record(t, Event{
			Kind:    "scim.auth",
			Outcome: OutcomeRefused,
			Detail:  "a SCIM request arrived with a missing or wrong bearer token",
		})
		scimError(w, http.StatusUnauthorized, "invalid or missing bearer token")
		return false
	}
	return true
}

func scimError(w http.ResponseWriter, status int, detail string) {
	writeJSON(w, status, map[string]any{
		"schemas": []string{scimErrorSchema},
		"status":  strconv.Itoa(status),
		"detail":  detail,
	})
}

// scimUserResource renders a user in SCIM 2.0 shape.
func scimUserResource(u *User) map[string]any {
	return map[string]any{
		"schemas":  []string{scimUserSchema},
		"id":       u.ID,
		"userName": u.UserName,
		"name": map[string]any{
			"givenName":  u.GivenName,
			"familyName": u.FamilyName,
			"formatted":  u.DisplayName(),
		},
		"displayName": u.DisplayName(),
		"emails":      []map[string]any{{"value": u.Email, "primary": true}},
		"active":      u.Active,
		"externalId":  u.ExternalID,
	}
}

func scimGroupResource(t *Tenant, g *Group) map[string]any {
	members := []map[string]any{}
	for _, id := range g.MemberIDs {
		m := map[string]any{"value": id}
		if u, ok := t.UserByID(id); ok {
			m["display"] = u.DisplayName()
		}
		members = append(members, m)
	}
	return map[string]any{
		"schemas":     []string{scimGroupSchema},
		"id":          g.ID,
		"displayName": g.Name,
		"members":     members,
	}
}

func scimList(resources []map[string]any) map[string]any {
	return map[string]any{
		"schemas":      []string{scimListSchema},
		"totalResults": len(resources),
		"startIndex":   1,
		"itemsPerPage": len(resources),
		"Resources":    resources,
	}
}

// handleSCIMServiceProviderConfig is the static capability document IdP
// provisioning clients probe first.
func (s *Server) handleSCIMServiceProviderConfig(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok || !s.scimAuthorized(t, w, r) {
		if !ok {
			http.NotFound(w, r)
		}
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"schemas": []string{"urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"},
		"patch":   map[string]any{"supported": true},
		"filter":  map[string]any{"supported": true, "maxResults": 200},
		"bulk":    map[string]any{"supported": false},
		"sort":    map[string]any{"supported": false},
		"etag":    map[string]any{"supported": false},
		"changePassword": map[string]any{
			"supported": false,
		},
		"authenticationSchemes": []map[string]any{{
			"type": "oauthbearertoken", "name": "Bearer token",
			"description": "The tenant's deterministic SCIM token",
		}},
	})
}

// handleSCIMUsers lists (with `userName eq` filtering) and creates users.
func (s *Server) handleSCIMUsers(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if !s.scimAuthorized(t, w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.listSCIMUsers(w, t, r.URL.Query().Get("filter"))
	case http.MethodPost:
		s.createSCIMUser(w, t, r)
	default:
		scimError(w, http.StatusMethodNotAllowed, "unsupported method")
	}
}

// listSCIMUsers answers a directory read, honoring the one filter shape
// provisioning clients use for lookups.
func (s *Server) listSCIMUsers(w http.ResponseWriter, t *Tenant, filter string) {
	users := t.Users()
	if userName, ok := parseEqFilter(filter, "userName"); ok {
		users = filterUsers(users, userName)
	}
	resources := make([]map[string]any, 0, len(users))
	for _, u := range users {
		resources = append(resources, scimUserResource(u))
	}
	writeJSON(w, http.StatusOK, scimList(resources))
}

// createSCIMUser provisions a user from a SCIM create.
func (s *Server) createSCIMUser(w http.ResponseWriter, t *Tenant, r *http.Request) {
	var body scimUserBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		scimError(w, http.StatusBadRequest, "unparseable user resource")
		return
	}
	if body.UserName == "" {
		scimError(w, http.StatusBadRequest, "userName is required")
		return
	}
	if _, exists := t.FindUser(body.UserName); exists {
		scimError(w, http.StatusConflict, "userName already exists")
		return
	}
	u := body.toUser(fmt.Sprintf("t%d-scim-%s", t.ID, randomToken()[:8]))
	t.AddUser(u)
	s.record(t, Event{
		Kind:    "scim.user.create",
		Outcome: OutcomeOK,
		Subject: u.Email,
		Detail:  "provisioned " + u.UserName + " over SCIM",
	})
	writeJSON(w, http.StatusCreated, scimUserResource(u))
}

// handleSCIMUser reads, replaces, patches and deletes one user.
func (s *Server) handleSCIMUser(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if !s.scimAuthorized(t, w, r) {
		return
	}
	u, ok := t.UserByID(r.PathValue("id"))
	if !ok {
		scimError(w, http.StatusNotFound, "no such user")
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, scimUserResource(u))
	case http.MethodPut:
		var body scimUserBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			scimError(w, http.StatusBadRequest, "unparseable user resource")
			return
		}
		body.applyTo(u)
		writeJSON(w, http.StatusOK, scimUserResource(u))
	case http.MethodPatch:
		s.patchSCIMUser(w, r, scimUserTarget{Tenant: t, User: u})
	case http.MethodDelete:
		t.RemoveUser(u.ID)
		s.record(t, Event{
			Kind:    "scim.user.delete",
			Outcome: OutcomeOK,
			Subject: u.Email,
			Detail:  "deprovisioned " + u.UserName + " over SCIM",
		})
		w.WriteHeader(http.StatusNoContent)
	default:
		scimError(w, http.StatusMethodNotAllowed, "unsupported method")
	}
}

// patchSCIMUser applies a PATCH and records it in the words that matter to
// someone watching the feed: deactivation is what provisioning is usually
// doing, and it should not read as a generic "updated".
func (s *Server) patchSCIMUser(w http.ResponseWriter, r *http.Request, target scimUserTarget) {
	u := target.User
	wasActive := u.Active
	if !applySCIMPatch(w, r, func(path string, value any) {
		applyUserPatch(u, path, value)
	}) {
		return
	}
	s.record(target.Tenant, Event{
		Kind:    "scim.user.update",
		Outcome: OutcomeOK,
		Subject: u.Email,
		Detail:  patchDetail(u, wasActive),
	})
	writeJSON(w, http.StatusOK, scimUserResource(u))
}

// scimUserTarget is the user a SCIM operation resolved to, and the tenant it
// belongs to.
type scimUserTarget struct {
	Tenant *Tenant
	User   *User
}

func patchDetail(u *User, wasActive bool) string {
	switch {
	case wasActive == u.Active:
		return "updated " + u.UserName + " over SCIM"
	case u.Active:
		return "reactivated " + u.UserName + " over SCIM"
	default:
		return "deactivated " + u.UserName + " over SCIM"
	}
}

// scimUserBody is the subset of a SCIM user resource the simulator stores.
type scimUserBody struct {
	UserName string `json:"userName"`
	Name     struct {
		GivenName  string `json:"givenName"`
		FamilyName string `json:"familyName"`
	} `json:"name"`
	Emails []struct {
		Value   string `json:"value"`
		Primary bool   `json:"primary"`
	} `json:"emails"`
	Active     *bool  `json:"active"`
	ExternalID string `json:"externalId"`
}

func (b scimUserBody) toUser(id string) *User {
	u := &User{ID: id, Active: true}
	b.applyTo(u)
	return u
}

func (b scimUserBody) applyTo(u *User) {
	u.UserName = b.UserName
	u.GivenName = b.Name.GivenName
	u.FamilyName = b.Name.FamilyName
	u.ExternalID = b.ExternalID
	u.Email = b.UserName
	for _, e := range b.Emails {
		if e.Primary || u.Email == b.UserName {
			u.Email = e.Value
		}
	}
	if b.Active != nil {
		u.Active = *b.Active
	}
}

// applySCIMPatch decodes a PatchOp body and feeds each replace/add operation to
// apply. Operations are matched case-insensitively, the way real IdPs send
// them. Returns false after writing an error response.
func applySCIMPatch(w http.ResponseWriter, r *http.Request, apply func(path string, value any)) bool {
	var body struct {
		Operations []struct {
			Op    string `json:"op"`
			Path  string `json:"path"`
			Value any    `json:"value"`
		} `json:"Operations"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		scimError(w, http.StatusBadRequest, "unparseable patch body")
		return false
	}
	for _, op := range body.Operations {
		switch strings.ToLower(op.Op) {
		case "replace", "add":
			apply(strings.ToLower(op.Path), op.Value)
		case "remove":
			apply("remove:"+strings.ToLower(op.Path), op.Value)
		default:
			scimError(w, http.StatusBadRequest, fmt.Sprintf("unsupported patch op %q", op.Op))
			return false
		}
	}
	return true
}

// applyUserPatch mutates one user for one patch operation. A pathless replace
// carries a value object whose keys are the paths.
// userPatchSetters is the set of user attributes a PATCH may address, keyed by
// the lowercased SCIM path. A table rather than a switch, so adding an
// attribute is one line and no branch.
var userPatchSetters = map[string]func(*User, any){
	"active":          func(u *User, v any) { u.Active = valueAsBool(v) },
	"username":        func(u *User, v any) { setString(&u.UserName, v) },
	"name.givenname":  func(u *User, v any) { setString(&u.GivenName, v) },
	"name.familyname": func(u *User, v any) { setString(&u.FamilyName, v) },
	"externalid":      func(u *User, v any) { setString(&u.ExternalID, v) },
}

func applyUserPatch(u *User, path string, value any) {
	// A pathless operation carries an object whose keys are themselves the
	// paths — the shape most identity providers actually send.
	if path == "" {
		for key, v := range pathlessValues(value) {
			applyUserPatch(u, key, v)
		}
		return
	}
	if set, ok := userPatchSetters[path]; ok {
		set(u, value)
	}
}

// pathlessValues reads the {path: value} object of a pathless operation,
// lowercasing the keys. A value that is not an object yields nothing.
func pathlessValues(value any) map[string]any {
	m, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	out := make(map[string]any, len(m))
	for k, v := range m {
		out[strings.ToLower(k)] = v
	}
	return out
}

// setString assigns only when the patch actually carried a string, so a
// malformed operation leaves the attribute alone rather than blanking it.
func setString(dst *string, value any) {
	if s, ok := value.(string); ok {
		*dst = s
	}
}

// valueAsBool tolerates the boolean spellings IdPs actually send: true,
// "True", "false"…
func valueAsBool(v any) bool {
	switch b := v.(type) {
	case bool:
		return b
	case string:
		return strings.EqualFold(b, "true")
	default:
		return false
	}
}

// handleSCIMGroups lists and creates groups.
func (s *Server) handleSCIMGroups(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if !s.scimAuthorized(t, w, r) {
		return
	}
	switch r.Method {
	case http.MethodGet:
		groups := t.Groups()
		resources := make([]map[string]any, 0, len(groups))
		for _, g := range groups {
			resources = append(resources, scimGroupResource(t, g))
		}
		writeJSON(w, http.StatusOK, scimList(resources))
	case http.MethodPost:
		var body scimGroupBody
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.DisplayName == "" {
			scimError(w, http.StatusBadRequest, "a group needs a displayName")
			return
		}
		g := &Group{
			ID:        fmt.Sprintf("t%d-group-%s", t.ID, randomToken()[:8]),
			Name:      body.DisplayName,
			MemberIDs: body.memberIDs(),
		}
		t.AddGroup(g)
		s.record(t, Event{
			Kind:    "scim.group.create",
			Outcome: OutcomeOK,
			Detail:  fmt.Sprintf("created the group %s with %d member(s) over SCIM", g.Name, len(g.MemberIDs)),
		})
		writeJSON(w, http.StatusCreated, scimGroupResource(t, g))
	default:
		scimError(w, http.StatusMethodNotAllowed, "unsupported method")
	}
}

// handleSCIMGroup reads, patches and deletes one group.
func (s *Server) handleSCIMGroup(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if !s.scimAuthorized(t, w, r) {
		return
	}
	g, ok := t.GroupByID(r.PathValue("id"))
	if !ok {
		scimError(w, http.StatusNotFound, "no such group")
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, scimGroupResource(t, g))
	case http.MethodPatch:
		if !applySCIMPatch(w, r, func(path string, value any) {
			applyGroupPatch(g, path, value)
		}) {
			return
		}
		writeJSON(w, http.StatusOK, scimGroupResource(t, g))
	case http.MethodDelete:
		t.RemoveGroup(g.ID)
		w.WriteHeader(http.StatusNoContent)
	default:
		scimError(w, http.StatusMethodNotAllowed, "unsupported method")
	}
}

type scimGroupBody struct {
	DisplayName string `json:"displayName"`
	Members     []struct {
		Value string `json:"value"`
	} `json:"members"`
}

func (b scimGroupBody) memberIDs() []string {
	ids := make([]string, 0, len(b.Members))
	for _, m := range b.Members {
		ids = append(ids, m.Value)
	}
	return ids
}

// groupPatchSetters is the set of group attributes a PATCH may address, keyed
// by the lowercased SCIM path ("remove:" prefixed for removals).
var groupPatchSetters = map[string]func(*Group, any){
	"displayname":    func(g *Group, v any) { setString(&g.Name, v) },
	"members":        func(g *Group, v any) { g.MemberIDs = append(g.MemberIDs, patchMemberIDs(v)...) },
	"remove:members": func(g *Group, v any) { g.MemberIDs = withoutMembers(g.MemberIDs, patchMemberIDs(v)) },
}

func applyGroupPatch(g *Group, path string, value any) {
	if path == "" {
		for key, v := range pathlessValues(value) {
			applyGroupPatch(g, key, v)
		}
		return
	}
	if set, ok := groupPatchSetters[path]; ok {
		set(g, value)
	}
}

// withoutMembers drops the named members, preserving the order of the rest.
func withoutMembers(members, removing []string) []string {
	removed := make(map[string]bool, len(removing))
	for _, id := range removing {
		removed[id] = true
	}
	kept := make([]string, 0, len(members))
	for _, id := range members {
		if !removed[id] {
			kept = append(kept, id)
		}
	}
	return kept
}

func patchMemberIDs(value any) []string {
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	var ids []string
	for _, item := range list {
		if m, ok := item.(map[string]any); ok {
			if v, ok := m["value"].(string); ok {
				ids = append(ids, v)
			}
		}
	}
	return ids
}

// parseEqFilter reads the one filter shape IdP clients use for lookups:
// `<attr> eq "<value>"`.
func parseEqFilter(filter, attr string) (string, bool) {
	filter = strings.TrimSpace(filter)
	prefix := attr + " eq "
	if !strings.HasPrefix(strings.ToLower(filter), strings.ToLower(prefix)) {
		return "", false
	}
	value := strings.TrimSpace(filter[len(prefix):])
	return strings.Trim(value, `"`), true
}

func filterUsers(users []*User, userName string) []*User {
	var out []*User
	for _, u := range users {
		if strings.EqualFold(u.UserName, userName) {
			out = append(out, u)
		}
	}
	return out
}
