package disposabledomains_test

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/disposabledomains"
)

const pinned = "9cf2bee345b0276e1b65cee7484beb51e5c715b1"

// fakeUpstream serves main's sha and the list at that sha only.
func fakeUpstream(t *testing.T) disposabledomains.Upstream {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/disposable-email-domains/disposable-email-domains/commits/main":
			fmt.Fprintln(w, pinned)
		case "/disposable-email-domains/disposable-email-domains/" + pinned + "/disposable_email_blocklist.conf":
			fmt.Fprint(w, strings.Repeat("x.example\n", 3)+generated(disposabledomains.MinimumDomains))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	return disposabledomains.Upstream{API: server.URL, Raw: server.URL, Client: server.Client()}
}

func generated(count int) string {
	var lines strings.Builder
	for i := range count {
		fmt.Fprintf(&lines, "d%d.example\n", i)
	}
	return lines.String()
}

func repoRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "modules", "organization", "process", "src", "rules"), 0o750); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestRunRecordsTheCommitMainPointedAt(t *testing.T) {
	root := repoRoot(t)
	var stdout, stderr bytes.Buffer
	if code := fakeUpstream(t).Run([]string{"-root", root}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
	source, err := os.ReadFile(filepath.Join(root, "modules", "organization", "process", "src", "rules", "disposable-email-domains.source.json"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(source), `"commit": "`+pinned+`"`) {
		t.Fatalf("source does not name the commit: %s", source)
	}
}

func TestRunRefusesACommitThatIsNotAFullSha(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := fakeUpstream(t).Run([]string{"-root", repoRoot(t), "-commit", "main"}, &stdout, &stderr)
	if code != 2 {
		t.Fatalf("exit %d, want 2", code)
	}
}
