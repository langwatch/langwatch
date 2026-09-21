package idpsim

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

/**
 * A service provider that behaves like a real one at scale.
 *
 * `fakeServiceProvider` accepts creates and lists everything back in one
 * response, which is enough for the replay push and useless for a sync: the
 * two things a sync gets wrong are paging a large collection and matching a
 * renamed person, and neither appears against a target that returns its whole
 * directory every time.
 *
 * So this one PAGES — honoring startIndex and count the way the SCIM spec
 * says — and it keeps records by the id it minted, so an update, a deactivation
 * and a delete each have to name one.
 */
type pagingServiceProvider struct {
	mu      sync.Mutex
	users   map[string]map[string]any
	order   []string
	nextID  int
	written []string
	// pageSize caps what a list returns regardless of the count asked for,
	// which is what a real provider does and what catches a client that
	// assumes its own page size was honored.
	pageSize int
}

func newPagingServiceProvider() *pagingServiceProvider {
	return &pagingServiceProvider{users: map[string]map[string]any{}, pageSize: 100}
}

func (f *pagingServiceProvider) start(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(server.Close)
	return server
}

func (f *pagingServiceProvider) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.written = append(f.written, r.Method+" "+r.URL.Path)

	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/Users":
		f.list(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/Users":
		f.create(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/Groups":
		writeJSON(w, http.StatusCreated, map[string]any{"id": "group"})
	case strings.HasPrefix(r.URL.Path, "/Users/"):
		f.mutate(w, r, strings.TrimPrefix(r.URL.Path, "/Users/"))
	default:
		http.NotFound(w, r)
	}
}

func (f *pagingServiceProvider) list(w http.ResponseWriter, r *http.Request) {
	start, _ := strconv.Atoi(r.URL.Query().Get("startIndex"))
	if start < 1 {
		start = 1
	}
	count, _ := strconv.Atoi(r.URL.Query().Get("count"))
	if count <= 0 || count > f.pageSize {
		count = f.pageSize
	}
	resources := []any{}
	for i := start - 1; i < len(f.order) && len(resources) < count; i++ {
		resources = append(resources, f.users[f.order[i]])
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"Resources":    resources,
		"totalResults": len(f.order),
		"startIndex":   start,
		"itemsPerPage": len(resources),
	})
}

func (f *pagingServiceProvider) create(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	f.nextID++
	id := fmt.Sprintf("sp-%d", f.nextID)
	body["id"] = id
	f.users[id] = body
	f.order = append(f.order, id)
	writeJSON(w, http.StatusCreated, body)
}

func (f *pagingServiceProvider) mutate(w http.ResponseWriter, r *http.Request, id string) {
	existing, ok := f.users[id]
	if !ok {
		http.NotFound(w, r)
		return
	}
	switch r.Method {
	case http.MethodDelete:
		delete(f.users, id)
		for i, held := range f.order {
			if held == id {
				f.order = append(f.order[:i], f.order[i+1:]...)
				break
			}
		}
		w.WriteHeader(http.StatusNoContent)
	case http.MethodPut:
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		body["id"] = id
		f.users[id] = body
		writeJSON(w, http.StatusOK, body)
	case http.MethodPatch:
		// Only the one operation a deactivation sends.
		existing["active"] = false
		writeJSON(w, http.StatusOK, existing)
	default:
		http.Error(w, "unexpected", http.StatusMethodNotAllowed)
	}
}

// held is what the provider is holding, by userName.
func (f *pagingServiceProvider) held() map[string]map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := map[string]map[string]any{}
	for _, resource := range f.users {
		if name, ok := resource["userName"].(string); ok {
			out[name] = resource
		}
	}
	return out
}

func (f *pagingServiceProvider) countOfMethod(method string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, line := range f.written {
		if strings.HasPrefix(line, method+" ") {
			n++
		}
	}
	return n
}

func syncTarget(server *httptest.Server) ProvisioningTarget {
	return ProvisioningTarget{BaseURL: server.URL, Token: "sp-token"}
}

func TestSyncCarriesTheDirectoryThenSendsNothing(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)
	tenant.Populate(PopulationSpec{Users: 250, Groups: 4})

	provider := newPagingServiceProvider()
	server := provider.start(t)

	first := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}})
	require.Zero(t, first.FailureCount, "failures: %v", first.Failures)
	assert.Equal(t, 250, first.Created, "the whole directory lands on the first run")
	assert.Equal(t, 0, first.TargetHeld, "which was empty before it")

	// THE PROPERTY THE WHOLE DESIGN EXISTS FOR: run it again with nothing
	// changed and it sends nothing. A replay would send 250 conflicts.
	second := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}})
	require.Zero(t, second.FailureCount, "failures: %v", second.Failures)
	assert.Equal(t, 0, second.Created)
	assert.Equal(t, 0, second.Updated)
	assert.Equal(t, 250, second.Unchanged)
	assert.Equal(t, 250, second.TargetHeld)
}

