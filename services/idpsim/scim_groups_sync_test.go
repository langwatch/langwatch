package idpsim

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type groupServiceProvider struct {
	*pagingServiceProvider
	groups       map[string]map[string]any
	groupWrites  int
	refuseWrites bool
}

func (f *groupServiceProvider) serve(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path, "/Groups") {
		f.pagingServiceProvider.serve(w, r)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if r.Method == http.MethodGet {
		ids := make([]string, 0, len(f.groups))
		for id := range f.groups {
			ids = append(ids, id)
		}
		slices.Sort(ids)
		start, _ := strconv.Atoi(r.URL.Query().Get("startIndex"))
		start = max(0, start-1)
		// A server cap smaller than the requested page tests complete group readback.
		resources := []any{}
		for i := start; i < len(ids) && len(resources) < 2; i++ {
			resources = append(resources, f.groups[ids[i]])
		}
		writeJSON(w, http.StatusOK, map[string]any{"Resources": resources, "totalResults": len(ids)})
		return
	}
	if f.refuseWrites {
		http.Error(w, "group refused", http.StatusForbidden)
		return
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}
	members, _ := body["members"].([]any)
	for _, raw := range members {
		member, ok := raw.(map[string]any)
		if !ok || f.users[stringField(member, "value")] == nil {
			http.Error(w, "member must reference target id", http.StatusBadRequest)
			return
		}
	}
	var id string
	switch r.Method {
	case http.MethodPost:
		id = fmt.Sprintf("target-group-%d", len(f.groups)+1)
	case http.MethodPut:
		id = strings.TrimPrefix(r.URL.Path, "/Groups/")
		if f.groups[id] == nil {
			http.NotFound(w, r)
			return
		}
	default:
		http.Error(w, "unsupported method", http.StatusMethodNotAllowed)
		return
	}
	body["id"] = id
	f.groups[id] = body
	f.groupWrites++
	writeJSON(w, http.StatusOK, body)
}

func groupSyncFixture(t *testing.T) (*Tenant, *groupServiceProvider, syncRun) {
	t.Helper()
	source := newTestServer(t, 1)
	tenant, ok := source.Tenant(1)
	require.True(t, ok)
	tenant.Populate(PopulationSpec{Users: 12, Groups: 4})
	provider := &groupServiceProvider{pagingServiceProvider: newPagingServiceProvider(), groups: map[string]map[string]any{}}
	target := httptest.NewServer(http.HandlerFunc(provider.serve))
	t.Cleanup(target.Close)
	return tenant, provider, syncRun{tenant: tenant, target: syncTarget(target), opts: SyncOptions{Groups: true}}
}

// @scenario "Group sync references the receiving service's users and repeats without writes"
func TestGroupSyncUsesTargetIDsAndSkipsUnchangedMembership(t *testing.T) {
	t.Parallel()
	tenant, provider, run := groupSyncFixture(t)
	first := syncDirectory(context.Background(), run)
	require.Zero(t, first.FailureCount, first.Failures)
	require.Equal(t, 4, first.GroupsWritten)
	require.Len(t, provider.groups, 4)
	totalMembers := 0
	for _, group := range provider.groups {
		totalMembers += len(group["members"].([]any))
	}
	require.Positive(t, totalMembers)

	second := syncDirectory(context.Background(), run)
	require.Zero(t, second.FailureCount, second.Failures)
	assert.Equal(t, 12, second.Unchanged)
	assert.Zero(t, second.GroupsWritten)
	assert.Equal(t, 4, provider.groupWrites)

	local := tenant.Groups()[0]
	local.MemberIDs = []string{tenant.Users()[0].ID}
	changed := syncDirectory(context.Background(), run)
	require.Zero(t, changed.FailureCount, changed.Failures)
	require.Equal(t, 1, changed.GroupsWritten)
	require.Len(t, provider.groups, 4, "a replacement retains the target group")
	for _, group := range provider.groups {
		if group["externalId"] == local.ID {
			require.Len(t, group["members"].([]any), 1)
		}
	}
	again := syncDirectory(context.Background(), run)
	assert.Zero(t, again.GroupsWritten)
	assert.Zero(t, again.FailureCount)

	tenant.Users()[0].Active = false
	departed := syncDirectory(context.Background(), run)
	require.Zero(t, departed.FailureCount, departed.Failures)
	for _, group := range provider.groups {
		if group["externalId"] == local.ID {
			assert.Empty(t, group["members"], "inactive people no longer receive group membership")
		}
	}
}

// @scenario "Group sync reports target failures instead of claiming success"
func TestGroupSyncReportsRejectedWrites(t *testing.T) {
	t.Parallel()
	_, provider, run := groupSyncFixture(t)
	provider.refuseWrites = true
	result := syncDirectory(context.Background(), run)
	assert.Equal(t, 12, result.Created)
	assert.Zero(t, result.GroupsWritten)
	assert.Equal(t, 4, result.FailureCount)
	require.Len(t, result.Failures, 4)
	for _, failure := range result.Failures {
		assert.Contains(t, failure, "403 Forbidden")
	}
}

// @scenario "Directory readback follows every page of users and groups"
func TestDirectoryReadbackFollowsEveryPage(t *testing.T) {
	t.Parallel()
	tenant, provider, run := groupSyncFixture(t)
	tenant.Populate(PopulationSpec{Users: 250, Groups: 5})
	provider.pageSize = 37
	result := syncDirectory(context.Background(), run)
	require.Zero(t, result.FailureCount, result.Failures)
	snapshot, err := pullDirectory(context.Background(), run.target)
	require.NoError(t, err)
	assert.Len(t, snapshot.Users, 250)
	assert.Len(t, snapshot.Groups, 5)
	repeated := syncDirectory(context.Background(), run)
	assert.Equal(t, 250, repeated.Unchanged)
	assert.Zero(t, repeated.GroupsWritten)
	assert.Zero(t, repeated.FailureCount)
}

// @scenario "An inactive person removed by the target is not provisioned again"
func TestSyncDoesNotRecreateAnAbsentInactiveUser(t *testing.T) {
	t.Parallel()
	tenant, provider, run := groupSyncFixture(t)
	first := syncDirectory(context.Background(), run)
	require.Zero(t, first.FailureCount, first.Failures)
	departed := tenant.Users()[0]
	targetID := stringField(provider.held()[departed.UserName], "id")
	require.NotEmpty(t, targetID)
	departed.Active = false
	// Some service providers remove their membership resource on deactivation.
	require.NoError(t, scimDelete(context.Background(), http.DefaultClient, scimTarget{
		URL: run.target.BaseURL + "/Users/" + targetID, Token: run.target.Token,
	}))
	after := syncDirectory(context.Background(), run)
	require.Zero(t, after.FailureCount, after.Failures)
	assert.Zero(t, after.Created)
	assert.Zero(t, after.Updated)
	assert.Len(t, provider.held(), 11)
	assert.NotContains(t, provider.held(), departed.UserName)
	repeated := syncDirectory(context.Background(), run)
	assert.Zero(t, repeated.Created)
	assert.Zero(t, repeated.GroupsWritten)
	assert.Zero(t, repeated.FailureCount)
}
