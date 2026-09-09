package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// The one HTTP seam the Grafana-backed sources share. The LGTM bundle is on
// loopback, so the budget is a person's patience rather than a network's: a
// query that has not answered in two seconds is not going to redraw a tab
// before the next poll anyway, and holding the frame for longer makes the whole
// viewer feel broken when only one tab is.

// queryTimeout bounds one datasource query.
const queryTimeout = 2 * time.Second

// dialTimeout bounds the liveness probe. It is a loopback connect, so anything
// past a few hundred milliseconds means nothing is listening.
const dialTimeout = 250 * time.Millisecond

// endpoint is one loopback HTTP service the viewer reads.
type endpoint struct {
	// base is the scheme and authority, without a trailing slash.
	base string
	// port is what the liveness probe dials.
	port   int
	client *http.Client
}

func newEndpoint(port int) endpoint {
	return endpoint{
		base:   fmt.Sprintf("http://127.0.0.1:%d", port),
		port:   port,
		client: &http.Client{Timeout: queryTimeout},
	}
}

// up reports whether anything is accepting connections on the port. A port
// check, deliberately: a tab whose stack is down must issue no queries, so the
// question of whether to query cannot itself be one.
func (e endpoint) up() bool {
	ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
	defer cancel()
	dialer := net.Dialer{Timeout: dialTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(e.port)))
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

// getJSON reads one JSON document from a path with query parameters. Any
// non-200 is an error: a partial or an error body decoded into a zero value
// would render as an empty tab, which is the one thing the reader must not be
// shown when the answer is unknown.
func (e endpoint) getJSON(path string, params url.Values, into any) error {
	target := e.base + path
	if len(params) > 0 {
		target += "?" + params.Encode()
	}
	ctx, cancel := context.WithTimeout(context.Background(), queryTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s answered %s", path, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(into)
}

// ProfileWindow is how far back the metrics and profiles tabs look. Ten
// minutes is what the spec asks for and what the bundle's two-hour retention
// makes cheap; it is also long enough that a sparkline shows a trend rather
// than noise.
const ProfileWindow = 10 * time.Minute
