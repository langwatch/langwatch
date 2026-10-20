package domain

import (
	"slices"
	"strings"
	"testing"
)

func TestInfraKindOfCommand(t *testing.T) {
	cases := map[string]InfraKind{
		"/opt/homebrew/opt/redis/bin/redis-server 127.0.0.1:6379": InfraRedis,
		"redis-server *:53114": InfraRedis,
		"/opt/homebrew/opt/postgresql@16/bin/postgres -D /opt/homebrew/var":  InfraPostgres,
		"/h/clickhouse-native/clickhouse server --config-file=/h/config.xml": InfraClickHouse,
		"tempo -config.file=/h/tempo.yaml":                                   InfraTempo,
		"alloy run --server.http.listen-addr=127.0.0.1:12345":                InfraCollector,
		"grafana server --homepath /opt/homebrew/share/grafana":              InfraGrafana,
	}
	for cmd, want := range cases {
		if got, ok := InfraKindOfCommand(cmd); !ok || got != want {
			t.Errorf("InfraKindOfCommand(%q) = %q, %v; want %q", cmd, got, ok, want)
		}
	}
	for _, cmd := range []string{"redis-cli -p 6379", "postgres: checkpointer", "clickhouse client", "grafana cli", "node server.js", ""} {
		if kind, ok := InfraKindOfCommand(cmd); ok {
			t.Errorf("InfraKindOfCommand(%q) = %q, want no kind", cmd, kind)
		}
	}
}

func TestCommandPort(t *testing.T) {
	cases := map[string]int{
		"redis-server *:53114":                                     53114,
		"redis-server 127.0.0.1:6379":                              6379,
		"redis-server --port 6380":                                 6380,
		"redis-server --port=6381":                                 6381,
		"postgres -D /x -p 5433":                                   5433,
		"prometheus --web.listen-address=127.0.0.1:9090":           9090,
		"clickhouse server --config-file=/h/config.xml":            0,
		"tempo -config.file=http://127.0.0.1:3200/path":            0,
		"/opt/homebrew/opt/postgresql@16/bin/postgres -D /usr/var": 0,
	}
	for cmd, want := range cases {
		if got := CommandPort(cmd); got != want {
			t.Errorf("CommandPort(%q) = %d, want %d", cmd, got, want)
		}
	}
}

func TestInfraKindsOfImage(t *testing.T) {
	if got := InfraKindsOfImage("grafana/otel-lgtm:0.11.1"); len(got) != 5 || !slices.Contains(got, InfraCollector) {
		t.Fatalf("lgtm kinds = %v, want the five observability kinds", got)
	}
	cases := map[string]InfraKind{
		"altinity/clickhouse-server:25.3": InfraClickHouse,
		"redis:7-alpine":                  InfraRedis,
		"docker.io/library/postgres:16":   InfraPostgres,
		"localhost:5000/redis":            InfraRedis,
		"otel/opentelemetry-collector":    InfraCollector,
	}
	for image, want := range cases {
		if got := InfraKindsOfImage(image); !slices.Equal(got, []InfraKind{want}) {
			t.Errorf("InfraKindsOfImage(%q) = %v, want [%s]", image, got, want)
		}
	}
	if got := InfraKindsOfImage("langwatch/langyagent:abc"); got != nil {
		t.Fatalf("langy image kinds = %v, want none", got)
	}
}

func TestParseInfraContainerListing(t *testing.T) {
	out := "abc\tlangwatch-clickhouse\taltinity/clickhouse-server:25.3\t127.0.0.1:8124->8123/tcp, :::9000->9000/tcp\tmaintainer=x,org.testcontainers=true\n" +
		"broken line\n"
	got := ParseInfraContainerListing(out)
	if len(got) != 1 || got[0].Name != "langwatch-clickhouse" || !slices.Equal(got[0].Ports, []int{8124, 9000}) || got[0].Labels["org.testcontainers"] != "true" {
		t.Fatalf("listing = %+v", got)
	}
}

