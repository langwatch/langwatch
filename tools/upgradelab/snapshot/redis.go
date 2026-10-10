package snapshot

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"iter"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// RedisKey is one line of redis.jsonl: the key, its type, its remaining TTL and its DUMP payload.
type RedisKey struct {
	Key  string `json:"key"`
	Type string `json:"type"`
	PTTL int64  `json:"pttl"`
	Dump []byte `json:"dump"`
}

// Redis is the stack's database index only.
type Redis interface {
	Scan(ctx context.Context, visit func(RedisKey) error) error
	Restore(ctx context.Context, keys iter.Seq2[RedisKey, error]) error
	Size(ctx context.Context) (int, error)
}

// RedisRESP speaks RESP2 over TCP: SCAN, TYPE, PTTL, DUMP, RESTORE, DBSIZE. No TLS yet.
type RedisRESP struct {
	address  string
	username string
	password string
	database string
}

// NewRedisRESP reads redis://[user:password@]host:port[/index].
func NewRedisRESP(raw string) (*RedisRESP, error) {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "redis" {
		return nil, fmt.Errorf("redis url must be redis://host:port/index (rediss is not supported yet)")
	}
	database := strings.TrimPrefix(parsed.Path, "/")
	if database == "" {
		database = "0"
	}
	if _, err := strconv.Atoi(database); err != nil {
		return nil, fmt.Errorf("redis url database index %q is not a number", database)
	}
	password, _ := parsed.User.Password()
	return &RedisRESP{address: parsed.Host, username: parsed.User.Username(), password: password, database: database}, nil
}

type respConn struct {
	conn   net.Conn
	reader *bufio.Reader
}

func (redis *RedisRESP) session(ctx context.Context, work func(*respConn) error) error {
	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", redis.address)
	if err != nil {
		return err
	}
	defer conn.Close()
	deadline, ok := ctx.Deadline()
	if !ok {
		deadline = time.Now().Add(30 * time.Minute)
	}
	_ = conn.SetDeadline(deadline)
	client := &respConn{conn: conn, reader: bufio.NewReader(conn)}
	if redis.password != "" {
		auth := []string{"AUTH", redis.password}
		if redis.username != "" {
			auth = []string{"AUTH", redis.username, redis.password}
		}
		if _, err := client.do(auth...); err != nil {
			return err
		}
	}
	if _, err := client.do("SELECT", redis.database); err != nil {
		return err
	}
	return work(client)
}

// busyFor bounds how long a BUSY reply (a script holding Redis) is retried.
const busyFor = 2 * time.Minute

