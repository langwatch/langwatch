package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// opStubScript is a fake op: it logs its argv, answers `item get` from
// item.json (or the error in fail), and stores what create/edit read on stdin.
const opStubScript = `#!/bin/sh
dir="$(dirname "$0")"
printf '%s\n' "$*" >> "$dir/argv.log"
case "$1 $2" in
"item get")
  if [ -f "$dir/fail" ]; then cat "$dir/fail" >&2; exit 1; fi
  if [ -f "$dir/item.json" ]; then cat "$dir/item.json"; exit 0; fi
  echo '[ERROR] "LangWatch haven secrets" isn'"'"'t an item in the "Private" vault.' >&2; exit 1 ;;
"item create"|"item edit")
  if [ -f "$dir/readonly" ]; then cat > /dev/null; exit 0; fi
  cat > "$dir/item.json"; echo '{"id":"stored"}'; exit 0 ;;
esac
exit 1
`

type opStub struct{ dir string }

// stubOnePassword puts the fake op first on PATH and forgets any cached read.
func stubOnePassword(t *testing.T) opStub {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "op"), []byte(opStubScript), 0o700); err != nil { //nolint:gosec // an executable stub
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	forgetOnePassword()
	t.Cleanup(forgetOnePassword)
	return opStub{dir: dir}
}

func (s opStub) holds(t *testing.T, fields map[string]string) {
	t.Helper()
	raw, err := domain.NewOnePasswordItem(fields)
	if err != nil {
		t.Fatal(err)
	}
	s.write(t, "item.json", string(raw))
}

func (s opStub) write(t *testing.T, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(s.dir, name), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func (s opStub) calls(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(s.dir, "argv.log"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSpace(string(raw)), "\n")
}

func (s opStub) stored(t *testing.T) map[string]string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(s.dir, "item.json"))
	if err != nil {
		t.Fatal(err)
	}
	fields, err := domain.OnePasswordFields(raw)
	if err != nil {
		t.Fatal(err)
	}
	return fields
}

func checkoutWithDotenv(t *testing.T, content string) string {
	t.Helper()
	repo := t.TempDir()
	if err := os.WriteFile(filepath.Join(repo, ".env"), []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return repo
}
