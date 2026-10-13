package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"sync"
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
	// live is the shared liveness answer for that port, by pointer so every
	// copy of this value type consults the same cache.
	live *liveness
}

func newEndpoint(port int) endpoint {
	return endpoint{
		base:   fmt.Sprintf("http://127.0.0.1:%d", port),
		port:   port,
		client: &http.Client{Timeout: queryTimeout},
		live:   &liveness{port: port},
	}
}

// up reports whether anything is accepting connections on the port. A port
// check, deliberately: a tab whose stack is down must issue no queries, so the
// question of whether to query cannot itself be one.
//
// The check is asked far more often than it changes - the log tab's footer asks
// on every rendered frame, which is every keystroke - so only the first ask
// dials on the caller's goroutine. See liveness.
func (e endpoint) up() bool { return e.live.alive() }

// livenessTTL is how stale a port answer may get before it is re-dialled. A
// second is far longer than the viewer's 300ms beat, so a tab redrawn ten times
// a second costs one connect a second rather than ten; and it is far shorter
// than a person's patience for "the stack came up and the tab has not noticed".
const livenessTTL = time.Second

// liveness is one port's "is anything accepting" answer, cached.
//
// The dial itself is cheap only when the port answers or refuses at once. A
// port that is bound but not accepting - a container forwarder mid-restart, a
// dropped SYN - costs the full dialTimeout, and the viewer used to pay that on
// the goroutine that also handles keystrokes, once per frame. Keys then queued
// behind a connect they had nothing to do with, which is what "slow to register
// input" was. Now the first ask dials (so the opening frame is as true as it
// ever was) and every later ask reports the last answer, refreshing behind the
// reader's back when it goes stale.
type liveness struct {
	port int

	mu       sync.Mutex
	answered bool
	up       bool
	at       time.Time
	dialing  bool
}

// alive reports the last known answer, and never blocks on a dial except the
// very first one.
func (l *liveness) alive() bool {
	l.mu.Lock()
	if !l.answered {
		l.mu.Unlock()
		up := dialPort(l.port)
		l.mu.Lock()
		l.answered, l.up, l.at = true, up, time.Now()
		l.mu.Unlock()
		return up
	}
	up := l.up
	refresh := time.Since(l.at) >= livenessTTL && !l.dialing
	if refresh {
		l.dialing = true
	}
	l.mu.Unlock()
	if refresh {
		go l.redial()
	}
	return up
}

// redial replaces the cached answer off the caller's goroutine.
func (l *liveness) redial() {
	up := dialPort(l.port)
	l.mu.Lock()
	defer l.mu.Unlock()
	l.up, l.at, l.dialing = up, time.Now(), false
}

// dialPort is the connect itself, bounded by dialTimeout.
func dialPort(port int) bool {
	ctx, cancel := context.WithTimeout(context.Background(), dialTimeout)
	defer cancel()
	dialer := net.Dialer{Timeout: dialTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
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
