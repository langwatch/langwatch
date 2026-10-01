package visualdiff

import (
	"bufio"
	"context"
	"errors"
	"net"
	"strconv"
	"strings"
	"testing"
)

// @scenario A run allocates two Redis databases that cannot collide with a developer's own stack
func TestAllocateRedisDBsNeverPicksZeroOrARegisteredOrDirtyDatabase(t *testing.T) {
	tests := []struct {
		name       string
		registered map[int]bool
		dirty      map[int]bool // indices whose DBSIZE is reported non-zero
		want       RedisAllocation
		wantErr    string
	}{
		{
			name:       "an empty, unregistered pair of databases wins the lowest two indices",
			registered: nil,
			dirty:      nil,
			want:       RedisAllocation{Base: 1, Candidate: 2},
		},
		{
			name:       "database 0 is never picked even when nothing else excludes it",
			registered: map[int]bool{1: true, 2: true, 3: true},
			dirty:      nil,
			want:       RedisAllocation{Base: 4, Candidate: 5},
		},
		{
			name:       "a registered stack's database is skipped",
			registered: map[int]bool{1: true, 3: true},
			dirty:      nil,
			want:       RedisAllocation{Base: 2, Candidate: 4},
		},
		{
			name:       "a database with residue is skipped even though nothing registered it",
			registered: nil,
			dirty:      map[int]bool{1: true, 2: true},
			want:       RedisAllocation{Base: 3, Candidate: 4},
		},
		{
			name:       "registered and dirty exclusions combine",
			registered: map[int]bool{1: true},
			dirty:      map[int]bool{2: true, 3: true},
			want:       RedisAllocation{Base: 4, Candidate: 5},
		},
		{
			name:       "every database taken leaves nothing to allocate",
			registered: allExcept(map[int]bool{}, 0),
			dirty:      nil,
			wantErr:    "no two free redis logical databases",
		},
		{
			name:       "only one free database is not enough for two stacks",
			registered: allExcept(map[int]bool{}, 0, 5),
			dirty:      nil,
			wantErr:    "no two free redis logical databases",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var registeredFn RegisteredRedisDBs
			if test.registered != nil {
				registeredFn = func() (map[int]bool, error) { return test.registered, nil }
			}
			probed := map[int]bool{}
			size := func(index int) (int64, error) {
				probed[index] = true
				if test.dirty[index] {
					return 42, nil
				}
				return 0, nil
			}

			got, err := AllocateRedisDBs(registeredFn, size)

			if test.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), test.wantErr) {
					t.Fatalf("error = %v, want to contain %q", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != test.want {
				t.Fatalf("allocation = %+v, want %+v", got, test.want)
			}
			if got.Base == 0 || got.Candidate == 0 {
				t.Fatalf("allocation used database 0, the developer's own stack: %+v", got)
			}
			if !probed[got.Base] || !probed[got.Candidate] {
				t.Fatalf("the chosen databases were never DBSIZE-probed: %+v (probed %v)", got, probed)
			}
		})
	}
}

// allExcept builds a "taken" map covering every logical database except the
// ones listed, so a test can describe "everything but N is full" tersely.
func allExcept(base map[int]bool, keep ...int) map[int]bool {
	skip := map[int]bool{}
	for _, index := range keep {
		skip[index] = true
	}
	for index := 0; index < redisDBCount; index++ {
		if !skip[index] {
			base[index] = true
		}
	}
	return base
}

// @scenario A run allocates two Redis databases that cannot collide with a developer's own stack
func TestAllocateRedisDBsPropagatesARegistryFailure(t *testing.T) {
	registered := func() (map[int]bool, error) { return nil, errors.New("haven status: boom") }
	size := func(int) (int64, error) { return 0, nil }

	if _, err := AllocateRedisDBs(registered, size); err == nil || !strings.Contains(err.Error(), "boom") {
		t.Fatalf("a registry failure must surface, got %v", err)
	}
}

