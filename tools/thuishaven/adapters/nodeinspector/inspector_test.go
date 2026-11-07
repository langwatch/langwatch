package nodeinspector

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"testing"
	"time"
)

// A real Node process with no inspector, started as haven starts lanes (a free
// inspector port): Attach opens one with SIGUSR1, records a CPU profile and a
// heap snapshot, and Close shuts the inspector it opened.
//
// @scenario "The inspector is opened for the profile and closed after"
func TestAttachOpensProfilesAndClosesTheInspector(t *testing.T) {
	if testing.Short() {
		t.Skip("spawns a Node process")
	}
	for _, bin := range []string{"node", "lsof"} {
		if _, err := exec.LookPath(bin); err != nil {
			t.Skipf("%s not on PATH", bin)
		}
	}
	cmd := exec.Command("node", "-e", "let n = 0; setInterval(() => { for (let i = 0; i < 1e5; i++) n += i }, 5)")
	cmd.Env = append(os.Environ(), "NODE_OPTIONS=--inspect-port=0")
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	time.Sleep(300 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	s, err := Attach(ctx, cmd.Process.Pid)
	if err != nil {
		t.Fatal(err)
	}
	if !s.Opened || s.Port == 0 || s.Port == DefaultPort {
		t.Fatalf("want an inspector opened on a free port, got opened=%v port=%d", s.Opened, s.Port)
	}
	raw, err := s.CPUProfile(ctx, CPUOptions{Duration: 300 * time.Millisecond, Interval: 500 * time.Microsecond})
	if err != nil {
		t.Fatal(err)
	}
	var p struct {
		Nodes   []json.RawMessage `json:"nodes"`
		Samples []int             `json:"samples"`
	}
	if err := json.Unmarshal(raw, &p); err != nil || len(p.Nodes) == 0 || len(p.Samples) == 0 {
		t.Fatalf("cpu profile has no nodes or samples (err %v)", err)
	}
	var snap bytes.Buffer
	if err := s.HeapSnapshot(ctx, &snap); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(snap.Bytes(), []byte(`"node_fields"`)) {
		t.Fatal("heap snapshot has no meta")
	}
	if mem, err := s.Memory(ctx); err != nil || mem.RSS == 0 {
		t.Fatalf("memory: %+v %v", mem, err)
	}
	if leftOpen := s.Close(ctx); leftOpen {
		t.Fatal("Close left the inspector it opened")
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, _, found := findTarget(ctx, listenPorts(ctx, cmd.Process.Pid)); !found {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("the inspector still answers after Close")
}
