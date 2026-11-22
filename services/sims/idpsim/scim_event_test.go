package idpsim

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// recordingProvider answers every SCIM call and keeps what it was sent. A
// filtered list names one resource with id "sp-1", which is what a lookup
// before a write expects to find.
type recordingProvider struct {
	mu   sync.Mutex
	seen []recordedCall
}

type recordedCall struct {
	Method string
	URL    string
	Body   map[string]any
}

func (p *recordingProvider) serve(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	call := recordedCall{Method: r.Method, URL: r.URL.RequestURI()}
	_ = json.Unmarshal(raw, &call.Body)
	p.mu.Lock()
	p.seen = append(p.seen, call)
	p.mu.Unlock()
	w.Header().Set("Content-Type", "application/scim+json")
	if r.Method == http.MethodGet {
		_, _ = w.Write([]byte(`{"totalResults":1,"Resources":[{"id":"sp-1"}]}`))
		return
	}
	if r.Method == http.MethodDelete {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	_, _ = w.Write(raw)
}

func emitSCIMEvent(t *testing.T, req SCIMEventRequest) (SCIMEventResult, []recordedCall, int) {
	t.Helper()
	provider := &recordingProvider{}
	target := httptest.NewServer(http.HandlerFunc(provider.serve))
	t.Cleanup(target.Close)
	s := newTestServer(t, 1)
	body := map[string]any{"target": target.URL + "/api/scim/v2", "token": "sp-token"}
	encoded, _ := json.Marshal(req)
	_ = json.Unmarshal(encoded, &body)
	payload, _ := json.Marshal(body)
	httpReq := httptest.NewRequest(http.MethodPost, "/control/t/1/scim-event", strings.NewReader(string(payload)))
	httpReq.SetPathValue("tenant", "1")
	rec := httptest.NewRecorder()
	s.handleControlSCIMEvent(rec, httpReq)
	var result SCIMEventResult
	if rec.Code == http.StatusOK {
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &result))
	}
	return result, provider.seen, rec.Code
}

// jsonOf normalises a Go value to what it looks like after a JSON round trip.
func jsonOf(t *testing.T, v any) any {
	t.Helper()
	raw, err := json.Marshal(v)
	require.NoError(t, err)
	var out any
	require.NoError(t, json.Unmarshal(raw, &out))
	return out
}

func patchOf(ops ...map[string]any) any {
	return map[string]any{"schemas": []any{scimPatchOpSchema}, "Operations": ops}
}

func TestSCIMEventUserPatchEntraSendsOneOpPerPath(t *testing.T) {
	result, seen, code := emitSCIMEvent(t, SCIMEventRequest{
		Kind: "user.patch", Style: "entra", ID: "sp-9",
		Set: map[string]any{"familyName": "Lovelace", "email": "ada@example.com", "active": false},
	})
	require.Equal(t, http.StatusOK, code)
	require.Len(t, seen, 1)
	assert.Equal(t, http.MethodPatch, seen[0].Method)
	assert.Equal(t, "/api/scim/v2/Users/sp-9", seen[0].URL)
	assert.Equal(t, jsonOf(t, patchOf(
		map[string]any{"op": "Replace", "path": "name.familyName", "value": "Lovelace"},
		map[string]any{"op": "Replace", "path": `emails[type eq "work"].value`, "value": "ada@example.com"},
		map[string]any{"op": "Replace", "path": "active", "value": false},
	)), jsonOf(t, seen[0].Body))
	assert.Equal(t, http.StatusOK, result.SCIMEvent.Response.Status)
}

func TestSCIMEventUserPatchOktaSendsOneValueObject(t *testing.T) {
	_, seen, code := emitSCIMEvent(t, SCIMEventRequest{
		Kind: "user.patch", Style: "okta", ID: "sp-9",
		Set: map[string]any{"givenName": "Ada", "userName": "ada@example.com"},
	})
	require.Equal(t, http.StatusOK, code)
	assert.Equal(t, jsonOf(t, patchOf(map[string]any{"op": "replace", "value": map[string]any{
		"name": map[string]any{"givenName": "Ada"}, "userName": "ada@example.com",
	}})), jsonOf(t, seen[0].Body))
}