func (client *respConn) do(args ...string) (any, error) {
	giveUp := time.Now().Add(busyFor)
	for {
		reply, err := client.send(args...)
		if err == nil || !strings.HasPrefix(err.Error(), "redis: BUSY") || time.Now().After(giveUp) {
			return reply, err
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func (client *respConn) send(args ...string) (any, error) {
	var request strings.Builder
	fmt.Fprintf(&request, "*%d\r\n", len(args))
	for _, arg := range args {
		fmt.Fprintf(&request, "$%d\r\n%s\r\n", len(arg), arg)
	}
	if _, err := io.WriteString(client.conn, request.String()); err != nil {
		return nil, err
	}
	return client.read()
}

func (client *respConn) read() (any, error) {
	line, err := client.reader.ReadString('\n')
	if err != nil {
		return nil, err
	}
	line = strings.TrimSuffix(line, "\r\n")
	if line == "" {
		return nil, errors.New("redis: empty reply")
	}
	switch line[0] {
	case '+':
		return line[1:], nil
	case '-':
		return nil, errors.New("redis: " + line[1:])
	case ':':
		return strconv.ParseInt(line[1:], 10, 64)
	case '$':
		return client.readBulk(line[1:])
	case '*':
		return client.readArray(line[1:])
	}
	return nil, fmt.Errorf("redis: unexpected reply %q", line[:1])
}

// readBulk reads a bulk string; a negative size is the nil reply.
func (client *respConn) readBulk(header string) (any, error) {
	size, err := strconv.Atoi(header)
	if err != nil || size < 0 {
		return nil, err
	}
	buffer := make([]byte, size+2)
	_, err = io.ReadFull(client.reader, buffer)
	return buffer[:size], err
}

func (client *respConn) readArray(header string) (any, error) {
	size, err := strconv.Atoi(header)
	if err != nil || size < 0 {
		return nil, err
	}
	items := make([]any, size)
	for index := range items {
		if items[index], err = client.read(); err != nil {
			return nil, err
		}
	}
	return items, nil
}

// Scan calls visit for each key of the index in SCAN order, one page of names at a time, so
// memory stays bounded by one key. A key gone since the SCAN is skipped; ctx is honored per key.
func (redis *RedisRESP) Scan(ctx context.Context, visit func(RedisKey) error) error {
	return redis.session(ctx, func(client *respConn) error {
		for cursor := "0"; ; {
			page, err := client.scanPage(cursor)
			if err != nil {
				return err
			}
			for _, name := range page.names {
				if err := ctx.Err(); err != nil {
					return err
				}
				key, found, err := client.describeKey(name)
				if err != nil {
					return err
				}
				if found {
					if err := visit(key); err != nil {
						return err
					}
				}
			}
			if cursor = page.cursor; cursor == "0" {
				return nil
			}
		}
	})
}

type scanPage struct {
	cursor string
	names  []string
}

func (client *respConn) scanPage(cursor string) (scanPage, error) {
	reply, err := client.do("SCAN", cursor, "COUNT", "1000")
	if err != nil {
		return scanPage{}, err
	}
	page, ok := reply.([]any)
	if !ok || len(page) != 2 {
		return scanPage{}, errors.New("redis: malformed SCAN reply")
	}
	next, ok := page[0].([]byte)
	items, okItems := page[1].([]any)
	if !ok || !okItems {
		return scanPage{}, errors.New("redis: malformed SCAN reply")
	}
	result := scanPage{cursor: string(next)}
	for _, item := range items {
		name, ok := item.([]byte)
		if !ok {
			return scanPage{}, errors.New("redis: malformed SCAN reply")
		}
		result.names = append(result.names, string(name))
	}
	return result, nil
}

func (client *respConn) describeKey(name string) (RedisKey, bool, error) {
	kind, err := client.do("TYPE", name)
	if err != nil {
		return RedisKey{}, false, err
	}
	ttl, err := client.do("PTTL", name)
	if err != nil {
		return RedisKey{}, false, err
	}
	payload, err := client.do("DUMP", name)
	if err != nil {
		return RedisKey{}, false, err
	}
	dump, found := payload.([]byte)
	millis, _ := ttl.(int64)
	return RedisKey{Key: name, Type: fmt.Sprint(kind), PTTL: millis, Dump: dump}, found, nil
}

// Restore writes each key with RESTORE and its remaining TTL (0 keeps it forever), one at a time.
func (redis *RedisRESP) Restore(ctx context.Context, keys iter.Seq2[RedisKey, error]) error {
	return redis.session(ctx, func(client *respConn) error {
		for key, err := range keys {
			if err != nil {
				return err
			}
			if err := ctx.Err(); err != nil {
				return err
			}
			ttl := max(key.PTTL, 0)
			if _, err := client.do("RESTORE", key.Key, strconv.FormatInt(ttl, 10), string(key.Dump)); err != nil {
				return fmt.Errorf("restore %s: %w", key.Key, err)
			}
		}
		return nil
	})
}

// Size is DBSIZE.
func (redis *RedisRESP) Size(ctx context.Context) (int, error) {
	var size int
	err := redis.session(ctx, func(client *respConn) error {
		reply, err := client.do("DBSIZE")
		if err == nil {
			count, _ := reply.(int64)
			size = int(count)
		}
		return err
	})
	return size, err
}
