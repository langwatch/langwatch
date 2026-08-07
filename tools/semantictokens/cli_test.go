package semantictokens

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeTree lays out a throwaway source tree and returns its root.
func writeTree(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, body := range files {
		full := filepath.Join(root, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// run drives the command against a synthetic tree. Exemption verification is
// off by default here: the list is written for the real tree, so every entry
// would read as stale. The one test that exercises it turns it back on.
func run(t *testing.T, root string, args ...string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	argv := append([]string{"-root", root, "-verify-exemptions=false"}, args...)
	code := Run(argv, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func TestRun(t *testing.T) {
	t.Run("given a raw shade in a color prop", func(t *testing.T) {
		t.Run("fails and names the file, line and token", func(t *testing.T) {
			root := writeTree(t, map[string]string{
				"components/Card.tsx": "\n<Text color=\"gray.500\" />\n",
			})
			code, stdout, _ := run(t, root)
			if code != 1 {
				t.Fatalf("want exit 1, got %d", code)
			}
			for _, want := range []string{"components/Card.tsx", ":2", "fg.subtle"} {
				if !strings.Contains(stdout, want) {
					t.Errorf("want %q in output, got %q", want, stdout)
				}
			}
		})
	})

	t.Run("given only semantic tokens", func(t *testing.T) {
		t.Run("passes", func(t *testing.T) {
			root := writeTree(t, map[string]string{
				"components/Card.tsx": `<Text color="fg.subtle" />`,
			})
			if code, _, _ := run(t, root); code != 0 {
				t.Errorf("want exit 0, got %d", code)
			}
		})
	})

	t.Run("given the ignore marker above the line", func(t *testing.T) {
		t.Run("passes", func(t *testing.T) {
			root := writeTree(t, map[string]string{
				"components/Card.tsx": "// semantic-tokens-ignore: fixed banner\n<Text color=\"gray.500\" />\n",
			})
			if code, _, _ := run(t, root); code != 0 {
				t.Errorf("want exit 0, got %d", code)
			}
		})
	})

	t.Run("given a raw shade in a test file", func(t *testing.T) {
		t.Run("passes, because tests assert on raw values", func(t *testing.T) {
			root := writeTree(t, map[string]string{
				"components/__tests__/Card.test.tsx": `<Text color="gray.500" />`,
			})
			if code, _, _ := run(t, root); code != 0 {
				t.Errorf("want exit 0, got %d", code)
			}
		})
	})

	t.Run("given a raw shade in an exempt directory", func(t *testing.T) {
		t.Run("passes", func(t *testing.T) {
			root := writeTree(t, map[string]string{
				"components/icons/Python.tsx": `<path fill="gray.500" />`,
				"server/mailer/welcome.tsx":   `<Text color="gray.500" />`,
			})
			if code, _, _ := run(t, root); code != 0 {
				t.Errorf("want exit 0, got %d", code)
			}
		})
	})

	t.Run("given an exemption for a file that is gone", func(t *testing.T) {
		t.Run("fails, so the list cannot rot", func(t *testing.T) {
			root := writeTree(t, map[string]string{
				"components/Card.tsx": `<Text color="fg.subtle" />`,
			})
			code, _, stderr := run(t, root, "-verify-exemptions=true")
			if code != 1 {
				t.Fatalf("want exit 1, got %d", code)
			}
			if !strings.Contains(stderr, "stale exemption") {
				t.Errorf("want a stale-exemption message, got %q", stderr)
			}
		})
	})

	t.Run("given -json", func(t *testing.T) {
		t.Run("emits findings and exits 0 so a caller can report first", func(t *testing.T) {
			root := writeTree(t, map[string]string{
				"components/Card.tsx": `<Text color="gray.500" />`,
			})
			code, stdout, _ := run(t, root, "-json")
			if code != 0 {
				t.Fatalf("want exit 0, got %d", code)
			}
			if !strings.Contains(stdout, `"suggestion": "fg.subtle"`) {
				t.Errorf("want the suggestion in JSON, got %q", stdout)
			}
		})
	})
}
