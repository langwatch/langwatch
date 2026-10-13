package workerrun

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// sessionEvents proves a coding-agent session reads back with at least one event.
func (run *run) sessionEvents(ctx context.Context, r *round, ref traceRef) (bool, string) {
	status, body, err := r.fetch("session "+ref.id, func() (int, []byte, error) {
		return run.get(ctx, ref.family, "/api/coding-agent/sessions/"+url.PathEscape(ref.id)+"/events")
	})
	if ok, detail := bodyHas(status, body, err)("events"); !ok {
		return false, "session " + detail
	}
	var page struct {
		Events []json.RawMessage `json:"events"`
	}
	if json.Unmarshal(body, &page) != nil || len(page.Events) == 0 {
		return false, "session without events"
	}
	return true, ""
}

// chQueries are the only counts run: a table's rows for one tenant whose resource carries the wire marker.
var chQueries = map[string]string{
	"log_records": "SELECT count() FROM log_records FINAL WHERE TenantId = {tenant:String} " +
		"AND position(ResourceAttributesJson, {marker:String}) > 0 FORMAT TabSeparated",
	"metric_data_points": "SELECT count() FROM metric_data_points FINAL WHERE TenantId = {tenant:String} " +
		"AND position(ResourceAttributesJson, {marker:String}) > 0 FORMAT TabSeparated",
}

// chCount is one count: the table, the tenant (the project) and the quoted wire id.
type chCount struct{ table, tenant, marker string }

// chCounter counts rows in one ClickHouse over its HTTP interface.
type chCounter struct {
	endpoint url.URL
	user     *url.Userinfo
	client   *http.Client
}

// newCHCounter reads a ClickHouse URL; its path names the database. Errors never echo the URL.
func newCHCounter(raw string, client *http.Client) (*chCounter, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, errors.New("the ClickHouse URL does not parse")
	}
	counter := &chCounter{user: parsed.User, client: client}
	query := parsed.Query()
	if database := strings.Trim(parsed.Path, "/"); database != "" {
		query.Set("database", database)
	}
	parsed.User, parsed.Path, parsed.RawQuery = nil, "/", query.Encode()
	counter.endpoint = *parsed
	return counter, nil
}

func (c *chCounter) count(ctx context.Context, q chCount) (int, error) {
	endpoint := c.endpoint
	params := endpoint.Query()
	params.Set("param_tenant", q.tenant)
	params.Set("param_marker", q.marker)
	endpoint.RawQuery = params.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), strings.NewReader(chQueries[q.table]))
	if err != nil {
		return 0, err
	}
	if c.user != nil {
		password, _ := c.user.Password()
		request.SetBasicAuth(c.user.Username(), password)
	}
	response, err := c.client.Do(request)
	if err != nil {
		return 0, err
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 64<<10))
	if err != nil {
		return 0, err
	}
	if response.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("ClickHouse status %d: %s", response.StatusCode, oneLine(string(raw)))
	}
	return strconv.Atoi(strings.TrimSpace(string(raw)))
}

// chTargets are where rows must land and, on a hybrid run, the shared ClickHouse where they must not.
type chTargets struct{ landing, shared *chCounter }

// newCHTargets reads the ClickHouse URLs, or says why the family is skipped.
func newCHTargets(env ingestEnv, client *http.Client) (chTargets, string) {
	if env.clickhouse == "" {
		return chTargets{}, "set WORKERRUN_CLICKHOUSE_URL (the private one on a hybrid run) to count rows by tenant"
	}
	landing, err := newCHCounter(env.clickhouse, client)
	if err != nil {
		return chTargets{}, "WORKERRUN_CLICKHOUSE_URL: " + err.Error()
	}
	targets := chTargets{landing: landing}
	if env.sharedClickhouse == "" {
		return targets, ""
	}
	targets.shared, err = newCHCounter(env.sharedClickhouse, client)
	if err != nil {
		return chTargets{}, "WORKERRUN_SHARED_CLICKHOUSE_URL: " + err.Error()
	}
	return targets, ""
}

// proven is whether the landing count equals want and, when set, the shared ClickHouse holds none.
func (t chTargets) proven(ctx context.Context, q chCount, want int) (bool, string) {
	got, err := t.landing.count(ctx, q)
	if err != nil {
		return false, oneLine(err.Error())
	}
	if got != want {
		return false, fmt.Sprintf("counted %d of %d", got, want)
	}
	if t.shared == nil {
		return true, ""
	}
	leaked, err := t.shared.count(ctx, q)
	if err != nil {
		return false, "shared: " + oneLine(err.Error())
	}
	if leaked != 0 {
		return false, fmt.Sprintf("%d rows in the shared ClickHouse", leaked)
	}
	return true, ""
}
