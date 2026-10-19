package idpsim

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// One SCIM event on demand: the control API names a kind, idpsim sends that
// single request the way Okta or Entra would and answers with both halves of
// the exchange, so a test can assert on exactly what crossed the wire.

const (
	scimPatchOpSchema      = "urn:ietf:params:scim:api:messages:2.0:PatchOp"
	scimEnterpriseSchema   = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
	scimPatchStyleOkta     = "okta"
	scimPatchStyleEntra    = "entra"
	maxSCIMEventBodyBytes  = 1 << 20
	maxSCIMEventReplyBytes = 1 << 20
)

// scimEventKinds is every event the product's SCIM endpoint accepts. Bulk is
// absent: the product does not advertise it in ServiceProviderConfig.
var scimEventKinds = []string{
	"user.lookup", "user.create", "user.replace", "user.patch",
	"user.deactivate", "user.reactivate", "user.delete",
	"group.lookup", "group.create", "group.add-member", "group.remove-member",
	"group.rename", "group.delete",
}

// SCIMEventRequest is the body of `POST /control/t/{tenant}/scim-event`.
type SCIMEventRequest struct {
	Kind string `json:"kind"`
	// Style picks the PATCH spelling: okta (value objects) or entra (paths).
	Style string `json:"style,omitempty"`
	// User and Group name a directory entry by id, userName, email or name.
	User  string `json:"user,omitempty"`
	Group string `json:"group,omitempty"`
	// ID and MemberID are the receiving side's ids; looked up when absent.
	ID       string `json:"id,omitempty"`
	MemberID string `json:"memberId,omitempty"`
	// Set overrides attributes: givenName, familyName, userName, email,
	// active, displayName. On a patch it is exactly what changes.
	Set          map[string]any       `json:"set,omitempty"`
	Inactive     bool                 `json:"inactive,omitempty"`
	NoExternalID bool                 `json:"noExternalId,omitempty"`
	Enterprise   *SCIMEnterpriseAttrs `json:"enterprise,omitempty"`
	// Body replaces the built body outright, for a payload no kind spells.
	Body map[string]any `json:"body,omitempty"`
}

// SCIMEnterpriseAttrs is the RFC 7643 section 4.3 extension idpsim can send.
type SCIMEnterpriseAttrs struct {
	Department string `json:"department,omitempty"`
	CostCenter string `json:"costCenter,omitempty"`
	Manager    string `json:"manager,omitempty"`
}

// SCIMExchange is one request idpsim sent and what the target answered.
type SCIMExchange struct {
	Request  SCIMEventWire  `json:"request"`
	Response SCIMEventReply `json:"response"`
}

// SCIMEventWire is one SCIM request as idpsim sent it.
type SCIMEventWire struct {
	Method string         `json:"method"`
	URL    string         `json:"url"`
	Body   map[string]any `json:"body,omitempty"`
}

// SCIMEventReply is the target's answer to one SCIMEventWire.
type SCIMEventReply struct {
	Status int `json:"status"`
	Body   any `json:"body,omitempty"`
}

// SCIMEventResult lists the lookups an id needed, then the event itself.
type SCIMEventResult struct {
	Kind      string         `json:"kind"`
	Lookups   []SCIMExchange `json:"lookups,omitempty"`
	SCIMEvent SCIMExchange   `json:"event"`
}

// handleControlSCIMEvent sends one SCIM event to the tenant's target.
func (s *Server) handleControlSCIMEvent(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxSCIMEventBodyBytes))
	if err != nil {
		http.Error(w, "unreadable event", http.StatusBadRequest)
		return
	}
	var req SCIMEventRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		http.Error(w, "unreadable event", http.StatusBadRequest)
		return
	}
	if !knownSCIMEventKind(req.Kind) {
		http.Error(w, "kind must be one of: "+strings.Join(scimEventKinds, ", "), http.StatusBadRequest)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(raw))
	t, target, ok := s.controlTarget(w, r)
	if !ok {
		return
	}
	result, err := sendSCIMEvent(r.Context(), scimEventRun{tenant: t, target: target, req: req})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	s.record(t, Event{
		Kind:    "scim.event",
		Outcome: outcomeOf(result.SCIMEvent.Response.Status < 300),
		Detail: fmt.Sprintf("%s answered %d at %s",
			req.Kind, result.SCIMEvent.Response.Status, target.BaseURL),
	})
	writeJSON(w, http.StatusOK, result)
}