func TestSCIMEventDeactivateLooksUpTheUserFirst(t *testing.T) {
	result, seen, code := emitSCIMEvent(t, SCIMEventRequest{Kind: "user.deactivate", User: "ada@example.com"})
	require.Equal(t, http.StatusOK, code)
	require.Len(t, seen, 2)
	assert.Equal(t, `/api/scim/v2/Users?filter=userName+eq+%22ada%40example.com%22`, seen[0].URL)
	assert.Equal(t, "/api/scim/v2/Users/sp-1", seen[1].URL)
	assert.Equal(t, jsonOf(t, patchOf(map[string]any{"op": "replace", "value": map[string]any{"active": false}})),
		jsonOf(t, seen[1].Body))
	assert.Len(t, result.Lookups, 1)
}

func TestSCIMEventCreateInactiveWithoutExternalIDCarriesTheEnterpriseExtension(t *testing.T) {
	_, seen, code := emitSCIMEvent(t, SCIMEventRequest{
		Kind: "user.create", Inactive: true, NoExternalID: true,
		Set:        map[string]any{"userName": "grace@example.com", "givenName": "Grace"},
		Enterprise: &SCIMEnterpriseAttrs{Department: "Research", CostCenter: "CC-42", Manager: "sp-7"},
	})
	require.Equal(t, http.StatusOK, code)
	body := seen[0].Body
	assert.Equal(t, http.MethodPost, seen[0].Method)
	assert.Equal(t, false, body["active"])
	assert.NotContains(t, body, "externalId")
	assert.NotContains(t, body, "id")
	assert.Equal(t, []any{scimUserSchema, scimEnterpriseSchema}, body["schemas"])
	assert.Equal(t, map[string]any{
		"department": "Research", "costCenter": "CC-42", "manager": map[string]any{"value": "sp-7"},
	}, body[scimEnterpriseSchema])
}

func TestSCIMEventGroupMembershipOps(t *testing.T) {
	member := []any{map[string]any{"value": "sp-u"}}
	cases := []struct {
		kind, style string
		want        map[string]any
	}{
		{"group.add-member", "okta", map[string]any{"op": "add", "path": "members", "value": member}},
		{"group.add-member", "entra", map[string]any{"op": "Add", "path": "members", "value": member}},
		{"group.remove-member", "okta", map[string]any{"op": "remove", "path": `members[value eq "sp-u"]`}},
		{"group.remove-member", "entra", map[string]any{"op": "Remove", "path": "members", "value": member}},
	}
	for _, c := range cases {
		t.Run(c.kind+"/"+c.style, func(t *testing.T) {
			_, seen, code := emitSCIMEvent(t, SCIMEventRequest{Kind: c.kind, Style: c.style, ID: "sp-g", MemberID: "sp-u"})
			require.Equal(t, http.StatusOK, code)
			assert.Equal(t, "/api/scim/v2/Groups/sp-g", seen[0].URL)
			assert.Equal(t, jsonOf(t, patchOf(c.want)), jsonOf(t, seen[0].Body))
		})
	}
}

func TestSCIMEventGroupRenameAndDelete(t *testing.T) {
	_, seen, _ := emitSCIMEvent(t, SCIMEventRequest{
		Kind: "group.rename", Style: "entra", ID: "sp-g", Set: map[string]any{"displayName": "Platform"},
	})
	assert.Equal(t, jsonOf(t, patchOf(map[string]any{"op": "Replace", "path": "displayName", "value": "Platform"})),
		jsonOf(t, seen[0].Body))

	_, seen, _ = emitSCIMEvent(t, SCIMEventRequest{
		Kind: "group.rename", ID: "sp-g", Set: map[string]any{"displayName": "Platform"},
	})
	assert.Equal(t, jsonOf(t, patchOf(map[string]any{"op": "replace", "value": map[string]any{"displayName": "Platform"}})),
		jsonOf(t, seen[0].Body))

	result, seen, _ := emitSCIMEvent(t, SCIMEventRequest{Kind: "group.delete", Group: "Engineering"})
	assert.Equal(t, `/api/scim/v2/Groups?filter=displayName+eq+%22Engineering%22`, seen[0].URL)
	assert.Equal(t, http.MethodDelete, seen[1].Method)
	assert.Equal(t, http.StatusNoContent, result.SCIMEvent.Response.Status)
}

func TestSCIMEventRefusesAnUnknownKind(t *testing.T) {
	_, seen, code := emitSCIMEvent(t, SCIMEventRequest{Kind: "bulk"})
	assert.Equal(t, http.StatusBadRequest, code)
	assert.Empty(t, seen)
}
