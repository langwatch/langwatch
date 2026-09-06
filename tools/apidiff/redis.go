package apidiff

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Redis has no administrative CLI in this package's allowlist, so the two
// operations boot needs — PING for the preflight, SELECT + FLUSHDB for the
// per-run reset — speak RESP directly over a socket. Nothing else here talks
// to Redis.

const redisDialTimeout = 5 * time.Second

// redisLogicalDBs is the number of logical databases a default Redis serves.
const redisLogicalDBs = 16

// RedisIndices picks this run's two logical database indices from the run id.
// The old fixed 14/15 pair meant two concurrent runs shared a database and a
// previous run's residue was still in place, which is an asymmetry the
// harness itself introduces.
func RedisIndices(runID string) (branch, main int, err error) {
	digest := fnv.New32a()
	if _, err := digest.Write([]byte(runID)); err != nil {
		return 0, 0, err
	}
	half := redisLogicalDBs / 2
	branch = int(digest.Sum32() % uint32(half))
	main = branch + half
	if branch == main {
		return 0, 0, fmt.Errorf("redis indices for run %q collide on %d", runID, branch)
	}
	return branch, main, nil
}

// redisTarget is a parsed redis:// URL reduced to what a raw connection needs.
type redisTarget struct {
	address  string
	username string
	password string
}

// parseRedisURL parses a redis:// or rediss:// URL. TLS is rejected rather
// than silently downgraded: an encrypted endpoint is not a dev-stack Redis
// and this client speaks plaintext RESP.
func parseRedisURL(rawURL string) (redisTarget, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return redisTarget{}, fmt.Errorf("redis URL: %w", err)
	}
	if parsed.Scheme == "rediss" {
		return redisTarget{}, errors.New("redis URL: rediss:// (TLS) is not supported by the apidiff reset client")
	}
	if parsed.Scheme != "redis" && parsed.Scheme != "" {
		return redisTarget{}, fmt.Errorf("redis URL: unsupported scheme %q", parsed.Scheme)
	}
	host := parsed.Host
	if host == "" {
		return redisTarget{}, errors.New("redis URL: no host")
	}
	if parsed.Port() == "" {
		host = net.JoinHostPort(host, "6379")
	}
	target := redisTarget{address: host}
	if parsed.User != nil {
		target.username = parsed.User.Username()
		target.password, _ = parsed.User.Password()
	}
	return target, nil
}

// redisCommand sends one or more RESP commands on a fresh connection and
// returns an error on the first non-OK reply.
func redisCommand(ctx context.Context, rawURL string, commands ...[]string) error {
	target, err := parseRedisURL(rawURL)
	if err != nil {
		return err
	}
	dialer := &net.Dialer{Timeout: redisDialTimeout}
	connection, err := dialer.DialContext(ctx, "tcp", target.address)
	if err != nil {
		return fmt.Errorf("redis %s: %w", target.address, err)
	}
	defer connection.Close()
	_ = connection.SetDeadline(connectionDeadline(ctx))

	reader := bufio.NewReader(connection)
	for _, command := range append(authCommands(target), commands...) {
		if err := writeRESPCommand(connection, command); err != nil {
			return fmt.Errorf("redis %s: %w", command[0], err)
		}
		if err := readRESPStatus(reader); err != nil {
			return fmt.Errorf("redis %s: %w", command[0], err)
		}
	}
	return nil
}

// authCommands prefixes the AUTH the URL's credentials imply, if any.
func authCommands(target redisTarget) [][]string {
	if target.password == "" {
		return nil
	}
	if target.username != "" {
		return [][]string{{"AUTH", target.username, target.password}}
	}
	return [][]string{{"AUTH", target.password}}
}

// connectionDeadline bounds a Redis exchange by the context's deadline, or
// the dial timeout when it has none.
func connectionDeadline(ctx context.Context) time.Time {
	if deadline, ok := ctx.Deadline(); ok {
		return deadline
	}
	return time.Now().Add(redisDialTimeout)
}

// writeRESPCommand encodes one command as a RESP array of bulk strings.
func writeRESPCommand(connection net.Conn, command []string) error {
	var encoded strings.Builder
	fmt.Fprintf(&encoded, "*%d\r\n", len(command))
	for _, argument := range command {
		fmt.Fprintf(&encoded, "$%d\r\n%s\r\n", len(argument), argument)
	}
	_, err := connection.Write([]byte(encoded.String()))
	return err
}

// readRESPStatus reads one reply, accepting simple strings and integers and
// reporting a RESP error as an error.
func readRESPStatus(reader *bufio.Reader) error {
	line, err := reader.ReadString('\n')
	if err != nil {
		return err
	}
	line = strings.TrimRight(line, "\r\n")
	if line == "" {
		return errors.New("empty reply")
	}
	switch line[0] {
	case '+', ':':
		return nil
	case '-':
		return errors.New(strings.TrimSpace(line[1:]))
	default:
		return fmt.Errorf("unexpected reply %q", line)
	}
}

// redisPing checks a Redis endpoint answers, for the boot preflight.
func redisPing(ctx context.Context, rawURL string) error {
	return redisCommand(ctx, rawURL, []string{"PING"})
}

// redisFlushDB empties one logical database. Postgres and ClickHouse are
// recreated per run; Redis was not, so a previous run's queues, idempotency
// ledger and caches survived into the next run's instance.
func redisFlushDB(ctx context.Context, rawURL string, index int) error {
	return redisCommand(ctx, rawURL,
		[]string{"SELECT", strconv.Itoa(index)},
		[]string{"FLUSHDB"},
	)
}
