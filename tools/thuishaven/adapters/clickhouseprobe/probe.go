// Package clickhouseprobe implements app.ClickHouseCeilingProbe: it asks a
// ClickHouse server, addressed only by URL, how much memory it will let itself
// take.
//
// It exists for the server haven does not manage. With LANGWATCH_HAVEN_CH=0
// there is no container, no cgroup and no haven-written config — the documented
// no-container route hands ClickHouse the whole machine and says nothing. This
// adapter is the "say something" half: read the two settings that decide the
// ceiling, and let domain.AssessClickHouseCeiling judge them.
//
// Read-only by construction. It runs one SELECT against system.server_settings
// and never writes, so pointing it at a server it turns out not to understand
// costs nothing.
package clickhouseprobe

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// ceilingSQL reads both halves of the ceiling in one round trip.
// max_server_memory_usage alone is not the answer: 0 there means "unset", and
// the ratio is what actually applies.
const ceilingSQL = `SELECT name, value FROM system.server_settings ` +
	`WHERE name IN ('max_server_memory_usage', 'max_server_memory_usage_to_ram_ratio') ` +
	`FORMAT TabSeparated`

// DefaultTimeout keeps the probe off the critical path of `haven up`. A server
// that cannot answer a settings query in three seconds is one haven declines to
// have an opinion about, rather than one worth stalling a stack for.
const DefaultTimeout = 3 * time.Second

// Probe is a stateless HTTP reader. One instance serves every call.
type Probe struct {
	client *http.Client
}

// New builds a Probe with DefaultTimeout.
func New() *Probe {
	return &Probe{client: &http.Client{Timeout: DefaultTimeout}}
}

// Ceiling reads the server's effective memory ceiling.
//
// Credentials in rawURL are used for the request and never travel anywhere
// else: errors name the host, never the URL, because a CLICKHOUSE_URL routinely
// carries a password and an error string is the one place it would surface.
func (p *Probe) Ceiling(ctx context.Context, rawURL string) (domain.ClickHouseCeiling, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return domain.ClickHouseCeiling{}, fmt.Errorf("unparseable clickhouse URL")
	}
	if u.Host == "" {
		return domain.ClickHouseCeiling{}, fmt.Errorf("clickhouse URL names no host")
	}

	// The query goes to the server root, not to the URL's path: the path is the
	// database name, and system.server_settings is reachable regardless of which
	// database the app happens to be pinned to (and of whether it exists yet).
	endpoint := url.URL{Scheme: u.Scheme, Host: u.Host, Path: "/"}
	if endpoint.Scheme == "" {
		endpoint.Scheme = "http"
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader([]byte(ceilingSQL)))
	if err != nil {
		return domain.ClickHouseCeiling{}, err
	}
	if u.User != nil {
		password, _ := u.User.Password()
		req.SetBasicAuth(u.User.Username(), password)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return domain.ClickHouseCeiling{}, fmt.Errorf("clickhouse at %s did not answer", u.Host)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return domain.ClickHouseCeiling{}, fmt.Errorf("clickhouse at %s answered unreadably", u.Host)
	}
	if resp.StatusCode != http.StatusOK {
		return domain.ClickHouseCeiling{}, fmt.Errorf("clickhouse at %s refused the settings query (HTTP %d)", u.Host, resp.StatusCode)
	}
	return parseCeiling(string(body))
}

// parseCeiling reads the TabSeparated name/value pairs. A row that does not
// parse is skipped rather than failing the read: ClickHouse renames and adds
// server settings between versions, and a ceiling built from the rows that DID
// parse is still worth judging.
func parseCeiling(body string) (domain.ClickHouseCeiling, error) {
	var (
		ceiling domain.ClickHouseCeiling
		seen    bool
	)
	for line := range strings.SplitSeq(body, "\n") {
		name, value, ok := strings.Cut(strings.TrimSpace(line), "\t")
		if !ok {
			continue
		}
		if applySetting(&ceiling, name, strings.TrimSpace(value)) {
			seen = true
		}
	}
	if !seen {
		return domain.ClickHouseCeiling{}, fmt.Errorf("no memory-ceiling settings in the server's answer")
	}
	return ceiling, nil
}

// applySetting writes one recognized name/value pair onto ceiling, reporting
// whether it landed. An unrecognized name and an unparsable value are the same
// answer — "not this row" — so a renamed setting degrades to a missing one
// rather than to a wrong ceiling.
func applySetting(ceiling *domain.ClickHouseCeiling, name, value string) bool {
	switch name {
	case "max_server_memory_usage":
		n, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			return false
		}
		ceiling.MaxServerMemoryUsage = n
		return true
	case "max_server_memory_usage_to_ram_ratio":
		f, err := strconv.ParseFloat(value, 64)
		if err != nil {
			return false
		}
		ceiling.RAMRatio = f
		return true
	default:
		return false
	}
}