func knownSCIMEventKind(kind string) bool {
	for _, known := range scimEventKinds {
		if known == kind {
			return true
		}
	}
	return false
}

type scimEventRun struct {
	tenant *Tenant
	target ProvisioningTarget
	req    SCIMEventRequest
	client *http.Client
	result SCIMEventResult
}

// sendSCIMEvent builds the event, resolving any id it needs first.
func sendSCIMEvent(ctx context.Context, run scimEventRun) (SCIMEventResult, error) {
	run.client = &http.Client{Timeout: 15 * time.Second}
	run.result.Kind = run.req.Kind
	wire, err := run.build(ctx)
	if err != nil {
		return run.result, err
	}
	if run.req.Body != nil {
		wire.Body = run.req.Body
	}
	run.result.SCIMEvent, err = scimExchange(ctx, scimConn{Client: run.client, Token: run.target.Token}, wire)
	return run.result, err
}

func (run *scimEventRun) build(ctx context.Context) (SCIMEventWire, error) {
	base := strings.TrimRight(run.target.BaseURL, "/")
	req := run.req
	switch req.Kind {
	case "user.lookup":
		return run.userLookupWire(), nil
	case "group.lookup":
		return run.groupLookupWire(), nil
	case "user.create":
		user, err := run.user()
		return SCIMEventWire{Method: http.MethodPost, URL: base + "/Users", Body: run.userBody(user)}, err
	case "group.create":
		return SCIMEventWire{Method: http.MethodPost, URL: base + "/Groups", Body: map[string]any{
			"schemas": []string{scimGroupSchema}, "displayName": run.groupName(), "members": []any{},
		}}, nil
	}
	if strings.HasPrefix(req.Kind, "user.") {
		id, err := run.userID(ctx)
		if err != nil {
			return SCIMEventWire{}, err
		}
		at := base + "/Users/" + url.PathEscape(id)
		switch req.Kind {
		case "user.replace":
			user, err := run.user()
			return SCIMEventWire{Method: http.MethodPut, URL: at, Body: run.userBody(user)}, err
		case "user.patch":
			return SCIMEventWire{Method: http.MethodPatch, URL: at, Body: userPatchBody(req.Style, req.Set)}, nil
		case "user.deactivate", "user.reactivate":
			set := map[string]any{"active": req.Kind == "user.reactivate"}
			return SCIMEventWire{Method: http.MethodPatch, URL: at, Body: userPatchBody(req.Style, set)}, nil
		}
		return SCIMEventWire{Method: http.MethodDelete, URL: at}, nil
	}
	id, err := run.groupID(ctx)
	if err != nil {
		return SCIMEventWire{}, err
	}
	at := base + "/Groups/" + url.PathEscape(id)
	switch req.Kind {
	case "group.add-member", "group.remove-member":
		member, err := run.memberID(ctx)
		if err != nil {
			return SCIMEventWire{}, err
		}
		return SCIMEventWire{Method: http.MethodPatch, URL: at, Body: groupMemberPatchBody(groupMemberPatch{
			Style: req.Style, Add: req.Kind == "group.add-member", MemberID: member,
		})}, nil
	case "group.rename":
		return SCIMEventWire{Method: http.MethodPatch, URL: at, Body: groupRenamePatchBody(req.Style, run.groupName())}, nil
	}
	return SCIMEventWire{Method: http.MethodDelete, URL: at}, nil
}

// user is the directory entry named by `user`, or a blank one built from `set`.
func (run *scimEventRun) user() (User, error) {
	user := User{Active: true}
	if run.req.User != "" {
		found, ok := run.tenant.FindUser(run.req.User)
		if !ok {
			return User{}, fmt.Errorf("no user %q in this tenant", run.req.User)
		}
		user = *found
	}
	applyUserSet(&user, run.req.Set)
	if user.Email == "" {
		user.Email = user.UserName
	}
	if user.UserName == "" {
		return User{}, fmt.Errorf("%s needs a user or set.userName", run.req.Kind)
	}
	if user.ExternalID == "" && !run.req.NoExternalID {
		user.ExternalID = "idpsim-" + user.UserName
	}
	return user, nil
}

// applyUserSet overlays the string fields `set` names onto the user.
func applyUserSet(user *User, set map[string]any) {
	fields := map[string]*string{
		"givenName": &user.GivenName, "familyName": &user.FamilyName,
		"userName": &user.UserName, "email": &user.Email,
	}
	for key, field := range fields {
		if v, ok := set[key].(string); ok {
			*field = v
		}
	}
}

