package havenrun

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPinDotenvOriginNamesTheStackAddressInEveryCopiedDotenv(t *testing.T) {
	dir := t.TempDir()
	app := filepath.Join(dir, "platform", "app")
	if err := os.MkdirAll(app, 0o750); err != nil {
		t.Fatal(err)
	}
	for _, target := range []string{dir, app} {
		if err := os.WriteFile(filepath.Join(target, ".env"), []byte("# owned by haven for this stack: BASE_HOST=http://localhost:5560\nFOO=bar\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	if err := PinDotenvOrigin(dir, AppOrigin("visualdiff-1-base")); err != nil {
		t.Fatal(err)
	}

	for _, target := range []string{dir, app} {
		data, err := os.ReadFile(filepath.Join(target, ".env"))
		if err != nil {
			t.Fatal(err)
		}
		for _, line := range []string{
			"BASE_HOST=https://app.visualdiff-1-base.langwatch.localhost",
			"NEXTAUTH_URL=https://app.visualdiff-1-base.langwatch.localhost",
			"FOO=bar",
		} {
			if !strings.Contains(string(data), "\n"+line+"\n") {
				t.Fatalf("%s lacks %q:\n%s", target, line, data)
			}
		}
	}
}

func TestPinDotenvOriginSkipsAWorktreeWithNoDotenv(t *testing.T) {
	if err := PinDotenvOrigin(t.TempDir(), AppOrigin("s")); err != nil {
		t.Fatalf("a worktree with no .env is not an error: %v", err)
	}
}