func TestJudgeDuplicates(t *testing.T) {
	canonical := InfraInstance{Kind: InfraRedis, PID: 1, Port: 6379, Origin: "brew", Referenced: true}
	stray := InfraInstance{Kind: InfraRedis, PID: 9, Port: 53114, InScope: true, OldEnough: true}

	t.Run("a single copy is no duplicate", func(t *testing.T) {
		if g := JudgeDuplicates([]InfraInstance{stray}); len(g) != 0 {
			t.Fatalf("groups = %+v, want none", g)
		}
	})
	t.Run("an ownerless in-scope copy beside the canonical one is stopped", func(t *testing.T) {
		g := JudgeDuplicates([]InfraInstance{canonical, stray})
		if len(g) != 1 || g[0].Instances[0].Verdict != VerdictKept || g[0].Instances[1].Verdict != VerdictStop {
			t.Fatalf("groups = %+v", g)
		}
		if !slices.Equal(g[0].Kept(), []string{"brew pid 1 :6379"}) {
			t.Fatalf("kept = %v", g[0].Kept())
		}
	})
	t.Run("a copy whose owner runs is left and named", func(t *testing.T) {
		owned := stray
		owned.OwnerAlive, owned.Owner = true, "upgradelab cell (pid 8)"
		g := JudgeDuplicates([]InfraInstance{canonical, owned})
		want := "2 redis running: brew pid 1 :6379 (kept), pid 9 :53114 (owned by upgradelab cell (pid 8), left)"
		if g[0].Instances[1].Verdict != VerdictLeft || g[0].Describe() != want {
			t.Fatalf("describe = %q, want %q", g[0].Describe(), want)
		}
	})
	t.Run("nothing is stopped without a canonical copy", func(t *testing.T) {
		other := stray
		other.PID = 10
		g := JudgeDuplicates([]InfraInstance{stray, other})
		if g[0].Canonical || g[0].Instances[0].Verdict != VerdictLeft || g[0].Instances[1].Verdict != VerdictLeft {
			t.Fatalf("groups = %+v", g)
		}
	})
	t.Run("copies are listed referenced first, then by pid, whatever order they arrive in", func(t *testing.T) {
		low := stray
		low.PID = 5
		g := JudgeDuplicates([]InfraInstance{stray, low, canonical})
		var pids []int
		for _, i := range g[0].Instances {
			pids = append(pids, i.PID)
		}
		if !slices.Equal(pids, []int{1, 5, 9}) {
			t.Fatalf("pids = %v, want [1 5 9]", pids)
		}
	})
	t.Run("out of scope, protected and young copies are left", func(t *testing.T) {
		for _, mutate := range []func(*InfraInstance){
			func(i *InfraInstance) { i.InScope = false },
			func(i *InfraInstance) { i.Protected = true },
			func(i *InfraInstance) { i.OldEnough = false },
		} {
			c := stray
			mutate(&c)
			if v := JudgeDuplicates([]InfraInstance{canonical, c})[0].Instances[1]; v.Verdict != VerdictLeft || !strings.HasPrefix(v.Why, "left") {
				t.Fatalf("verdict = %+v, want left", v)
			}
		}
	})
}

func TestParseDuplicateMode(t *testing.T) {
	for in, want := range map[string]DuplicateMode{"": DuplicatesStop, "0": DuplicatesOff, "off": DuplicatesOff, "report": DuplicatesReport, "1": DuplicatesStop} {
		if got := ParseDuplicateMode(in); got != want {
			t.Errorf("ParseDuplicateMode(%q) = %q, want %q", in, got, want)
		}
	}
	if (DuplicateLimits{}).Enabled() {
		t.Fatal("zero limits must be off")
	}
	if !DefaultDuplicateLimits().Enabled() {
		t.Fatal("defaults must be on")
	}
}