func TestSyncReadsEveryPageOfALargeDirectory(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)
	// Comfortably more than one page, so a client that read only the first
	// would see 100 of them and call the other 350 departures.
	tenant.Populate(PopulationSpec{Users: 450, Groups: 3})

	provider := newPagingServiceProvider()
	server := provider.start(t)
	require.Zero(t, syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}}).FailureCount)

	second := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}})
	assert.Equal(t, 450, second.TargetHeld, "every page was read back")
	assert.Equal(t, 450, second.Unchanged)
	assert.Zero(t, second.Deactivated, "nobody is a departure just for being on page two")
}

func TestSyncUpdatesARenameRatherThanReplacingThePerson(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)
	tenant.Populate(PopulationSpec{Users: 40, Groups: 3})

	provider := newPagingServiceProvider()
	server := provider.start(t)
	require.Zero(t, syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}}).FailureCount)
	before := len(provider.held())

	renamed := tenant.Churn(ChurnSpec{Rename: 10})
	require.Equal(t, 10, renamed.Renamed)

	result := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}})
	require.Zero(t, result.FailureCount, "failures: %v", result.Failures)
	assert.Equal(t, 10, result.Updated, "a rename is an update")
	assert.Zero(t, result.Created, "and not a new person")
	assert.Zero(t, result.Deactivated, "nor a departure")
	assert.Len(t, provider.held(), before, "the directory is the same size afterwards")
}

func TestSyncDeactivatesDeparturesAndLeavesThemAlone(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)
	tenant.Populate(PopulationSpec{Users: 60, Groups: 3})

	provider := newPagingServiceProvider()
	server := provider.start(t)
	require.Zero(t, syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}}).FailureCount)

	left := tenant.Churn(ChurnSpec{Leave: 15})
	require.Equal(t, 15, left.Left)

	first := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}})
	require.Zero(t, first.FailureCount, "failures: %v", first.Failures)
	assert.Equal(t, 15, first.Deactivated, "a departure suspends rather than erases")
	assert.Zero(t, first.Deleted)
	assert.Len(t, provider.held(), 60, "the records stay")

	// The second run must not deactivate the same fifteen again.
	second := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}})
	assert.Zero(t, second.Deactivated, "already-inactive departures are not re-sent")
}

func TestSyncDeletesDeparturesWhenAskedTo(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)
	tenant.Populate(PopulationSpec{Users: 30, Groups: 2})

	provider := newPagingServiceProvider()
	server := provider.start(t)
	require.Zero(t, syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}}).FailureCount)

	require.Equal(t, 8, tenant.Churn(ChurnSpec{Leave: 8}).Left)
	result := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{Mode: SyncDelete}})

	require.Zero(t, result.FailureCount, "failures: %v", result.Failures)
	assert.Equal(t, 8, result.Deleted)
	assert.Zero(t, result.Deactivated)
	assert.Len(t, provider.held(), 22, "the records are gone")
}

func TestSyncDryRunSendsNothing(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)
	tenant.Populate(PopulationSpec{Users: 25, Groups: 2})

	provider := newPagingServiceProvider()
	server := provider.start(t)

	result := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{DryRun: true}})

	assert.True(t, result.DryRun)
	assert.Equal(t, 25, result.Created, "it says what it would have created")
	assert.Zero(t, provider.countOfMethod(http.MethodPost), "and posts nothing")
	assert.Empty(t, provider.held())
}

func TestSyncReportsHowLongItTook(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)
	tenant.Populate(PopulationSpec{Users: 20, Groups: 2})

	provider := newPagingServiceProvider()
	server := provider.start(t)
	result := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}})

	assert.NotEmpty(t, result.Elapsed, "a run says how long it took")
	assert.GreaterOrEqual(t, result.ElapsedMs, int64(0))
	assert.Positive(t, result.RequestsPerSec, "and at what rate")
}

func TestSyncSurvivesATargetThatRefusesEverything(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)
	tenant.Populate(PopulationSpec{Users: 30, Groups: 2})

	refusing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			writeJSON(w, http.StatusOK, map[string]any{"Resources": []any{}, "totalResults": 0})
			return
		}
		http.Error(w, "no", http.StatusInternalServerError)
	}))
	t.Cleanup(refusing.Close)

	result := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(refusing), opts: SyncOptions{}})

	assert.Equal(t, 30, result.FailureCount, "every one is counted")
	assert.LessOrEqual(t, len(result.Failures), maxReportedFailures,
		"but the report stays smaller than the directory")
}

func TestSyncRefusesToReadAnUnreachableTarget(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)

	result := syncDirectory(context.Background(), syncRun{
		tenant: tenant,
		target: ProvisioningTarget{BaseURL: "http://127.0.0.1:1", Token: "t"},
	})

	require.Len(t, result.Failures, 1)
	assert.Contains(t, result.Failures[0], "could not read the target back")
	assert.Zero(t, result.Created, "and nothing is claimed to have landed")
}
