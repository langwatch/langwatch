package sources

import (
	"context"
	"fmt"
	"net/url"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// LocalStores reads the three database servers haven manages against the limits
// it gave them. Each is asked the way that server is already asked elsewhere in
// haven - ClickHouse over its HTTP port, Redis and Postgres through their own
// command-line clients - so a machine where one of them is reachable at all is
// a machine where this reads.

// storeProbeTimeout bounds one server probe. These run on the visible tab's
// poll, so a server that has wedged must cost a frame, not the viewer.
const storeProbeTimeout = 2 * time.Second

// LocalStores is the stores tab's real backing.
type LocalStores struct {
	// ClickHouseHTTPPort, PostgresPort and RedisPort are zero for a server this
	// stack does not use, and that server is then absent rather than reported
	// as down: a stack pointed at a shared Postgres has no pool of its own to
	// show, and inventing a row for one would be a lie about what it uses.
	ClickHouseHTTPPort int
	PostgresPort       int
	RedisPort          int
	// RedisCapBytes is the maxmemory haven applied, used only when the server
	// itself reports no cap.
	RedisCapBytes float64
	// ClickHouseLimitBytes is the container memory ceiling haven applied.
	ClickHouseLimitBytes float64
}

// Stats reports each managed server against its limit, in a fixed order so the
// rows do not move between polls.
func (s LocalStores) Stats() ([]StoreStat, error) {
	ctx, cancel := context.WithTimeout(context.Background(), storeProbeTimeout)
	defer cancel()
	var out []StoreStat
	if s.PostgresPort != 0 {
		out = append(out, s.postgres(ctx))
	}
	if s.RedisPort != 0 {
		out = append(out, s.redis(ctx))
	}
	if s.ClickHouseHTTPPort != 0 {
		out = append(out, s.clickHouse(ctx))
	}
	return out, nil
}

// postgres reads connections in use against max_connections - the pool the
// whole machine shares, since every worktree's stack dials the one server.
func (s LocalStores) postgres(ctx context.Context) StoreStat {
	stat := StoreStat{Name: "postgres", Measure: "connections"}
	const query = `select (select count(*) from pg_stat_activity), current_setting('max_connections')`
	//nolint:gosec // every argument is a constant or a port number out of haven's own registry
	out, err := exec.CommandContext(ctx, "psql", "-tAX", "-h", "127.0.0.1",
		"-p", strconv.Itoa(s.PostgresPort), "-d", "postgres", "-c", query).Output()
	if err != nil {
		return stat
	}
	used, limit, ok := strings.Cut(strings.TrimSpace(string(out)), "|")
	if !ok {
		return stat
	}
	stat.Used, _ = strconv.ParseFloat(used, 64)
	stat.Limit, _ = strconv.ParseFloat(limit, 64)
	return stat
}

// redis reads used_memory against maxmemory, falling back to the cap haven
// applied when the server reports none.
func (s LocalStores) redis(ctx context.Context) StoreStat {
	stat := StoreStat{Name: "redis", Measure: "memory", Unit: "bytes", Limit: s.RedisCapBytes}
	//nolint:gosec // every argument is a constant or a port number out of haven's own registry
	out, err := exec.CommandContext(ctx, "redis-cli", "-h", "127.0.0.1",
		"-p", strconv.Itoa(s.RedisPort), "info", "memory").Output()
	if err != nil {
		return stat
	}
	fields := infoFields(string(out))
	stat.Used = parseFloat(fields["used_memory"])
	if capped := parseFloat(fields["maxmemory"]); capped > 0 {
		stat.Limit = capped
	}
	return stat
}

// infoFields reads Redis's INFO reply, one "key:value" per line.
func infoFields(text string) map[string]string {
	fields := map[string]string{}
	for _, line := range strings.Split(text, "\n") {
		if key, value, ok := strings.Cut(strings.TrimSpace(line), ":"); ok {
			fields[key] = value
		}
	}
	return fields
}

// clickHouse reads tracked memory against the container's ceiling.
func (s LocalStores) clickHouse(ctx context.Context) StoreStat {
	stat := StoreStat{Name: "clickhouse", Measure: "memory", Unit: "bytes", Limit: s.ClickHouseLimitBytes}
	const query = `SELECT value FROM system.metrics WHERE metric = 'MemoryTracking'`
	stat.Used = s.chQuery(ctx, query)
	if limit := s.chQuery(ctx, `SELECT value FROM system.asynchronous_metrics WHERE metric = 'CGroupMemoryTotal'`); limit > 0 {
		stat.Limit = limit
	}
	return stat
}

// chQuery runs one scalar query over ClickHouse's HTTP port.
func (s LocalStores) chQuery(ctx context.Context, query string) float64 {
	target := fmt.Sprintf("http://127.0.0.1:%d/?query=%s", s.ClickHouseHTTPPort, url.QueryEscape(query))
	out, err := exec.CommandContext(ctx, "curl", "-sf", "--max-time", "2", target).Output()
	if err != nil {
		return 0
	}
	return parseFloat(strings.TrimSpace(string(out)))
}

func parseFloat(text string) float64 {
	value, err := strconv.ParseFloat(strings.TrimSpace(text), 64)
	if err != nil {
		return 0
	}
	return value
}
