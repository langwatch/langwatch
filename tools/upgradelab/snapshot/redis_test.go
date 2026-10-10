package snapshot

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"maps"
	"net"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// A BUSY reply (a script holding Redis) is retried, not failed: SELECT answers BUSY once, then works.
func TestRedisRetriesBusy(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		reader, busy := bufio.NewReader(conn), true
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			if !strings.HasPrefix(line, "*") {
				continue
			}
			command := readCommand(reader, line)
			switch {
			case command == "SELECT" && busy:
				busy = false
				_, _ = conn.Write([]byte("-BUSY Redis is busy running a script.\r\n"))
			case command == "SELECT":
				_, _ = conn.Write([]byte("+OK\r\n"))
			default:
				_, _ = conn.Write([]byte(":3\r\n"))
			}
		}
	}()
	redis, err := NewRedisRESP("redis://" + listener.Addr().String() + "/0")
	if err != nil {
		t.Fatal(err)
	}
	size, err := redis.Size(context.Background())
	if err != nil || size != 3 {
		t.Fatalf("size %d, err %v: want 3 after one BUSY", size, err)
	}
}

// readCommand consumes one RESP array whose header is line and answers its first word.
func readCommand(reader *bufio.Reader, header string) string {
	count := 0
	for _, char := range strings.TrimSpace(header[1:]) {
		count = count*10 + int(char-'0')
	}
	first := ""
	for i := range count {
		_, _ = reader.ReadString('\n')
		word, _ := reader.ReadString('\n')
		if i == 0 {
			first = strings.TrimSpace(word)
		}
	}
	return first
}

// fakeRedisServer is a RESP server over a key map: SELECT, SCAN (3 names a page), TYPE, PTTL, DUMP, RESTORE.
func fakeRedisServer(t *testing.T, store map[string][]byte) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go serveFakeRedis(conn, store)
		}
	}()
	return listener.Addr().String()
}

func serveFakeRedis(conn net.Conn, store map[string][]byte) {
	defer conn.Close()
	reader := bufio.NewReader(conn)
	for {
		header, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		args := readArgs(reader, header)
		switch args[0] {
		case "SCAN":
			names := slices.Sorted(maps.Keys(store))
			start, _ := strconv.Atoi(args[1])
			end := min(start+3, len(names))
			next := strconv.Itoa(end)
			if end == len(names) {
				next = "0"
			}
			reply := fmt.Sprintf("*2\r\n$%d\r\n%s\r\n*%d\r\n", len(next), next, end-start)
			for _, name := range names[start:end] {
				reply += fmt.Sprintf("$%d\r\n%s\r\n", len(name), name)
			}
			_, _ = conn.Write([]byte(reply))
		case "TYPE":
			_, _ = conn.Write([]byte("+string\r\n"))
		case "PTTL":
			_, _ = conn.Write([]byte(":-1\r\n"))
		case "DUMP":
			_, _ = fmt.Fprintf(conn, "$%d\r\n%s\r\n", len(store[args[1]]), store[args[1]])
		case "RESTORE":
			store[args[1]] = []byte(args[3])
			_, _ = conn.Write([]byte("+OK\r\n"))
		default:
			_, _ = conn.Write([]byte("+OK\r\n"))
		}
	}
}

func readArgs(reader *bufio.Reader, header string) []string {
	count, _ := strconv.Atoi(strings.TrimSpace(header[1:]))
	args := make([]string, count)
	for i := range args {
		_, _ = reader.ReadString('\n')
		word, _ := reader.ReadString('\n')
		args[i] = strings.TrimSuffix(word, "\r\n")
	}
	return args
}

// 50 keys scan out and restore back one at a time; a cancelled context stops the scan between keys.
func TestRedisStreamsRoundTrip(t *testing.T) {
	source := map[string][]byte{}
	for i := range 50 {
		source[fmt.Sprintf("bull:q%02d:{x}", i)] = []byte(strings.Repeat("v", i+1))
	}
	redis, err := NewRedisRESP("redis://" + fakeRedisServer(t, source) + "/0")
	if err != nil {
		t.Fatal(err)
	}
	var scanned []RedisKey
	if err := redis.Scan(context.Background(), func(key RedisKey) error {
		scanned = append(scanned, key)
		return nil
	}); err != nil || len(scanned) != 50 {
		t.Fatalf("scanned %d keys, err %v", len(scanned), err)
	}
	target := map[string][]byte{}
	copyTo, _ := NewRedisRESP("redis://" + fakeRedisServer(t, target) + "/0")
	keys := func(yield func(RedisKey, error) bool) {
		for _, key := range scanned {
			if !yield(key, nil) {
				return
			}
		}
	}
	if err := copyTo.Restore(context.Background(), keys); err != nil || len(target) != 50 {
		t.Fatalf("restored %d keys, err %v", len(target), err)
	}
	for name, dump := range source {
		if string(target[name]) != string(dump) {
			t.Fatalf("%s differs after round trip", name)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	seen := 0
	err = redis.Scan(ctx, func(RedisKey) error {
		if seen++; seen == 4 {
			cancel()
		}
		return nil
	})
	if !errors.Is(err, context.Canceled) || seen != 4 {
		t.Fatalf("scan after cancel: seen %d, err %v", seen, err)
	}
}

func TestRedisPrefixHistogram(t *testing.T) {
	for key, want := range map[string]string{"bull:{q}:1": "bull", "fold:trace:abc": "fold:trace", "plain": "plain", "a:b": "a:b"} {
		if got := redisPrefix(key); got != want {
			t.Errorf("redisPrefix(%q) = %q, want %q", key, got, want)
		}
	}
	sizes := redisPrefixSizes{}
	sizes.add(RedisKey{Key: "a:b:1", Dump: make([]byte, 5)})
	sizes.add(RedisKey{Key: "a:b:2", Dump: make([]byte, 5)})
	sizes.add(RedisKey{Key: "c:d:1", Dump: make([]byte, 50)})
	if top := sizes.top(1); len(top) != 1 || top[0].Prefix != "c:d" || sizes.top(5)[1].Keys != 2 {
		t.Fatalf("top = %v", sizes.top(5))
	}
}