// userBody is the POST or PUT resource with the run's flags applied.
func (run *scimEventRun) userBody(user User) map[string]any {
	if run.req.NoExternalID {
		user.ExternalID = ""
	}
	body := withoutKey(scimUserResource(&user), "id")
	if v, ok := run.req.Set["active"].(bool); ok {
		body["active"] = v
	}
	if run.req.Inactive {
		body["active"] = false
	}
	if ext := run.req.Enterprise; ext != nil {
		body["schemas"] = []string{scimUserSchema, scimEnterpriseSchema}
		body[scimEnterpriseSchema] = enterpriseExtension(*ext)
	}
	return body
}

func enterpriseExtension(ext SCIMEnterpriseAttrs) map[string]any {
	out := map[string]any{}
	if ext.Department != "" {
		out["department"] = ext.Department
	}
	if ext.CostCenter != "" {
		out["costCenter"] = ext.CostCenter
	}
	if ext.Manager != "" {
		out["manager"] = map[string]any{"value": ext.Manager}
	}
	return out
}

func (run *scimEventRun) groupName() string {
	if v, ok := run.req.Set["displayName"].(string); ok && v != "" {
		return v
	}
	if g, ok := run.findGroup(); ok {
		return g.Name
	}
	return run.req.Group
}

func (run *scimEventRun) findGroup() (*Group, bool) {
	for _, g := range run.tenant.Groups() {
		if g.ID == run.req.Group || g.Name == run.req.Group {
			return g, true
		}
	}
	return nil, false
}

// lookupUserName is what a pre-create check filters on.
func (run *scimEventRun) lookupUserName() string {
	if v, ok := run.req.Set["userName"].(string); ok && v != "" && run.req.Kind == "user.lookup" {
		return v
	}
	if u, ok := run.tenant.FindUser(run.req.User); ok {
		return u.UserName
	}
	return run.req.User
}

func (run *scimEventRun) userLookupWire() SCIMEventWire {
	return filterWire(scimFilter{Base: run.target.BaseURL, Collection: "/Users", Attribute: "userName", Value: run.lookupUserName()})
}

func (run *scimEventRun) groupLookupWire() SCIMEventWire {
	name := run.req.Group
	if g, ok := run.findGroup(); ok {
		name = g.Name
	}
	return filterWire(scimFilter{Base: run.target.BaseURL, Collection: "/Groups", Attribute: "displayName", Value: name})
}

// filterWire is the `attr eq "value"` lookup Okta sends before a create.
// scimFilter is one `attribute eq "value"` lookup against a collection.
type scimFilter struct{ Base, Collection, Attribute, Value string }

func filterWire(f scimFilter) SCIMEventWire {
	base, collection := f.Base, f.Collection
	filter := fmt.Sprintf("%s eq %q", f.Attribute, f.Value)
	return SCIMEventWire{
		Method: http.MethodGet,
		URL:    strings.TrimRight(base, "/") + collection + "?filter=" + url.QueryEscape(filter),
	}
}

func (run *scimEventRun) userID(ctx context.Context) (string, error) {
	if run.req.ID != "" {
		return run.req.ID, nil
	}
	return run.lookupID(ctx, run.userLookupWire())
}

func (run *scimEventRun) groupID(ctx context.Context) (string, error) {
	if run.req.ID != "" {
		return run.req.ID, nil
	}
	return run.lookupID(ctx, run.groupLookupWire())
}

func (run *scimEventRun) memberID(ctx context.Context) (string, error) {
	if run.req.MemberID != "" {
		return run.req.MemberID, nil
	}
	if run.req.User == "" {
		return "", fmt.Errorf("%s needs memberId or user", run.req.Kind)
	}
	return run.lookupID(ctx, run.userLookupWire())
}

// lookupID runs a filtered GET and takes the one id it names.
func (run *scimEventRun) lookupID(ctx context.Context, wire SCIMEventWire) (string, error) {
	exchange, err := scimExchange(ctx, scimConn{Client: run.client, Token: run.target.Token}, wire)
	run.result.Lookups = append(run.result.Lookups, exchange)
	if err != nil {
		return "", err
	}
	listed, _ := exchange.Response.Body.(map[string]any)
	resources, _ := listed["Resources"].([]any)
	if exchange.Response.Status != http.StatusOK || len(resources) != 1 {
		return "", fmt.Errorf("lookup %s found %d resources (status %d); pass id", wire.URL, len(resources), exchange.Response.Status)
	}
	resource, _ := resources[0].(map[string]any)
	return stringField(resource, "id"), nil
}

