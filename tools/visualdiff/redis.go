package visualdiff

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Redis has no administrative CLI in this package's allowlist, so the one
// operation the allocator needs - DBSIZE, to check a candidate logical
// database is actually empty before claiming it - speaks RESP directly over
// a socket. This mirrors tools/apidiff/redis.go's shape (that package is not
// imported from here - the two tools do not depend on each other - so the
// handful of RESP lines are duplicated rather than shared).

const redisDialTimeout = 5 * time.Second

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
		return redisTarget{}, errors.New("redis URL: rediss:// (TLS) is not supported by the visualdiff redis probe")
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

// readRESPReply reads one reply line, accepting simple strings and integers
// (returning their text verbatim) and reporting a RESP error as an error.
func readRESPReply(reader *bufio.Reader) (string, error) {
	line, err := reader.ReadString('\n')
	if err != nil {
		return "", err
	}
	line = strings.TrimRight(line, "\r\n")
	if line == "" {
		return "", errors.New("empty reply")
	}
	switch line[0] {
	case '+', ':':
		return line[1:], nil
	case '-':
		return "", errors.New(strings.TrimSpace(line[1:]))
	default:
		return "", fmt.Errorf("unexpected reply %q", line)
	}
}

// redisDBSize opens a fresh connection, selects one logical database and
// asks its DBSIZE - the count AllocateRedisDBs uses to refuse a database
// that is not empty, registered or not.
func redisDBSize(ctx context.Context, rawURL string, index int) (int64, error) {
	target, err := parseRedisURL(rawURL)
	if err != nil {
		return 0, err
	}
	dialer := &net.Dialer{Timeout: redisDialTimeout}
	connection, err := dialer.DialContext(ctx, "tcp", target.address)
	if err != nil {
		return 0, fmt.Errorf("redis %s: %w", target.address, err)
	}
	defer connection.Close()
	_ = connection.SetDeadline(connectionDeadline(ctx))

	reader := bufio.NewReader(connection)
	commands := append(authCommands(target), []string{"SELECT", strconv.Itoa(index)}, []string{"DBSIZE"})
	var last string
	for _, command := range commands {
		if err := writeRESPCommand(connection, command); err != nil {
			return 0, fmt.Errorf("redis %s: %w", command[0], err)
		}
		reply, err := readRESPReply(reader)
		if err != nil {
			return 0, fmt.Errorf("redis %s: %w", command[0], err)
		}
		last = reply
	}
	size, err := strconv.ParseInt(last, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("redis DBSIZE %d: unexpected reply %q", index, last)
	}
	return size, nil
}

// NewRedisDBSizeProbe binds a live RedisDBSize probe to one server, for the
// real allocation path. The context each call receives comes from the caller
// of the returned function, so a run-wide timeout still applies to every
// dial.
func NewRedisDBSizeProbe(ctx context.Context, rawURL string) RedisDBSize {
	return func(index int) (int64, error) {
		return redisDBSize(ctx, rawURL, index)
	}
}
