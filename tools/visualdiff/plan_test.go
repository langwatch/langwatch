package visualdiff

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// @scenario A run boots both refs on ports that cannot collide
func TestPlanStacksAllocatesDistinctPorts(t *testing.T) {
	base, candidate := PlanStacks(DefaultBasePort, Refs{Base: "origin/main", Candidate: "HEAD"}, "/tmp/run")

	if base.Ports.UI == candidate.Ports.UI || base.Ports.API == candidate.Ports.API || base.Ports.Worker == candidate.Ports.Worker {
		t.Fatalf("stacks share a lane port: %+v vs %+v", base.Ports, candidate.Ports)
	}
	seen := map[int]string{}
	for name, ports := range map[string]Ports{"base": base.Ports, "candidate": candidate.Ports} {
		for _, port := range ports.All() {
			if previous, clash := seen[port]; clash {
				t.Fatalf("port %d used by both %s and %s", port, previous, name)
			}
			seen[port] = name
		}
	}
	if base.RedisDBIndex == candidate.RedisDBIndex {
		t.Fatalf("both stacks would share redis database %s", base.RedisDBIndex)
	}
}

// @scenario A ref on the monolith layout boots with the migration steps skipped
func TestMonolithStackSkipsMigrations(t *testing.T) {
	stack := Stack{Name: "base", BasePort: 5670, Ports: PortsFor(5670), Layout: LayoutMonolith, RedisDBIndex: "13"}

	env := stack.Env([]string{"PORT=1", "HOME=/home/someone"})

	for _, wanted := range []string{"SKIP_PRISMA_MIGRATE=true", "SKIP_CLICKHOUSE_MIGRATE=true", "SKIP_LWQL_PROVISION=true"} {
		if !hasEnv(env, wanted) {
			t.Fatalf("monolith env is missing %s: %v", wanted, env)
		}
	}
	if !hasEnv(env, "HOME=/home/someone") {
		t.Fatal("the inherited environment was dropped")
	}
	if hasEnv(env, "PORT=1") {
		t.Fatal("an inherited PORT overrode the stack's own port")
	}

	modular := Stack{Name: "candidate", BasePort: 5680, Ports: PortsFor(5680), Layout: LayoutModular, RedisDBIndex: "12"}
	for _, unwanted := range []string{"SKIP_PRISMA_MIGRATE=true", "SKIP_CLICKHOUSE_MIGRATE=true", "SKIP_LWQL_PROVISION=true"} {
		if hasEnv(modular.Env(nil), unwanted) {
			t.Fatalf("modular env should not carry %s", unwanted)
		}
	}
}

func TestDetectLayoutReadsTheCheckout(t *testing.T) {
	modular := t.TempDir()
	mustWrite(t, filepath.Join(modular, "apps", "api", "package.json"), "{}")
	monolith := t.TempDir()
	mustWrite(t, filepath.Join(monolith, "platform", "app", "package.json"), "{}")

	if layout, err := DetectLayout(modular); err != nil || layout != LayoutModular {
		t.Fatalf("modular checkout: %v %v", layout, err)
	}
	if layout, err := DetectLayout(monolith); err != nil || layout != LayoutMonolith {
		t.Fatalf("monolith checkout: %v %v", layout, err)
	}
	if _, err := DetectLayout(t.TempDir()); err == nil {
		t.Fatal("an empty directory was accepted as a checkout")
	}
}

func TestStackStartCommandsCoverEveryProcess(t *testing.T) {
	modular := Stack{Layout: LayoutModular}
	if got := len(modular.StartCommands()); got != 3 {
		t.Fatalf("the modular layout runs three processes, always: got %d", got)
	}
	monolith := Stack{Layout: LayoutMonolith}
	if got := len(monolith.StartCommands()); got != 1 {
		t.Fatalf("the monolith serves everything from one process: got %d", got)
	}
}

func hasEnv(env []string, entry string) bool {
	for _, candidate := range env {
		if candidate == entry {
			return true
		}
	}
	return false
}

func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func mustContain(t *testing.T, haystack, needle string) {
	t.Helper()
	if !strings.Contains(haystack, needle) {
		t.Fatalf("expected %q in:\n%s", needle, haystack)
	}
}
