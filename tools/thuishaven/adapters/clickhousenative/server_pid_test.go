package clickhousenative

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func pidServer(t *testing.T, cmdlines map[string]string, listener string) *Server {
	t.Helper()
	s := New(t.TempDir(), domain.PinnedArtifact{}, domain.ClickHouseLimits{})
	if err := os.MkdirAll(s.home, 0o750); err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(endpoint{HTTPPort: 18123})
	if err := os.WriteFile(s.endpointPath(), b, 0o600); err != nil {
		t.Fatal(err)
	}
	s.runCmd = func(name string, args ...string) ([]byte, error) {
		if name == "lsof" {
			return []byte(listener), nil
		}
		return []byte(cmdlines[args[1]]), nil
	}
	return s
}

// @scenario "A server started by an older haven is found by its listening port"
func TestOwnedPIDFallsBackToListener(t *testing.T) {
	s := pidServer(t, nil, "4242\n")
	s.runCmd = func(name string, args ...string) ([]byte, error) {
		if name == "lsof" {
			return []byte("4242\n"), nil
		}
		return []byte("clickhouse server --config-file=" + s.configPath()), nil
	}
	pid, ok := s.ownedPID()
	if !ok || pid != 4242 {
		t.Fatalf("got %d %v", pid, ok)
	}
	if b, _ := os.ReadFile(s.pidPath()); strings.TrimSpace(string(b)) != "4242" {
		t.Fatalf("pid file not recorded: %q", b)
	}
}

func TestOwnedPIDRefusesForeignListenerAndStaleFile(t *testing.T) {
	s := pidServer(t, map[string]string{"4242": "nginx", "7": "nginx"}, "4242\n")
	_ = os.WriteFile(s.pidPath(), []byte("7"), 0o600)
	if pid, ok := s.ownedPID(); ok {
		t.Fatalf("adopted foreign pid %d", pid)
	}
}
