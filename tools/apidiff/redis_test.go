package apidiff

import (
	"bufio"
	"context"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"testing"
)

// fakeRedis is a socket that speaks just enough RESP to record the commands
// boot sends and answer +OK to each.
type fakeRedis struct {
	listener net.Listener
	mutex    sync.Mutex
	commands []string
}

func startFakeRedis(t *testing.T) *fakeRedis {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &fakeRedis{listener: listener}
	go server.serve()
	t.Cleanup(func() { _ = listener.Close() })
	return server
}

func (server *fakeRedis) serve() {
	for {
		connection, err := server.listener.Accept()
		if err != nil {
			return
		}
		go server.handle(connection)
	}
}

// handle reads RESP arrays of bulk strings and answers +OK to every command.
func (server *fakeRedis) handle(connection net.Conn) {
	defer connection.Close()
	reader := bufio.NewReader(connection)
	for {
		header, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		if !strings.HasPrefix(header, "*") {
			return
		}
		arguments, err := strconv.Atoi(strings.TrimSpace(header[1:]))
		if err != nil {
			return
		}
		parts := make([]string, 0, arguments)
		for index := 0; index < arguments; index++ {
			if _, err := reader.ReadString('\n'); err != nil { // $<len>
				return
			}
			value, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			parts = append(parts, strings.TrimSpace(value))
		}
		server.mutex.Lock()
		server.commands = append(server.commands, strings.Join(parts, " "))
		server.mutex.Unlock()
		if _, err := connection.Write([]byte("+OK\r\n")); err != nil {
			return
		}
	}
}

func (server *fakeRedis) recorded() []string {
	server.mutex.Lock()
	defer server.mutex.Unlock()
	recorded := make([]string, len(server.commands))
	copy(recorded, server.commands)
	return recorded
}

func (server *fakeRedis) url() string {
	return "redis://" + server.listener.Addr().String()
}

func TestRedisIndicesNeverNameTheDeveloperDatabase(t *testing.T) {
	for _, runID := range []string{"work", "run", "20260906-120000", "apidiff", "x"} {
		branch, main, err := RedisIndices(runID)
		if err != nil {
			t.Fatal(err)
		}
		if branch == 0 || main == 0 {
			t.Fatalf("run %q derived logical database 0 (%d/%d), which a developer's own stack uses", runID, branch, main)
		}
	}
}

func TestRedisIndicesAreRunScopedAndDistinct(t *testing.T) {
	branch, main, err := RedisIndices("20260906-120000")
	if err != nil {
		t.Fatal(err)
	}
	if branch == main {
		t.Fatalf("both instances got DB %d", branch)
	}
	for _, index := range []int{branch, main} {
		if index < 0 || index >= redisLogicalDBs {
			t.Fatalf("index %d outside the 0..%d range", index, redisLogicalDBs-1)
		}
	}
	// Two concurrent runs must not share a logical database.
	otherBranch, otherMain, err := RedisIndices("20260906-130000")
	if err != nil {
		t.Fatal(err)
	}
	if branch == otherBranch && main == otherMain {
		t.Fatal("different runs resolved to the same pair of Redis databases")
	}
	// The same run id always resolves the same way.
	repeatBranch, repeatMain, err := RedisIndices("20260906-120000")
	if err != nil {
		t.Fatal(err)
	}
	if repeatBranch != branch || repeatMain != main {
		t.Fatalf("run id is not stable: %d/%d then %d/%d", branch, main, repeatBranch, repeatMain)
	}
}

func TestParseRedisURL(t *testing.T) {
	target, err := parseRedisURL("redis://127.0.0.1:6379")
	if err != nil || target.address != "127.0.0.1:6379" {
		t.Fatalf("plain URL = %+v, %v", target, err)
	}
	withDefaultPort, err := parseRedisURL("redis://cache")
	if err != nil || withDefaultPort.address != "cache:6379" {
		t.Fatalf("default port = %+v, %v", withDefaultPort, err)
	}
	withAuth, err := parseRedisURL("redis://user:secret@127.0.0.1:6379")
	if err != nil || withAuth.password != "secret" || withAuth.username != "user" {
		t.Fatalf("credentials = %+v, %v", withAuth, err)
	}
	if _, err := parseRedisURL("rediss://127.0.0.1:6379"); err == nil {
		t.Fatal("TLS endpoints must be refused, not silently downgraded")
	}
	if _, err := parseRedisURL("redis://"); err == nil {
		t.Fatal("a URL with no host must error")
	}
}

// Redis was the one datastore no run ever reset: DB 15 still held 83 keys
// from the previous run when the review measured it.
func TestRedisFlushDBSelectsThenFlushes(t *testing.T) {
	server := startFakeRedis(t)
	if err := redisFlushDB(context.Background(), server.url(), 7); err != nil {
		t.Fatal(err)
	}
	want := []string{"SELECT 7", "FLUSHDB"}
	got := server.recorded()
	if len(got) != len(want) {
		t.Fatalf("commands = %v, want %v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("command %d = %q, want %q", index, got[index], want[index])
		}
	}
}

func TestRedisPing(t *testing.T) {
	server := startFakeRedis(t)
	if err := redisPing(context.Background(), server.url()); err != nil {
		t.Fatal(err)
	}
	if got := server.recorded(); len(got) != 1 || got[0] != "PING" {
		t.Fatalf("commands = %v, want [PING]", got)
	}
}

func TestPrepareDatabasesFlushesBothIndices(t *testing.T) {
	server := startFakeRedis(t)
	state := &bootState{
		cfg:    BootConfig{},
		stderr: io.Discard,
		run:    func(context.Context, commandSpec, io.Writer) error { return nil },
	}
	state.infra = infraURLs{redisServer: server.url(), branchRedis: 3, mainRedis: 11}
	if err := state.flushRedis(context.Background()); err != nil {
		t.Fatal(err)
	}
	joined := strings.Join(server.recorded(), "|")
	for _, want := range []string{"SELECT 3", "SELECT 11", "FLUSHDB"} {
		if !strings.Contains(joined, want) {
			t.Fatalf("recorded %q, missing %q", joined, want)
		}
	}
}
