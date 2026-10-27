package colima

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

type recordingLanes struct {
	name  string
	shell string
	env   []string
}

func (l *recordingLanes) RunOnce(_ context.Context, name, _, shell string, env []string) error {
	l.name, l.shell, l.env = name, shell, env
	return nil
}

func TestShellJoinQuotesEveryWord(t *testing.T) {
	got := shellJoin([]string{"docker", "pull", "img:1.0", "it's here"})
	want := `'docker' 'pull' 'img:1.0' 'it'\''s here'`
	if got != want {
		t.Fatalf("shellJoin = %s, want %s", got, want)
	}
}

func TestRunGoesThroughTheColimaLane(t *testing.T) {
	lanes := &recordingLanes{}
	rt := New("default", domain.ColimaLimits{}, lanes)
	if err := rt.run(context.Background(), "start", "-p", "default"); err != nil {
		t.Fatal(err)
	}
	if lanes.name != "colima" {
		t.Fatalf("lane = %q, want colima", lanes.name)
	}
	if lanes.shell != "'colima' 'start' '-p' 'default'" {
		t.Fatalf("shell = %s", lanes.shell)
	}
}

// The exact shape `colima status --json` prints in practice: a VM created
// with 2 CPUs and 2GiB of memory, regardless of what the host it runs on has
// today (see Runtime.Capacity for why that gap matters).
//
// @scenario "The observability stack fits inside an undersized colima VM"
func TestParseVMStatusReadsSocketCPUAndMemory(t *testing.T) {
	data := []byte(`{"display_name":"colima","docker_socket":"unix:///Users/x/.colima/default/docker.sock","cpu":2,"memory":2147483648,"disk":107374182400}`)

	st, err := parseVMStatus(data)
	if err != nil {
		t.Fatalf("parseVMStatus: %v", err)
	}
	if st.DockerSocket != "unix:///Users/x/.colima/default/docker.sock" {
		t.Errorf("DockerSocket = %q", st.DockerSocket)
	}
	if st.CPU != 2 {
		t.Errorf("CPU = %d, want 2", st.CPU)
	}
	if st.MemoryBytes != 2147483648 {
		t.Errorf("MemoryBytes = %d, want 2147483648", st.MemoryBytes)
	}
}

// @scenario "The observability stack fits inside an undersized colima VM"
func TestParseVMStatusRejectsInvalidJSON(t *testing.T) {
	if _, err := parseVMStatus([]byte("not json")); err == nil {
		t.Fatal("want an error decoding invalid JSON")
	}
}

func TestDockerLanePinsTheDaemon(t *testing.T) {
	lanes := &recordingLanes{}
	rt := New("default", domain.ColimaLimits{}, lanes)
	if err := rt.DockerLane(context.Background(), DockerRun{Lane: "clickhouse", Host: "unix:///tmp/d.sock", Args: []string{"pull", "img"}}); err != nil {
		t.Fatal(err)
	}
	if lanes.name != "clickhouse" || lanes.shell != "'docker' 'pull' 'img'" {
		t.Fatalf("lane/shell = %q %s", lanes.name, lanes.shell)
	}
	if len(lanes.env) != 1 || lanes.env[0] != "DOCKER_HOST=unix:///tmp/d.sock" {
		t.Fatalf("env = %v", lanes.env)
	}
}
