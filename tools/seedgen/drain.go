package seedgen

import (
	"bufio"
	"cmp"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"
)

// DrainHorizon splits the seed's queued work: a job due within it is landing and waited on; one
// deferred past it (trace origin's five-minute fallback) is a later pass, counted but not waited on.
const DrainHorizon = time.Minute

// SeedBacklog is the worker's work for the seed's own tenants, read from the group queues.
type SeedBacklog struct{ Due, Active, Blocked, Deferred int }

// Settled says nothing is left that lands the seed's data.
func (b SeedBacklog) Settled() bool { return b.Due+b.Active == 0 }

func (b SeedBacklog) String() string {
	return fmt.Sprintf("%d due, %d running, %d blocked, %d deferred", b.Due, b.Active, b.Blocked, b.Deferred)
}

// QueueBacklog reads the backlog of the given tenants from the stack's Redis (REDIS_URL and
// REDIS_DB_INDEX). A group belongs to a tenant when its id starts "<tenant>/".
func QueueBacklog(raw string) func(ctx context.Context, tenants []string, now time.Time) (SeedBacklog, error) {
	return func(ctx context.Context, tenants []string, now time.Time) (SeedBacklog, error) {
		conn, err := dialRedis(ctx, raw)
		if err != nil {
			return SeedBacklog{}, err
		}
		defer func() { _ = conn.Close() }()
		return conn.backlog(tenants, now)
	}
}

func (r *respConn) backlog(tenants []string, now time.Time) (SeedBacklog, error) {
	owned := func(group string) bool {
		return slices.ContainsFunc(tenants, func(tenant string) bool { return strings.HasPrefix(group, tenant+"/") })
	}
	var backlog SeedBacklog
	readyKeys, err := r.scan("*:gq:ready")
	if err != nil {
		return backlog, err
	}
	for _, ready := range readyKeys {
		queue, err := r.queueBacklog(strings.TrimSuffix(ready, "ready"), owned, now)
		if err != nil {
			return backlog, err
		}
		backlog.Due, backlog.Blocked, backlog.Deferred = backlog.Due+queue.Due, backlog.Blocked+queue.Blocked,
			backlog.Deferred+queue.Deferred
	}
	active, err := r.scan("*:gq:group:*:active")
	for _, key := range active {
		_, group, _ := strings.Cut(key, ":gq:group:")
		if owned(strings.TrimSuffix(group, ":active")) {
			backlog.Active++
		}
	}
	return backlog, err
}

// queueBacklog is one group queue's ready and blocked groups of the owned tenants.
func (r *respConn) queueBacklog(queue string, owned func(string) bool, now time.Time) (SeedBacklog, error) {
	var backlog SeedBacklog
	scored, err := r.strings("ZRANGE", queue+"ready", "0", "-1", "WITHSCORES")
	if err != nil {
		return backlog, err
	}
	horizon := float64(now.Add(DrainHorizon).UnixMilli())
	for i := 0; i+1 < len(scored); i += 2 {
		score, _ := strconv.ParseFloat(scored[i+1], 64)
		switch {
		case !owned(scored[i]):
		case score <= horizon:
			backlog.Due++
		default:
			backlog.Deferred++
		}
	}
	blocked, err := r.strings("SMEMBERS", queue+"blocked")
	for _, group := range blocked {
		if owned(group) {
			backlog.Blocked++
		}
	}
	return backlog, err
}

// respConn is a minimal RESP2 client: the guard and the drain need a handful of read commands.
type respConn struct {
	net.Conn
	reader *bufio.Reader
}

func dialRedis(ctx context.Context, raw string) (*respConn, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	conn, err := (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, "tcp", parsed.Host)
	if err != nil {
		return nil, err
	}
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	r := &respConn{Conn: conn, reader: bufio.NewReader(conn)}
	if err := redisAuth(conn, r.reader, parsed.User); err != nil {
		_ = conn.Close()
		return nil, err
	}
	db := cmp.Or(os.Getenv("REDIS_DB_INDEX"), strings.TrimPrefix(parsed.Path, "/"))
	if db != "" && db != "0" {
		if _, err := r.do("SELECT", db); err != nil {
			_ = conn.Close()
			return nil, err
		}
	}
	return r, nil
}

func (r *respConn) scan(pattern string) ([]string, error) {
	var keys []string
	for cursor := "0"; ; {
		reply, err := r.do("SCAN", cursor, "MATCH", pattern, "COUNT", "1000")
		parts, ok := reply.([]any)
		if err != nil || !ok || len(parts) != 2 {
			return keys, cmpErr(err, "SCAN answered %v", reply)
		}
		cursor, _ = parts[0].(string)
		keys = append(keys, stringsOf(parts[1])...)
		if cursor == "0" {
			return keys, nil
		}
	}
}

// stringsOf is an array reply's string items.
func stringsOf(reply any) []string {
	items, _ := reply.([]any)
	out := make([]string, 0, len(items))
	for _, item := range items {
		s, _ := item.(string)
		out = append(out, s)
	}
	return out
}

func (r *respConn) strings(args ...string) ([]string, error) {
	reply, err := r.do(args...)
	if _, ok := reply.([]any); err != nil || !ok {
		return nil, cmpErr(err, "%s answered %v", args[0], reply)
	}
	return stringsOf(reply), nil
}

func cmpErr(err error, format string, args ...any) error {
	if err != nil {
		return err
	}
	return fmt.Errorf("redis: "+format, args...)
}

func (r *respConn) do(args ...string) (any, error) {
	var b strings.Builder
	fmt.Fprintf(&b, "*%d\r\n", len(args))
	for _, arg := range args {
		fmt.Fprintf(&b, "$%d\r\n%s\r\n", len(arg), arg)
	}
	if _, err := io.WriteString(r.Conn, b.String()); err != nil {
		return nil, err
	}
	return readRESP(r.reader)
}

// readRESP reads one RESP2 reply: a status or bulk string as string, an integer as int64, an
// array as []any, nil for a null; an error reply is an error.
func readRESP(reader *bufio.Reader) (any, error) {
	line, err := reader.ReadString('\n')
	line = strings.TrimRight(line, "\r\n")
	if err != nil || line == "" {
		return nil, cmpErr(err, "empty reply")
	}
	body := line[1:]
	switch line[0] {
	case '+':
		return body, nil
	case '-':
		return nil, errors.New("redis: " + body)
	case ':':
		return strconv.ParseInt(body, 10, 64)
	case '$':
		return readBulk(reader, body)
	case '*':
		return readArray(reader, body)
	}
	return nil, fmt.Errorf("redis: unexpected reply %q", line)
}

func readBulk(reader *bufio.Reader, header string) (any, error) {
	size, err := strconv.Atoi(header)
	if err != nil || size < 0 {
		return nil, err
	}
	data := make([]byte, size+2)
	if _, err := io.ReadFull(reader, data); err != nil {
		return nil, err
	}
	return string(data[:size]), nil
}

func readArray(reader *bufio.Reader, header string) (any, error) {
	count, err := strconv.Atoi(header)
	if err != nil || count < 0 {
		return nil, err
	}
	items := make([]any, count)
	for i := range items {
		if items[i], err = readRESP(reader); err != nil {
			return nil, err
		}
	}
	return items, nil
}
