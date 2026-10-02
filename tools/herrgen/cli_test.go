package herrgen_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/herrgen"
)

// nodeErrorLiteral is the node half of the artifact. The CLI refuses to write a
// file with either half empty, so every fixture that expects a successful run
// carries one — which is also what makes the node block reachable end to end
// rather than only through Parse.
const nodeErrorLiteral = `package engine

var _ = NodeError{Type: "http_error"}
`

// oneCode is the smallest tree the CLI can generate from. The destination
// package exists, as it does in the repository: herrgen writes into it and
// never creates it.
func oneCode(t *testing.T) string {
	t.Helper()
	return tree(t, map[string]string{
		"packages/handled-error/src/.keep":  "",
		"pkg/herr/herr.go":                  herrPackage,
		"services/nlpgo/app/engine/http.go": nodeErrorLiteral,
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

// @scenario "Pointing the generator at the wrong root stops the run"
// @scenario "A run that finds only half the codes stops rather than writing"
// @scenario "CI fails when the generated file is stale"
func TestRun(t *testing.T) {
	t.Run("writes both halves of the generated file and counts each", func(t *testing.T) {
		root := oneCode(t)

		var stdout, stderr strings.Builder
		code := herrgen.Run([]string{"-root", root}, &stdout, &stderr)
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr: %s", code, stderr.String())
		}
		// Counting only the service codes understated the file by every node
		// code in it, which reads as a generator that lost some.
		if got, want := stdout.String(), "Wrote 1 service code and 1 node code to "+out+".\n"; got != want {
			t.Errorf("stdout = %q, want %q", got, want)
		}

		written, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(out)))
		if err != nil {
			t.Fatalf("generated file not written: %v", err)
		}
		for _, want := range []string{
			`not_found: { service: "nlpgo", httpStatus: 404 },`,
			"export const nodeErrorCodes = {",
			`  http_error: { service: "nlpgo" },`,
			"export type NodeErrorCode = keyof typeof nodeErrorCodes;",
		} {
			if !strings.Contains(string(written), want) {
				t.Errorf("generated file is missing %q:\n%s", want, written)
			}
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
		if got, want := stdout.String(), out+" is up to date (1 service code and 1 node code).\n"; got != want {
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

	t.Run("fails -check with a diff when a node code was added without regenerating", func(t *testing.T) {
		// The node half of the artifact drifts on its own schedule — a new
		// NodeError type is a code the customer meets with no copy written for
		// it, exactly like a new herr.Code.
		root := oneCode(t)
		if code := herrgen.Run([]string{"-root", root}, &strings.Builder{}, &strings.Builder{}); code != 0 {
			t.Fatalf("generate exit code = %d, want 0", code)
		}

		added := filepath.Join(root, "services", "nlpgo", "app", "engine", "dataset.go")
		source := `package engine

var _ = NodeError{Type: "invalid_dataset"}
`
		if err := os.WriteFile(added, []byte(source), 0o600); err != nil {
			t.Fatal(err)
		}

		var stdout, stderr strings.Builder
		code := herrgen.Run([]string{"-root", root, "-check"}, &stdout, &stderr)
		if code != 1 {
			t.Fatalf("exit code = %d, want 1; stderr: %s", code, stderr.String())
		}
		for _, want := range []string{"is stale", `+  invalid_dataset: { service: "nlpgo" },`, "make herrgen"} {
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

	t.Run("exits 2 when the root holds no codes at all", func(t *testing.T) {
		// The repository has more than one go.mod, so -root can point at a
		// module that declares nothing. Writing the empty artifact there and
		// exiting 0 is how a mistyped root deletes every code.
		root := tree(t, map[string]string{
			"packages/handled-error/src/.keep": "",
			"pkg/herr/herr.go":                 herrPackage,
		})

		var stdout, stderr strings.Builder
		code := herrgen.Run([]string{"-root", root}, &stdout, &stderr)
		if code != 2 {
			t.Fatalf("exit code = %d, want 2; stderr: %s", code, stderr.String())
		}
		if !strings.Contains(stderr.String(), "no herr codes or workflow node codes found") {
			t.Errorf("stderr = %q, want it to say no codes were found", stderr.String())
		}
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(out))); !os.IsNotExist(err) {
			t.Error("an empty generated file was written")
		}
	})

	t.Run("exits 2 when the tree holds Go codes but no node codes", func(t *testing.T) {
		// The artifact has two halves and only one used to be guarded, so a run
		// that found no node codes wrote `nodeErrorCodes = {}` and exited 0 —
		// then the drift check demanded the emptied file be committed.
		root := tree(t, map[string]string{
			"packages/handled-error/src/.keep": "",
			"pkg/herr/herr.go":                 herrPackage,
			"services/nlpgo/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const ErrNotFound = herr.Code("not_found")
`,
		})

		var stdout, stderr strings.Builder
		code := herrgen.Run([]string{"-root", root}, &stdout, &stderr)
		if code != 2 {
			t.Fatalf("exit code = %d, want 2; stderr: %s", code, stderr.String())
		}
		if !strings.Contains(stderr.String(), "no workflow node codes found") {
			t.Errorf("stderr = %q, want it to name the half that came back empty", stderr.String())
		}
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(out))); !os.IsNotExist(err) {
			t.Error("a half-empty generated file was written")
		}
	})

	t.Run("renders a string declared as both a Go code and a node type once", func(t *testing.T) {
		// One error identity reached over two transports — an HTTP failure and
		// a node error event — so it gets one entry, which is what the registry
		// (keyed by the string, typed as a union of both halves) always did with
		// it. This used to render in both objects with two unrelated doc blocks
		// and a warning per code on every run.
		root := tree(t, map[string]string{
			"packages/handled-error/src/.keep":  "",
			"pkg/herr/herr.go":                  herrPackage,
			"services/nlpgo/app/engine/http.go": nodeErrorLiteral,
			"services/nlpgo/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const ErrHTTP = herr.Code("http_error")
`,
		})

		var stdout, stderr strings.Builder
		if code := herrgen.Run([]string{"-root", root}, &stdout, &stderr); code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr: %s", code, stderr.String())
		}
		if !strings.Contains(stderr.String(), "http_error") {
			t.Errorf("stderr = %q, want it to name the shared code", stderr.String())
		}

		written, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(out)))
		if err != nil {
			t.Fatalf("reading generated file: %v", err)
		}
		if got := strings.Count(string(written), "  http_error: {"); got != 1 {
			t.Errorf("http_error rendered %d times, want exactly 1:\n%s", got, written)
		}
		// The node site survives the fold — it is the only place the file can
		// still name it, since the node half no longer carries the code.
		if !strings.Contains(string(written), "services/nlpgo/app/engine/http.go") {
			t.Errorf("generated file lost the node source for a folded code:\n%s", written)
		}
	})

	t.Run("exits 2 when a flag cannot be parsed", func(t *testing.T) {
		var stdout, stderr strings.Builder
		code := herrgen.Run([]string{"-not-a-flag"}, &stdout, &stderr)
		if code != 2 {
			t.Fatalf("exit code = %d, want 2; stderr: %s", code, stderr.String())
		}
		if stdout.String() != "" {
			t.Errorf("stdout = %q, want nothing written on a usage error", stdout.String())
		}
	})

	t.Run("exits 2 rather than creating a destination that does not exist", func(t *testing.T) {
		// A wrong -out used to grow a directory tree and report success.
		root := tree(t, map[string]string{
			"pkg/herr/herr.go":                  herrPackage,
			"services/nlpgo/app/engine/http.go": nodeErrorLiteral,
			"services/nlpgo/domain/errors.go": `package domain

import "example.com/repo/pkg/herr"

const ErrNotFound = herr.Code("not_found")
`,
		})

		var stdout, stderr strings.Builder
		code := herrgen.Run([]string{"-root", root, "-out", "nowhere/at/all/codes.ts"}, &stdout, &stderr)
		if code != 2 {
			t.Fatalf("exit code = %d, want 2; stderr: %s", code, stderr.String())
		}
		if _, err := os.Stat(filepath.Join(root, "nowhere")); !os.IsNotExist(err) {
			t.Error("herrgen created the destination tree instead of failing")
		}
	})

	t.Run("exits 2 and writes nothing when two consts disagree on a status", func(t *testing.T) {
		root := tree(t, map[string]string{
			"packages/handled-error/src/.keep": "",
			"pkg/herr/herr.go":                 herrPackage,
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