// @scenario A run allocates two Redis databases that cannot collide with a developer's own stack
func TestAllocateRedisDBsPropagatesADBSizeFailure(t *testing.T) {
	size := func(int) (int64, error) { return 0, errors.New("dial tcp: connection refused") }

	if _, err := AllocateRedisDBs(nil, size); err == nil || !strings.Contains(err.Error(), "connection refused") {
		t.Fatalf("a DBSIZE failure must surface, got %v", err)
	}
}

func TestAllocateRedisDBsRequiresASizeProbe(t *testing.T) {
	if _, err := AllocateRedisDBs(nil, nil); err == nil {
		t.Fatal("a nil DBSIZE probe must be refused, not silently skipped")
	}
}

// @scenario If haven is not on PATH the registry step is skipped
func TestHavenRegisteredRedisDBsSkipsWhenHavenIsNotOnPATH(t *testing.T) {
	t.Setenv("PATH", t.TempDir()) // guaranteed to hold no "haven" binary

	got, err := HavenRegisteredRedisDBs(context.Background())

	if err != nil {
		t.Fatalf("a missing haven binary must be skipped, not errored: %v", err)
	}
	if got != nil {
		t.Fatalf("a missing haven binary must report no exclusions: %v", got)
	}
}

// fakeRedisDBSize is a socket that speaks just enough RESP to answer SELECT
// with +OK and DBSIZE with a scripted integer per logical database.
type fakeRedisDBSize struct {
	listener net.Listener
	sizes    map[int]int64
}

func startFakeRedisDBSize(t *testing.T, sizes map[int]int64) *fakeRedisDBSize {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := &fakeRedisDBSize{listener: listener, sizes: sizes}
	go server.serve()
	t.Cleanup(func() { _ = listener.Close() })
	return server
}

func (server *fakeRedisDBSize) serve() {
	for {
		connection, err := server.listener.Accept()
		if err != nil {
			return
		}
		go server.handle(connection)
	}
}

func (server *fakeRedisDBSize) handle(connection net.Conn) {
	defer connection.Close()
	reader := bufio.NewReader(connection)
	selectedIndex := 0
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
		switch strings.ToUpper(parts[0]) {
		case "SELECT":
			selectedIndex, _ = strconv.Atoi(parts[1])
			if _, err := connection.Write([]byte("+OK\r\n")); err != nil {
				return
			}
		case "DBSIZE":
			size := server.sizes[selectedIndex]
			if _, err := connection.Write([]byte(":" + strconv.FormatInt(size, 10) + "\r\n")); err != nil {
				return
			}
		default:
			if _, err := connection.Write([]byte("-ERR unknown command\r\n")); err != nil {
				return
			}
		}
	}
}

func (server *fakeRedisDBSize) url() string {
	return "redis://" + server.listener.Addr().String()
}

// @scenario A run allocates two Redis databases that cannot collide with a developer's own stack
func TestRedisDBSizeSelectsThenReportsTheCount(t *testing.T) {
	server := startFakeRedisDBSize(t, map[int]int64{1: 0, 2: 83})

	empty, err := redisDBSize(context.Background(), server.url(), 1)
	if err != nil || empty != 0 {
		t.Fatalf("db 1 = %d, %v, want 0, nil", empty, err)
	}
	dirty, err := redisDBSize(context.Background(), server.url(), 2)
	if err != nil || dirty != 83 {
		t.Fatalf("db 2 = %d, %v, want 83, nil", dirty, err)
	}
}

// @scenario A run allocates two Redis databases that cannot collide with a developer's own stack
func TestNewRedisDBSizeProbeFeedsAllocateRedisDBs(t *testing.T) {
	server := startFakeRedisDBSize(t, map[int]int64{1: 5, 2: 0, 3: 0})
	probe := NewRedisDBSizeProbe(context.Background(), server.url())

	allocation, err := AllocateRedisDBs(nil, probe)
	if err != nil {
		t.Fatal(err)
	}
	if allocation != (RedisAllocation{Base: 2, Candidate: 3}) {
		t.Fatalf("allocation = %+v, want the two empty databases 2 and 3", allocation)
	}
}
