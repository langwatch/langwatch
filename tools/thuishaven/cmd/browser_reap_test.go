package cmd

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// After a reap the browser daemon exits on the disconnect, so the daemon.json
// it left names a dead pid; ensureBrowser must then start a fresh daemon
// rather than call the dead one.
// @scenario "The next haven browser command works after a reap"
func TestReadBrowserDaemonRefusesAReapedDaemon(t *testing.T) {
	child := exec.Command("true")
	if err := child.Run(); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	data, _ := json.Marshal(browserDaemon{PID: child.Process.Pid, Port: 4242, Token: "t"})
	if err := os.WriteFile(filepath.Join(dir, "daemon.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := readBrowserDaemon(dir); ok {
		t.Fatal("a daemon whose pid is gone was reported running; the next command would call it instead of starting a fresh one")
	}
	data, _ = json.Marshal(browserDaemon{PID: os.Getpid(), Port: 4242, Token: "t"})
	if err := os.WriteFile(filepath.Join(dir, "daemon.json"), data, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, ok := readBrowserDaemon(dir); !ok {
		t.Fatal("a live daemon was reported gone")
	}
}
