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

// A worktree whose daemon script predates the shared browser keeps a browser of
// its own, since that script serves one stack only.
func TestLegacyDaemonScriptKeepsItsOwnBrowser(t *testing.T) {
	worktree := t.TempDir()
	script := filepath.Join(worktree, "apps", "haven-web", "scripts", "browser-daemon.ts")
	if err := os.MkdirAll(filepath.Dir(script), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(script, []byte(`const DIR = env("HAVEN_BROWSER_DIR");`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := browserHomeFor(worktree, "s1"); got != browserDir("s1") {
		t.Fatalf("a legacy worktree was sent to the machine's browser: %s", got)
	}
	if err := os.WriteFile(script, []byte(`const PROTOCOL = 2;`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := browserHomeFor(worktree, "s1"); got != browserHome() {
		t.Fatalf("a current worktree did not share the machine's browser: %s", got)
	}
}
