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
		s.record(t, "scim.auth", OutcomeRefused, "", "",
			"a SCIM request arrived with a missing or wrong bearer token")
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
		users := t.Users()
		if userName, ok := parseEqFilter(r.URL.Query().Get("filter"), "userName"); ok {
			users = filterUsers(users, userName)
		}
		resources := make([]map[string]any, 0, len(users))
		for _, u := range users {
			resources = append(resources, scimUserResource(u))
		}
		writeJSON(w, http.StatusOK, scimList(resources))
	case http.MethodPost:
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
		s.record(t, "scim.user.create", OutcomeOK, "", u.Email, "provisioned "+u.UserName+" over SCIM")
		writeJSON(w, http.StatusCreated, scimUserResource(u))
	default:
		scimError(w, http.StatusMethodNotAllowed, "unsupported method")
	}
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
		wasActive := u.Active
		if !applySCIMPatch(w, r, func(path string, value any) {
			applyUserPatch(u, path, value)
		}) {
			return
		}
		detail := "updated " + u.UserName + " over SCIM"
		if wasActive != u.Active {
			detail = "deactivated " + u.UserName + " over SCIM"
			if u.Active {
				detail = "reactivated " + u.UserName + " over SCIM"
			}
		}
		s.record(t, "scim.user.update", OutcomeOK, "", u.Email, detail)
		writeJSON(w, http.StatusOK, scimUserResource(u))
	case http.MethodDelete:
		t.RemoveUser(u.ID)
		s.record(t, "scim.user.delete", OutcomeOK, "", u.Email, "deprovisioned "+u.UserName+" over SCIM")
		w.WriteHeader(http.StatusNoContent)
	default:
		scimError(w, http.StatusMethodNotAllowed, "unsupported method")
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
func applyUserPatch(u *User, path string, value any) {
	switch path {
	case "":
		if m, ok := value.(map[string]any); ok {
			for k, v := range m {
				applyUserPatch(u, strings.ToLower(k), v)
			}
		}
	case "active":
		u.Active = valueAsBool(value)
	case "username":
		if s, ok := value.(string); ok {
			u.UserName = s
		}
	case "name.givenname":
		if s, ok := value.(string); ok {
			u.GivenName = s
		}
	case "name.familyname":
		if s, ok := value.(string); ok {
			u.FamilyName = s
		}
	case "externalid":
		if s, ok := value.(string); ok {
			u.ExternalID = s
		}
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
		s.record(t, "scim.group.create", OutcomeOK, "", "",
			fmt.Sprintf("created the group %s with %d member(s) over SCIM", g.Name, len(g.MemberIDs)))
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

func applyGroupPatch(g *Group, path string, value any) {
	switch path {
	case "displayname":
		if s, ok := value.(string); ok {
			g.Name = s
		}
	case "members":
		g.MemberIDs = append(g.MemberIDs, patchMemberIDs(value)...)
	case "remove:members":
		removed := map[string]bool{}
		for _, id := range patchMemberIDs(value) {
			removed[id] = true
		}
		kept := g.MemberIDs[:0]
		for _, id := range g.MemberIDs {
			if !removed[id] {
				kept = append(kept, id)
			}
		}
		g.MemberIDs = kept
	case "":
		if m, ok := value.(map[string]any); ok {
			for k, v := range m {
				applyGroupPatch(g, strings.ToLower(k), v)
			}
		}
	}
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