// userPatchBody spells a partial user update. Entra sends one op per path
// with a title-case verb; Okta sends one replace carrying a value object.
func userPatchBody(style string, set map[string]any) map[string]any {
	ops := []map[string]any{}
	if style == scimPatchStyleEntra {
		for _, key := range sortedSetKeys(set) {
			ops = append(ops, map[string]any{"op": "Replace", "path": entraPath(key), "value": set[key]})
		}
	} else {
		ops = append(ops, map[string]any{"op": "replace", "value": oktaValue(set)})
	}
	return map[string]any{"schemas": []string{scimPatchOpSchema}, "Operations": ops}
}

// patchKeyOrder fixes the op order so a test can compare bodies.
var patchKeyOrder = []string{"givenName", "familyName", "userName", "email", "active", "displayName"}

func sortedSetKeys(set map[string]any) []string {
	keys := []string{}
	for _, key := range patchKeyOrder {
		if _, ok := set[key]; ok {
			keys = append(keys, key)
		}
	}
	return keys
}

func entraPath(key string) string {
	switch key {
	case "givenName", "familyName":
		return "name." + key
	case "email":
		return `emails[type eq "work"].value`
	}
	return key
}

func oktaValue(set map[string]any) map[string]any {
	value := map[string]any{}
	name := map[string]any{}
	for _, key := range sortedSetKeys(set) {
		switch key {
		case "givenName", "familyName":
			name[key] = set[key]
		case "email":
			value["emails"] = []map[string]any{{"value": set[key], "primary": true, "type": "work"}}
		default:
			value[key] = set[key]
		}
	}
	if len(name) > 0 {
		value["name"] = name
	}
	return value
}

type groupMemberPatch struct {
	Style    string
	Add      bool
	MemberID string
}

// groupMemberPatchBody adds or removes one member. Okta removes by a filtered
// path; Entra removes with a value list, as RFC 7644 section 3.5.2.2 allows.
func groupMemberPatchBody(p groupMemberPatch) map[string]any {
	member := []map[string]any{{"value": p.MemberID}}
	op := map[string]any{"op": "add", "path": "members", "value": member}
	switch {
	case !p.Add && p.Style == scimPatchStyleEntra:
		op = map[string]any{"op": "Remove", "path": "members", "value": member}
	case !p.Add:
		op = map[string]any{"op": "remove", "path": fmt.Sprintf("members[value eq %q]", p.MemberID)}
	case p.Style == scimPatchStyleEntra:
		op["op"] = "Add"
	}
	return map[string]any{"schemas": []string{scimPatchOpSchema}, "Operations": []map[string]any{op}}
}

func groupRenamePatchBody(style, name string) map[string]any {
	op := map[string]any{"op": "replace", "value": map[string]any{"displayName": name}}
	if style == scimPatchStyleEntra {
		op = map[string]any{"op": "Replace", "path": "displayName", "value": name}
	}
	return map[string]any{"schemas": []string{scimPatchOpSchema}, "Operations": []map[string]any{op}}
}

// scimExchange sends one request and keeps the answer whatever its status.
// scimConn is the client and bearer token one exchange goes out on.
type scimConn struct {
	Client *http.Client
	Token  string
}

func scimExchange(ctx context.Context, conn scimConn, wire SCIMEventWire) (SCIMExchange, error) {
	client, token := conn.Client, conn.Token
	exchange := SCIMExchange{Request: wire}
	var body io.Reader = http.NoBody
	if wire.Body != nil {
		encoded, err := json.Marshal(wire.Body)
		if err != nil {
			return exchange, err
		}
		body = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, wire.Method, wire.URL, body)
	if err != nil {
		return exchange, err
	}
	if wire.Body != nil {
		req.Header.Set("Content-Type", "application/scim+json")
	}
	req.Header.Set("Accept", "application/scim+json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := client.Do(req)
	if err != nil {
		return exchange, err
	}
	defer func() { _ = resp.Body.Close() }()
	exchange.Response.Status = resp.StatusCode
	reply, err := io.ReadAll(io.LimitReader(resp.Body, maxSCIMEventReplyBytes))
	if err != nil || len(reply) == 0 {
		return exchange, err
	}
	var parsed any
	if json.Unmarshal(reply, &parsed) != nil {
		parsed = string(reply)
	}
	exchange.Response.Body = parsed
	return exchange, nil
}
