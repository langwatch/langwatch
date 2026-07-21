package herrgen_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/herrgen"
)

// oneCode is the smallest tree the CLI can generate from.
func oneCode(t *testing.T) string {
	t.Helper()
	return tree(t, map[string]string{
		"pkg/herr/herr.go": herrPackage,
		"services/nlpgo/domain/errors.go": `package domain

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

// ErrNotFound is returned by handlers that match no resource.
const ErrNotFound = herr.Code("not_found")

func RegisterStatuses() {
	herr.RegisterStatus(ErrNotFound, http.StatusNotFound)
}
`,
	})
}

const out = "packages/handled-error/src/codes.generated.ts"

func TestRun(t *testing.T) {
	t.Run("writes the generated file and reports the count", func(t *testing.T) {
		root := oneCode(t)

		var stdout, stderr strings.Builder
		code := herrgen.Run([]string{"-root", root}, &stdout, &stderr)
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr: %s", code, stderr.String())
		}
		if got, want := stdout.String(), "Wrote 1 code to "+out+".\n"; got != want {
			t.Errorf("stdout = %q, want %q", got, want)
		}

		written, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(out)))
		if err != nil {
			t.Fatalf("generated file not written: %v", err)
		}
		if !strings.Contains(string(written), `not_found: { service: "nlpgo", httpStatus: 404 },`) {
			t.Errorf("generated file is missing the code:\n%s", written)
		}
	})

	t.Run("passes -check when the file on disk is current", func(t *testing.T) {
		root := oneCode(t)
		if code := herrgen.Run([]string{"-root", root}, &strings.Builder{}, &strings.Builder{}); code != 0 {
			t.Fatalf("generate exit code = %d, want 0", code)
		}

		var stdout, stderr strings.Builder
		code := herrgen.Run([]string{"-root", root, "-check"}, &stdout, &stderr)
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr: %s", code, stderr.String())
		}
		if got, want := stdout.String(), out+" is up to date (1 code).\n"; got != want {
			t.Errorf("stdout = %q, want %q", got, want)
		}
	})

	t.Run("fails -check with a diff when a Go code was added without regenerating", func(t *testing.T) {
		root := oneCode(t)
		if code := herrgen.Run([]string{"-root", root}, &strings.Builder{}, &strings.Builder{}); code != 0 {
			t.Fatalf("generate exit code = %d, want 0", code)
		}

		added := filepath.Join(root, "services", "aigateway", "domain", "errors.go")
		if err := os.MkdirAll(filepath.Dir(added), 0o750); err != nil {
			t.Fatal(err)
		}
		source := `package domain

import "example.com/repo/pkg/herr"

const ErrCircuitOpen = herr.Code("circuit_open")
`
		if err := os.WriteFile(added, []byte(source), 0o600); err != nil {
			t.Fatal(err)
		}

		var stdout, stderr strings.Builder
		code := herrgen.Run([]string{"-root", root, "-check"}, &stdout, &stderr)
		if code != 1 {
			t.Fatalf("exit code = %d, want 1; stderr: %s", code, stderr.String())
		}
		for _, want := range []string{"is stale", `+  circuit_open: { service: "aigateway" },`, "make herrgen"} {
			if !strings.Contains(stderr.String(), want) {
				t.Errorf("stderr is missing %q:\n%s", want, stderr.String())
			}
		}
	})

	t.Run("fails -check when the generated file does not exist yet", func(t *testing.T) {
		root := oneCode(t)

		var stdout, stderr strings.Builder
		code := herrgen.Run([]string{"-root", root, "-check"}, &stdout, &stderr)
		if code != 1 {
			t.Fatalf("exit code = %d, want 1; stderr: %s", code, stderr.String())
		}
		if !strings.Contains(stderr.String(), "cannot be read") {
			t.Errorf("stderr = %q, want it to say the file cannot be read", stderr.String())
		}
	})

	t.Run("exits 2 and writes nothing when two consts disagree on a status", func(t *testing.T) {
		root := tree(t, map[string]string{
			"pkg/herr/herr.go": herrPackage,
			"services/nlpgo/domain/errors.go": `package domain

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

const ErrNotFound = herr.Code("not_found")

func RegisterStatuses() {
	herr.RegisterStatus(ErrNotFound, http.StatusNotFound)
}
`,
			"services/aigateway/domain/errors.go": `package domain

import (
	"net/http"

	"example.com/repo/pkg/herr"
)

const ErrNotFound = herr.Code("not_found")

func registerErrorStatuses() {
	herr.RegisterStatus(ErrNotFound, http.StatusGone)
}
`,
		})

		var stdout, stderr strings.Builder
		code := herrgen.Run([]string{"-root", root}, &stdout, &stderr)
		if code != 2 {
			t.Fatalf("exit code = %d, want 2; stderr: %s", code, stderr.String())
		}
		if !strings.Contains(stderr.String(), "conflicting HTTP statuses") {
			t.Errorf("stderr = %q, want it to name the conflict", stderr.String())
		}
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(out))); !os.IsNotExist(err) {
			t.Error("a file was written despite the conflict")
		}
	})
}

func TestDiff(t *testing.T) {
	tests := []struct {
		name   string
		before string
		after  string
		want   []string
	}{
		{
			name:   "an added line is marked and its neighbors kept",
			before: "one\ntwo\nfour\n",
			after:  "one\ntwo\nthree\nfour\n",
			want:   []string{" one", " two", "+three", " four"},
		},
		{
			name:   "a removed line is marked",
			before: "one\ntwo\nthree\n",
			after:  "one\nthree\n",
			want:   []string{" one", "-two", " three"},
		},
		{
			name:   "identical texts diff to nothing but context",
			before: "one\ntwo\n",
			after:  "one\ntwo\n",
			want:   []string{"@@ 2 unchanged lines @@"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := strings.Join(herrgen.Diff(test.before, test.after), "\n")
			for _, want := range test.want {
				if !strings.Contains(got, want) {
					t.Errorf("Diff() is missing %q:\n%s", want, got)
				}
			}
		})
	}
}
